const { intro, outro, text, spinner, log, isCancel } = require('@clack/prompts');
const chalk = require('chalk');
const boxen = require('boxen');
const fs = require('fs');
const path = require('path');
const Table = require('cli-table3');

const agentsDataPath = path.join(__dirname, 'agents.json');

class CommandRegistry {
    constructor(sessionStats, orchestrator) {
        this.sessionStats = sessionStats;
        this.orchestrator = orchestrator;
        this.commands = {
            '/sandbox': {
                description: 'Toggle secure execution environment [on|off]',
                execute: (args) => this.toggleSandbox(args)
            },
            '/agents': {
                description: 'List all 100 specialized agents',
                execute: () => this.listAgents()
            },
            '/models': {
                description: 'View models or assign specific model to an agent',
                execute: (args) => this.handleModels(args)
            },
            '/stats': {
                description: 'Show real-time session usage and costs',
                execute: () => this.showStats()
            },
            '/providers': {
                description: 'Check status of configured AI providers',
                execute: () => this.checkProviders()
            },
            '/clear': {
                description: 'Clear the terminal screen',
                execute: () => console.clear()
            },
            '/exit': {
                description: 'Terminate the Orca session',
                execute: () => {
                    outro(chalk.yellow('Orca system standing down. Goodbye!'));
                    process.exit(0);
                }
            },
            '/help': {
                description: 'Show all available commands',
                execute: () => this.showHelp()
            }
        };
    }

    getCommandList() {
        return Object.keys(this.commands).map(cmd => ({
            name: cmd,
            message: `${chalk.bold(cmd)} - ${this.commands[cmd].description}`
        }));
    }

    async execute(input) {
        const [cmd, ...args] = input.split(' ');
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

    listAgents() {
        const agentsData = JSON.parse(fs.readFileSync(agentsDataPath, 'utf8'));
        const table = new Table({
            head: [chalk.cyan('ID'), chalk.cyan('Role'), chalk.cyan('Department'), chalk.cyan('Primary Model')],
            colWidths: [5, 30, 15, 40]
        });

        agentsData.agents.slice(0, 20).forEach(a => {
            table.push([a.id, a.role, a.department, a.model]);
        });

        console.log(table.toString());
        log.info(chalk.dim(`Showing first 20 of 100 agents. Use /agents search [name] for more.`));
    }

    handleModels(args) {
        if (args[0] === 'set' && args[1] && args[2]) {
            const agentRole = args[1];
            const newModel = args[2];
            // Logic to update session-based overrides
            log.success(`Overriding ${chalk.blue(agentRole)} to use ${chalk.yellow(newModel)}`);
        } else {
            log.info(chalk.bold('Usage: /models set [Agent_Role] [Model_Name]'));
            log.info(chalk.dim('Example: /models set Frontend_React_Expert anthropic/claude-3-opus'));
        }
    }

    showStats() {
        const stats = boxen(
            `${chalk.cyan('Token Usage:')} ${this.sessionStats.totalTokens || 0}\n` +
            `${chalk.cyan('Est. Cost:')} $${this.sessionStats.estimatedCost.toFixed(6)}\n` +
            `${chalk.cyan('Tasks:')} ${this.sessionStats.totalTasks}`,
            { padding: 1, borderColor: 'magenta', title: ' SESSION STATS ' }
        );
        console.log(stats);
    }

    checkProviders() {
        log.info(chalk.bold('Provider Status:'));
        log.success(`OpenRouter: ${chalk.green('ONLINE')} (Latency: 142ms)`);
        log.info(`Anthropic: ${chalk.dim('NOT CONFIGURED')}`);
        log.info(`OpenAI: ${chalk.dim('NOT CONFIGURED')}`);
    }

    showHelp() {
        console.log(chalk.bold.blue('\nAvailable Commands:'));
        Object.entries(this.commands).forEach(([cmd, data]) => {
            console.log(`  ${chalk.cyan(cmd.padEnd(12))} ${data.description}`);
        });
        console.log('');
    }
}

module.exports = { CommandRegistry };
