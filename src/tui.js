#!/usr/bin/env node
const { intro, outro, text, select, spinner, log, isCancel } = require('@clack/prompts');
const chalk = require('chalk');
const boxen = require('boxen');
const gradient = require('gradient-string');
const { orchestrate } = require('./core.js');
const { CommandRegistry } = require('./commands.js');
const fs = require('fs');
const path = require('path');

const termSize = () => {
    const ts = require('terminal-size');
    return (typeof ts === 'function' ? ts : ts.default)();
};

const sessionsPath = path.join(__dirname, '../sessions/history.json');

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
        
        let query = await text({
            message: chalk.cyan.bold('🐋 ORCA PROMPT'),
            placeholder: 'Type your task or / for commands...',
            validate(value) {
                if (value.length === 0) return `Prompt cannot be empty!`;
            },
        });

        if (isCancel(query)) {
            outro(chalk.yellow('Orca system standing down. Session terminated.'));
            process.exit(0);
        }

        // 1. Trigger Command Menu if user types /
        if (query === '/') {
            const cmd = await select({
                message: chalk.magenta('Select a Command'),
                options: commandRegistry.getCommandList()
            });

            if (isCancel(cmd)) continue;
            await commandRegistry.execute(cmd);
            continue;
        }

        // 2. Handle inline slash commands (e.g., /sandbox off)
        if (query.startsWith('/')) {
            const isHandled = await commandRegistry.execute(query);
            if (isHandled) continue;
        }

        // 3. Otherwise, treat as orchestration task
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
                    sessionStats.estimatedCost += (event.usage.total_tokens / 1000000) * 0.50; 
                }
            }, sessionStats);

            sessionStats.totalTasks++;
            
            // Real session saving
            const history = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
            history.push({
                timestamp: new Date().toISOString(),
                prompt: query,
                result: result,
                tokens: sessionStats.totalTokens
            });
            fs.writeFileSync(sessionsPath, JSON.stringify(history, null, 2));

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
