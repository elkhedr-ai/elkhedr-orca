#!/usr/bin/env node
const { intro, outro, spinner, log, isCancel } = require('@clack/prompts');
const chalk = require('chalk');
const boxen = require('boxen');
const gradient = require('gradient-string');
const core = require('./core.js');
const { CommandRegistry } = require('./commands.js');
const enquirer = require('enquirer');
const fs = require('fs');
const path = require('path');

const wrap = require('word-wrap');

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
    lastModel: 'N/A',
    currentAgent: null, // Track persistent agent mode
    level: 'Auto' // Default smart level
};

// Initialize Registry with reference to core for direct tasks
const commandRegistry = new CommandRegistry(sessionStats, core);

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
      ::::::::  :::::::::   ::::::::      :::     
     :+:    :+: :+:    :+: :+:    :+:   :+: :+:   
     +:+    +:+ +:+    +:+ +:+         +:+   +:+  
     +#+    +:+ +#++:++#:  +#+        +#++:++#++: 
     +#+    +:+ +#+    +#+ +#+        +#+     +#+ 
     #+#    #+# #+#    #+# #+#    #+# #+#     #+# 
      ########  ###    ###  ########  ###     ### 
    `;
    
    console.clear();
    console.log('\n' + centerText(gradient(['#00c6ff', '#0072ff'])(splash)));
    console.log(centerText(chalk.blue.bold('Corporate Ecosystem Orchestrator | 100 Specialized Agents')));
    console.log('\n');
}

function renderStatusBar() {
    const { columns } = termSize();
    const sandboxStatus = sessionStats.sandbox ? chalk.green('● SANDBOX ON') : chalk.red('○ SANDBOX OFF');
    
    const levelIcons = {
        'Auto': '🤖',
        'Instant': '⚡',
        'Thinking': '🧠',
        'Swarm': '🐝'
    };
    const icon = levelIcons[sessionStats.level] || '🐋';

    const mode = sessionStats.currentAgent 
        ? chalk.bgBlue.white(` 🤖 DIRECT: ${sessionStats.currentAgent.role.toUpperCase()} `)
        : chalk.bgCyan.black(` ${icon} MODE: ${sessionStats.level.toUpperCase()} `);

    const stats = [
        chalk.cyan(`💰 $${sessionStats.estimatedCost.toFixed(5)}`),
        chalk.blue(`🧵 Threads: ${sessionStats.activeAgents}`),
        chalk.yellow(`⚙️ Tasks: ${sessionStats.totalTasks}`),
        sandboxStatus
    ].join('  |  ');

    console.log(centerText(mode));
    console.log(boxen(stats, {
        width: Math.min(columns - 4, 100),
        textAlignment: 'center',
        borderStyle: 'round',
        borderColor: '#444',
        padding: 0,
        margin: { left: Math.floor((columns - Math.min(columns - 4, 100)) / 2) }
    }));
}

// Custom Safe Autocomplete class to prevent regex crash and handle conditional visibility
class OrcaPrompt extends enquirer.AutoComplete {
    constructor(options) {
        super(options);
    }
    
    // Override submit to allow free text even if no choice is matched
    async submit() {
        if (this.state.index === -1 || !this.input.startsWith('/')) {
            this.state.submitted = true;
            this.state.validating = true;
            
            // This is the key: if not a command, treat input as the literal value
            await this.validate(this.input, this.state);
            await this.render();
            await this.close();
            
            this.emit('submit', this.input);
            return;
        }
        return super.submit();
    }

    renderChoices() {
        if (!this.input.startsWith('/')) {
            return '';
        }
        return super.renderChoices();
    }

    highlight(str) {
        if (!this.input) return str;
        try {
            const safeInput = this.input.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
            const regex = new RegExp(safeInput, 'ig');
            return str.replace(regex, chalk.cyan('$&'));
        } catch (e) {
            return str;
        }
    }
}

async function interactiveSession() {
    await showHeader();
    
    while (true) {
        renderStatusBar();
        
        const choices = commandRegistry.getCommandList();
        const promptLabel = sessionStats.currentAgent ? chalk.blue.bold(`🤖 ${sessionStats.currentAgent.role.split(' ')[0].toUpperCase()}`) : chalk.cyan.bold('🐋 ORCA');

        const prompt = new OrcaPrompt({
            name: 'query',
            message: promptLabel,
            choices: choices.map(c => c.name),
            limit: 10,
            suggest(input, choices) {
                if (input.startsWith('/')) {
                    return choices.filter(choice => choice.name.startsWith(input));
                }
                return [];
            },
            footer: () => this.input && this.input.startsWith('/') ? chalk.dim(' (Search commands...)') : chalk.dim(' (Type / for commands)')
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

        // 2. Execution Logic
        const s = spinner();
        const startMsg = sessionStats.currentAgent 
            ? `Consulting ${sessionStats.currentAgent.role}...` 
            : (sessionStats.level === 'Auto' ? 'Analyzing task for optimal routing...' : `Executing ${sessionStats.level} path...`);
        s.start(chalk.blue(startMsg));

        try {
            let result;
            if (sessionStats.currentAgent) {
                // Direct Agent Mode
                result = await core.runSingleAgent(sessionStats.currentAgent.id, query, (event) => {
                    if (event.type === 'usage' && event.usage) {
                        sessionStats.totalTokens += event.usage.total_tokens;
                        sessionStats.estimatedCost += (event.usage.total_tokens / 1000000) * 0.50; 
                    }
                }, sessionStats);
            } else {
                // Standard Orchestration Mode (Respecting Smart Levels)
                result = await core.orchestrate(query, (event) => {
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
            }

            sessionStats.totalTasks++;
            
            // Real session saving
            if (fs.existsSync(sessionsPath)) {
                const history = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
                history.push({
                    timestamp: new Date().toISOString(),
                    prompt: query,
                    mode: sessionStats.currentAgent ? 'DIRECT' : sessionStats.level,
                    agent: sessionStats.currentAgent ? sessionStats.currentAgent.role : 'CEO',
                    result: result,
                    tokens: sessionStats.totalTokens
                });
                fs.writeFileSync(sessionsPath, JSON.stringify(history, null, 2));
            }

            s.stop(chalk.green('Response Received'));
            
            const { columns } = termSize();
            const boxWidth = Math.min(columns - 10, 120);
            
            // Apply word wrap to the result to ensure it stays inside the box
            const wrappedResult = wrap(result, {
                width: boxWidth - 4, // Subtract padding
                indent: '',
                trim: true
            });

            console.log(boxen(wrappedResult, {
                width: boxWidth,
                padding: 1,
                margin: { left: Math.floor((columns - boxWidth) / 2), top: 1, bottom: 1 },
                borderStyle: 'double',
                borderColor: sessionStats.currentAgent ? 'magenta' : 'blue',
                title: chalk.bold(sessionStats.currentAgent ? ` ${sessionStats.currentAgent.role.toUpperCase()} ` : ' EXECUTIVE SUMMARY '),
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
