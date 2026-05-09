#!/usr/bin/env node
const { intro, outro, spinner, log, isCancel } = require('@clack/prompts');
const chalk = require('chalk');
const boxen = require('boxen');
const gradient = require('gradient-string');
const { orchestrate } = require('./core.js');
const { CommandRegistry } = require('./commands.js');
const enquirer = require('enquirer');
const termSize = () => {
    const ts = require('terminal-size');
    return (typeof ts === 'function' ? ts : ts.default)();
};

// Session State
let sessionStats = {
    totalTasks: 0,
    activeAgents: 0,
    estimatedCost: 0.00,
    totalTokens: 0,
    sandbox: true,
    lastModel: 'N/A'
};

const commandRegistry = new CommandRegistry(sessionStats);

function centerText(text) {
    const { columns } = termSize();
    const lines = text.split('\n');
    return lines.map(line => {
        const padding = Math.max(0, Math.floor((columns - line.replace(/\u001b\[.*?m/g, '').length) / 2));
        return ' '.repeat(padding) + line;
    }).join('\n');
}

async function showHeader() {
    const { columns } = termSize();
    const splash = `
    _______  ___      ___   ___  __   __  _______  ______    ______   
   |       ||   |    |   | |   ||  | |  ||       ||    _ |  |      |  
   |    ___||   |    |   |_|   ||  |_|  ||    ___||   | ||  |  _    | 
   |   |___ |   |    |      _  ||       ||   |___ |   |_||_ | | |   | 
   |    ___||   |___ |     |_| ||       ||    ___||    __  || |_|   | 
   |   |___ |       ||    _  |  |   _   ||   |___ |   |  | ||       | 
   |_______||_______||___| |_|  |__| |__||_______||___|  |_||______| 
    `;
    
    console.clear();
    console.log('\n' + centerText(gradient(['#00c6ff', '#0072ff'])(splash)));
    console.log(centerText(chalk.blue.bold('Corporate Ecosystem Orchestrator | 100 Specialized Agents')));
    console.log('\n');
}

function renderStatusBar() {
    const { columns } = termSize();
    const sandboxStatus = sessionStats.sandbox ? chalk.green('● SANDBOX ON') : chalk.red('○ SANDBOX OFF');
    const stats = [
        chalk.cyan(`💰 Cost: $${sessionStats.estimatedCost.toFixed(5)}`),
        chalk.magenta(`🤖 Agent: ${sessionStats.lastModel}`),
        chalk.blue(`🧵 Threads: ${sessionStats.activeAgents}`),
        chalk.yellow(`⚙️ Tasks: ${sessionStats.totalTasks}`),
        sandboxStatus
    ].join('  |  ');

    console.log(boxen(stats, {
        width: Math.min(columns - 4, 100),
        textAlignment: 'center',
        borderStyle: 'round',
        borderColor: '#444',
        padding: 0,
        margin: { left: Math.floor((columns - Math.min(columns - 4, 100)) / 2) }
    }));
}

async function interactiveSession() {
    await showHeader();
    
    while (true) {
        renderStatusBar();
        
        // Use Enquirer Autocomplete for commands and free text
        const prompt = new enquirer.AutoComplete({
            name: 'query',
            message: chalk.cyan.bold('🐋 ORCA PROMPT'),
            choices: commandRegistry.getCommandList().map(c => c.name),
            limit: 10,
            suggest(input, choices) {
                if (input.startsWith('/')) {
                    return choices.filter(choice => choice.name.startsWith(input));
                }
                return []; 
            }
        });

        let query;
        try {
            query = await prompt.run();
        } catch (e) {
            outro(chalk.yellow('Orca system standing down. Session terminated.'));
            process.exit(0);
        }

        if (!query) continue;

        // 1. Check if it's a command
        if (query.startsWith('/')) {
            const isHandled = await commandRegistry.execute(query);
            if (isHandled) continue;
        }

        // 2. Otherwise, treat as orchestration task
        const s = spinner();
        s.start(chalk.blue('CEO analyzing corporate resources...'));

        try {
            const result = await orchestrate(query, (event) => {
                if (event.activeCount !== undefined) {
                    sessionStats.activeAgents = event.activeCount;
                }
                
                if (event.type === 'agent_start') {
                    sessionStats.lastModel = event.agent;
                    s.message(chalk.white(`[${chalk.blue(event.agent)}] `) + chalk.dim(event.task));
                } else if (event.type === 'status') {
                    s.message(chalk.yellow(event.message));
                } else if (event.type === 'usage' && event.usage) {
                    sessionStats.totalTokens += event.usage.total_tokens;
                    // Simple average pricing for display
                    sessionStats.estimatedCost += (event.usage.total_tokens / 1000000) * 0.50; 
                }
            }, sessionStats);

            sessionStats.totalTasks++;
            s.stop(chalk.green('Orchestration Complete'));
            
            const { columns } = termSize();
            console.log(boxen(result, {
                width: Math.min(columns - 10, 120),
                padding: 1,
                margin: { left: Math.floor((columns - Math.min(columns - 10, 120)) / 2), top: 1, bottom: 1 },
                borderStyle: 'double',
                borderColor: 'blue',
                title: chalk.bold.blue(' EXECUTIVE SUMMARY '),
                titleAlignment: 'center'
            }));

        } catch (error) {
            s.stop(chalk.red('Orchestration Interrupted'));
            log.error(error.message);
        }
    }
}

if (require.main === module) {
    interactiveSession().catch(console.error);
}

module.exports = { interactiveSession };
