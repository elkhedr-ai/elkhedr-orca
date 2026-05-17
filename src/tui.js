#!/usr/bin/env node
const { intro, outro, spinner, log, isCancel } = require('@clack/prompts');
const chalk = require('chalk');
const boxen = require('boxen');
const gradient = require('gradient-string');
const core = require('./core.js');
const { CommandRegistry } = require('./commands.js');
const { logger } = require('./utils/logger.js');
const { withTrace, addTraceMetadata } = require('./utils/tracing.js');
const enquirer = require('enquirer');
const fs = require('fs');
const path = require('path');

const wrap = require('word-wrap');

const termSize = () => {
    const ts = require('terminal-size');
    return (typeof ts === 'function' ? ts : ts.default)();
};

const sessionsPath = path.join(__dirname, '../sessions/history.json');
const historyCachePath = path.join(__dirname, '../sessions/input-history.json');

// Session State
let sessionStats = {
    totalTasks: 0,
    activeAgents: 0,
    estimatedCost: 0.00,
    totalTokens: 0,
    sandbox: true,
    lastModel: 'N/A',
    currentAgent: null,
    level: 'Auto'
};

// Input history for up/down arrow support
let inputHistory = [];
let historyIndex = -1;

// Load input history
function loadInputHistory() {
    try {
        if (fs.existsSync(historyCachePath)) {
            inputHistory = JSON.parse(fs.readFileSync(historyCachePath, 'utf8'));
        }
    } catch (e) {
        logger.warn('Failed to load input history');
    }
}

// Save input history
function saveInputHistory() {
    try {
        // Keep last 100 entries
        const trimmed = inputHistory.slice(-100);
        fs.writeFileSync(historyCachePath, JSON.stringify(trimmed, null, 2));
    } catch (e) {
        logger.warn('Failed to save input history');
    }
}

// Initialize Registry
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
    console.log(centerText(chalk.dim('v1.0.0 | Type /help for commands | Ctrl+C to exit')));
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

// Custom Safe Autocomplete class
class OrcaPrompt extends enquirer.AutoComplete {
    constructor(options) {
        super(options);
        this.historyIndex = -1;
        this.originalInput = '';
    }
    
    async submit() {
        if (this.state.index === -1 || !this.input.startsWith('/')) {
            this.state.submitted = true;
            this.state.validating = true;
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

    // Handle up/down for history navigation
    async up() {
        if (!this.input.startsWith('/') && inputHistory.length > 0) {
            if (this.historyIndex === -1) {
                this.originalInput = this.input;
            }
            this.historyIndex = Math.min(this.historyIndex + 1, inputHistory.length - 1);
            this.input = inputHistory[inputHistory.length - 1 - this.historyIndex] || '';
            this.cursor = this.input.length;
            await this.render();
            return;
        }
        return super.up();
    }

    async down() {
        if (!this.input.startsWith('/') && inputHistory.length > 0) {
            this.historyIndex = Math.max(this.historyIndex - 1, -1);
            if (this.historyIndex === -1) {
                this.input = this.originalInput;
            } else {
                this.input = inputHistory[inputHistory.length - 1 - this.historyIndex] || '';
            }
            this.cursor = this.input.length;
            await this.render();
            return;
        }
        return super.down();
    }
}

async function interactiveSession() {
    loadInputHistory();
    await showHeader();
    
    while (true) {
        renderStatusBar();
        
        const choices = commandRegistry.getCommandList();
        const promptLabel = sessionStats.currentAgent ? 
            chalk.blue.bold(`🤖 ${sessionStats.currentAgent.role.split(' ')[0].toUpperCase()}`) : 
            chalk.cyan.bold('🐋 ORCA');

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
            footer: () => this.input && this.input.startsWith('/') ? 
                chalk.dim(' (Search commands...)') : 
                chalk.dim(' (Type / for commands, ↑↓ for history)')
        });

        let query;
        try {
            query = await prompt.run();
        } catch (e) {
            outro(chalk.yellow('Orca system standing down. Session terminated.'));
            process.exit(0);
        }

        if (!query) continue;
        
        // Add to history (avoid duplicates at the end)
        if (inputHistory.length === 0 || inputHistory[inputHistory.length - 1] !== query) {
            inputHistory.push(query);
            saveInputHistory();
        }

        // Check if it's a command
        if (query.startsWith('/')) {
            const isHandled = await commandRegistry.execute(query);
            if (isHandled) continue;
        }

        // Execution Logic with Tracing
        await withTrace(async (traceId) => {
            addTraceMetadata('query', query.substring(0, 100));
            addTraceMetadata('mode', sessionStats.currentAgent ? 'DIRECT' : sessionStats.level);
            
            const s = spinner();
            const startMsg = sessionStats.currentAgent 
                ? `Consulting ${sessionStats.currentAgent.role}...` 
                : (sessionStats.level === 'Auto' ? 'Analyzing task for optimal routing...' : `Executing ${sessionStats.level} path...`);
            s.start(chalk.blue(startMsg));
            
            logger.info({ query: query.substring(0, 100), mode: sessionStats.currentAgent ? 'DIRECT' : sessionStats.level }, 'Processing query');

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
                    // Standard Orchestration Mode
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
                
                // Session saving with traceId
                try {
                    let history = [];
                    if (fs.existsSync(sessionsPath)) {
                        history = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
                    }
                    history.push({
                        timestamp: new Date().toISOString(),
                        prompt: query,
                        mode: sessionStats.currentAgent ? 'DIRECT' : sessionStats.level,
                        agent: sessionStats.currentAgent ? sessionStats.currentAgent.role : 'CEO',
                        result: result,
                        tokens: sessionStats.totalTokens,
                        traceId: traceId
                    });
                    fs.writeFileSync(sessionsPath, JSON.stringify(history, null, 2));
                } catch (e) {
                    logger.warn('Failed to save session');
                }

                s.stop(chalk.green('✓ Response Received'));
                
                const { columns } = termSize();
                const boxWidth = Math.min(columns - 10, 120);
                
                const wrappedResult = wrap(result, {
                    width: boxWidth - 4,
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
                s.stop(chalk.red('✗ Orchestration Failed'));
                
                logger.error({ error: error.message, stack: error.stack }, 'Orchestration error');
                
                const errorBox = boxen(
                    `${chalk.red.bold('Error:')} ${error.message}\n\n` +
                    `${chalk.dim('Code:')} ${error.code || 'UNKNOWN'}\n` +
                    `${chalk.dim('Trace ID:')} ${traceId}`,

                    {
                        padding: 1,
                        borderColor: 'red',
                        title: ' ERROR ',
                        titleAlignment: 'center'
                    }
                );
                console.log(errorBox);
            }
        }, { 
            operation: sessionStats.currentAgent ? 'tui:direct-agent' : 'tui:orchestrate',
            metadata: { 
                agentId: sessionStats.currentAgent?.id,
                level: sessionStats.level
            }
        });
    }
}

if (require.main === module) {
    interactiveSession().catch((error) => {
        logger.fatal({ error: error.message, stack: error.stack }, 'Fatal TUI error');
        console.error(error);
        process.exit(1);
    });
}

module.exports = { interactiveSession };
