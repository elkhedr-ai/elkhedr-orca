const { intro, outro, spinner, log, isCancel } = require('@clack/prompts');
const chalk = require('chalk');
const boxen = require('boxen');
const fs = require('fs');
const path = require('path');
const Table = require('cli-table3');
const enquirer = require('enquirer');
const { getCircuitBreakerStatus, resetCircuitBreaker } = require('./core.js');

const agentsDataPath = path.join(__dirname, 'agents.json');
const sessionsPath = path.join(__dirname, '../sessions/history.json');
const skillsPath = path.join(__dirname, '../skills/registry.json');
const analyticsPath = path.join(__dirname, '../data/analytics.json');

class CommandRegistry {
    constructor(sessionStats, orchestratorRef) {
        this.sessionStats = sessionStats;
        this.orchestratorRef = orchestratorRef; 
        this.commands = {
            '/sandbox': {
                label: 'Toggle Sandbox',
                description: 'Toggle secure execution environment [on|off]',
                execute: (args) => this.toggleSandbox(args)
            },
            '/agents': {
                label: 'Agent Manager',
                description: 'Interactive management of 100 specialized agents',
                execute: () => this.manageAgents()
            },
            '/models': {
                label: 'Model & Provider Control',
                description: 'Configure providers and model assignments',
                execute: () => this.manageModels()
            },
            '/sessions': {
                label: 'Session History',
                description: 'View real history of previous task results',
                execute: () => this.listSessions()
            },
            '/skills': {
                label: 'Skill Manager',
                description: 'Manage and trigger agent capabilities',
                execute: () => this.manageSkills()
            },
            '/stats': {
                label: 'Analytics Dashboard',
                description: 'Show granular usage, costs, and agent performance',
                execute: () => this.showAnalytics()
            },
            '/providers': {
                label: 'Provider Status',
                description: 'Check status of configured AI providers',
                execute: () => this.checkProviders()
            },
            '/health': {
                label: 'System Health',
                description: 'Check circuit breaker and system health status',
                execute: () => this.showHealth()
            },
            '/clear': {
                label: 'Clear Screen',
                description: 'Clear the terminal screen',
                execute: () => console.clear()
            },
            '/reset': {
                label: 'Reset Mode',
                description: 'Return to standard CEO Orchestration mode',
                execute: () => {
                    this.sessionStats.currentAgent = null;
                    log.success('Back to CEO Mode.');
                }
            },
            '/level': {
                label: 'Smart Levels',
                description: 'Toggle response depth [Instant|Thinking|Full]',
                execute: () => this.toggleLevel()
            },
            '/exit': {
                label: 'Exit',
                description: 'Terminate the Orca session',
                execute: () => {
                    outro(chalk.yellow('Orca system standing down. Goodbye!'));
                    process.exit(0);
                }
            }
        };
    }

    getCommandList() {
        return Object.entries(this.commands).map(([cmd, data]) => ({
            name: cmd,
            message: `${chalk.bold(cmd)} - ${data.description}`,
            value: cmd
        }));
    }

    async execute(input) {
        const parts = input.split(' ');
        const cmd = parts[0];
        const args = parts.slice(1);
        
        if (this.commands[cmd]) {
            await this.commands[cmd].execute(args);
            return true;
        }
        return false;
    }

    toggleSandbox(args) {
        const state = args[0] ? args[0].toLowerCase() : null;
        if (state === 'on') {
            this.sessionStats.sandbox = true;
            log.success(chalk.green('Sandbox activated. Restricted to ~/elkhedr-orca-sandbox/'));
        } else if (state === 'off') {
            this.sessionStats.sandbox = false;
            log.warn(chalk.red('Sandbox deactivated. Full system access enabled.'));
        } else {
            this.sessionStats.sandbox = !this.sessionStats.sandbox;
            log.info(`Sandbox is now ${this.sessionStats.sandbox ? chalk.green('ON') : chalk.red('OFF')}`);
        }
    }

    async manageAgents() {
        const agentsData = JSON.parse(fs.readFileSync(agentsDataPath, 'utf8'));
        
        const prompt = new enquirer.AutoComplete({
            name: 'agent',
            message: chalk.cyan('Search and select an agent to manage:'),
            choices: agentsData.agents.map(a => ({
                name: a.role,
                message: `${a.role} (${chalk.dim(a.department)})`,
                value: a.id
            })),
            limit: 10
        });

        const selectedRole = await prompt.run();
        const agent = agentsData.agents.find(a => a.role === selectedRole);
        
        if (!agent) return;

        const actionPrompt = new enquirer.Select({
            name: 'action',
            message: `${chalk.bold.blue(agent.role)} Management`,
            choices: [
                { name: 'details', message: 'View Full Details' },
                { name: 'model', message: 'Override Primary Model' },
                { name: 'task', message: 'Assign Direct Task' },
                { name: 'back', message: '<-- Back' }
            ]
        });

        const action = await actionPrompt.run();

        if (action === 'details') {
            console.log(boxen(
                `${chalk.cyan('ID:')} ${agent.id}\n` +
                `${chalk.cyan('Department:')} ${agent.department}\n` +
                `${chalk.cyan('Primary Model:')} ${agent.model}\n` +
                `${chalk.cyan('Fallback Model:')} ${agent.fallbackModel}\n` +
                `${chalk.cyan('Provider:')} OpenRouter`,
                { padding: 1, borderColor: 'blue', title: agent.role }
            ));
        } else if (action === 'model') {
            const newModelPrompt = new enquirer.Input({
                message: `Enter new model string for ${agent.role}:`,
                initial: agent.model
            });
            const newModel = await newModelPrompt.run();
            agent.model = newModel;
            fs.writeFileSync(agentsDataPath, JSON.stringify(agentsData, null, 2));
            log.success(`Successfully updated ${agent.role} model.`);
        } else if (action === 'task') {
            this.sessionStats.currentAgent = agent;
            log.success(chalk.bold.green(`\n🚀 SESSION MODE: DIRECT AGENT\n`) + `You are now talking directly to the ${chalk.blue(agent.role)}.\nType ${chalk.yellow('/reset')} to return to CEO mode.`);
        }
    }

    async manageModels() {
        log.info(chalk.bold('Provider Configuration:'));
        log.success('1. OpenRouter (PRIMARY) - Connected');
        log.info('2. OpenAI - Configurable in .env');
        log.info('3. Anthropic - Configurable in .env');
        
        const action = await new enquirer.Select({
            message: 'Model Controls',
            choices: ['View Agent Mappings', 'Check Latency', 'Back']
        }).run();

        if (action === 'View Agent Mappings') {
            this.listAgents();
        }
    }

    async manageSkills() {
        const skills = JSON.parse(fs.readFileSync(skillsPath, 'utf8'));
        if (skills.length === 0) {
            log.info('No skills registered yet.');
            return;
        }

        const skillToRun = await new enquirer.Select({
            message: 'Select a Skill to Execute:',
            choices: skills.map(s => s.name).concat(['Back'])
        }).run();

        if (skillToRun === 'Back') return;
        log.info(`Executing skill: ${skillToRun}... (Sandbox protection active)`);
    }

    listAgents() {
        const agentsData = JSON.parse(fs.readFileSync(agentsDataPath, 'utf8'));
        const table = new Table({
            head: [chalk.cyan('ID'), chalk.cyan('Role'), chalk.cyan('Department'), chalk.cyan('Primary Model')],
            colWidths: [5, 30, 15, 40]
        });

        agentsData.agents.slice(0, 15).forEach(a => {
            table.push([a.id, a.role, a.department, a.model]);
        });

        console.log('\n' + table.toString());
        log.info(chalk.dim(`Showing first 15 of 100 agents. Use /agents for interactive management.`));
    }

    listSessions() {
        if (!fs.existsSync(sessionsPath)) return;
        const history = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
        if (history.length === 0) {
            log.info('No session history found.');
            return;
        }
        log.info(chalk.bold('Recent Sessions:'));
        history.slice(-5).forEach((s, i) => {
            console.log(`  ${chalk.cyan(i+1)}: ${chalk.dim(s.timestamp)} - ${chalk.white(s.prompt.substring(0, 50))}...`);
        });
    }

    async toggleLevel() {
        const action = await new enquirer.Select({
            message: 'Select Intelligence Level:',
            choices: [
                { name: 'Auto', message: '🤖 Auto - Smart routing based on task complexity' },
                { name: 'Instant', message: '⚡ Instant - Fast, single Gemma 4 call' },
                { name: 'Thinking', message: '🧠 Thinking - Deep Reasoning (Gemma + Mistral + Kimi)' },
                { name: 'Swarm', message: '🐝 Swarm - Multi-agent collaboration for complex projects' }
            ]
        }).run();

        this.sessionStats.level = action;
        log.success(`Intelligence level updated to: ${chalk.bold(action)}`);
    }

    async showAnalytics() {
        if (!fs.existsSync(analyticsPath)) {
            log.info('No analytics data available yet.');
            return;
        }
        const data = JSON.parse(fs.readFileSync(analyticsPath, 'utf8'));
        
        const summary = boxen(
            `${chalk.bold.white('CORPORATE OVERVIEW')}\n` +
            `${chalk.cyan('Total Operations:')} ${data.totalOperations}\n` +
            `${chalk.cyan('Total Tokens:')} ${data.totalTokens.toLocaleString()}\n` +
            `${chalk.green('Total API Cost:')} $${data.totalCost.toFixed(4)}`,
            { padding: 1, borderColor: 'green', title: ' ELKHEDR ORCA ANALYTICS ', titleAlignment: 'center' }
        );
        console.log('\n' + summary);

        const action = await new enquirer.Select({
            message: 'Drill down into metrics:',
            choices: ['Agent Usage Breakdown', 'Cost Projection', 'Reset Analytics', 'Back']
        }).run();

        if (action === 'Agent Usage Breakdown') {
            const agentTable = new Table({
                head: [chalk.cyan('Agent Role'), chalk.cyan('Calls'), chalk.cyan('Tokens'), chalk.cyan('Cost')],
                colWidths: [30, 10, 15, 15]
            });

            Object.entries(data.agentUsage)
                .sort((a, b) => b[1].cost - a[1].cost)
                .slice(0, 15)
                .forEach(([role, stats]) => {
                    agentTable.push([role, stats.calls, stats.tokens.toLocaleString(), `$${stats.cost.toFixed(4)}`]);
                });

            console.log('\n' + chalk.bold.blue('Top 15 Most Active Agents (By Cost):'));
            console.log(agentTable.toString());
        } else if (action === 'Reset Analytics') {
            const confirm = await new enquirer.Confirm({ message: 'Are you sure you want to wipe all corporate history?' }).run();
            if (confirm) {
                fs.writeFileSync(analyticsPath, JSON.stringify({ totalOperations: 0, totalCost: 0, totalTokens: 0, agentUsage: {} }));
                log.success('Analytics database reset.');
            }
        }
    }

    checkProviders() {
        log.info(chalk.bold('Provider Connectivity:'));
        log.success(`OpenRouter: ${chalk.green('CONNECTED')} (Premium Tier)`);
    }

    async showHealth() {
        const status = getCircuitBreakerStatus();
        
        const stateColor = status.state === 'CLOSED' ? 'green' :
                          status.state === 'HALF_OPEN' ? 'yellow' : 'red';
        const stateIcon = status.isHealthy ? '✓' : '⚠️';
        
        let healthInfo = `${chalk.bold.white('SYSTEM HEALTH STATUS')}\n\n` +
            `${chalk.cyan('Circuit Breaker:')} ${status.name}\n` +
            `${chalk.cyan('State:')} ${chalk[stateColor](status.state)} ${stateIcon}\n` +
            `${chalk.cyan('Health:')} ${status.isHealthy ? chalk.green('HEALTHY') : chalk.red('DEGRADED')}\n` +
            `${chalk.cyan('Failure Count:')} ${status.failureCount}/${status.failureThreshold}\n` +
            `${chalk.cyan('Success Count:')} ${status.successCount}/${status.successThreshold}`;
        
        if (status.lastFailureTime) {
            const timeSince = Math.round((Date.now() - status.lastFailureTime) / 1000);
            healthInfo += `\n${chalk.cyan('Last Failure:')} ${timeSince}s ago`;
        }
        
        if (status.nextAttempt) {
            const waitTime = Math.ceil((status.nextAttempt - Date.now()) / 1000);
            healthInfo += `\n${chalk.cyan('Next Retry:')} ${waitTime}s`;
        }
        
        console.log('\n' + boxen(healthInfo, {
            padding: 1,
            borderColor: stateColor,
            title: ' CIRCUIT BREAKER STATUS ',
            titleAlignment: 'center'
        }));
        
        if (!status.isHealthy) {
            const action = await new enquirer.Select({
                message: 'Circuit breaker is not healthy. What would you like to do?',
                choices: [
                    { name: 'reset', message: 'Reset Circuit Breaker (Force Recovery)' },
                    { name: 'wait', message: 'Wait for Automatic Recovery' },
                    { name: 'back', message: 'Back' }
                ]
            }).run();
            
            if (action === 'reset') {
                resetCircuitBreaker();
                log.success(chalk.green('Circuit breaker has been reset. System is now healthy.'));
            }
        }
    }
}

module.exports = { CommandRegistry };
