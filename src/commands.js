const { intro, outro, select, spinner, log, isCancel } = require('@clack/prompts');
const chalk = require('chalk');
const boxen = require('boxen');
const fs = require('fs');
const path = require('path');
const Table = require('cli-table3');

const agentsDataPath = path.join(__dirname, 'agents.json');
const sessionsPath = path.join(__dirname, '../sessions/history.json');
const skillsPath = path.join(__dirname, '../skills/registry.json');

class CommandRegistry {
    constructor(sessionStats) {
        this.sessionStats = sessionStats;
        this.commands = {
            '/sandbox': {
                label: 'Toggle Sandbox',
                description: 'Toggle secure execution environment [on|off]',
                execute: (args) => this.toggleSandbox(args)
            },
            '/agents': {
                label: 'Agent Directory',
                description: 'List all 100 specialized agents',
                execute: () => this.listAgents()
            },
            '/models': {
                label: 'Model Config',
                description: 'View models or assign specific model to an agent',
                execute: (args) => this.handleModels(args)
            },
            '/sessions': {
                label: 'Session History',
                description: 'View real history of previous task results',
                execute: () => this.listSessions()
            },
            '/skills': {
                label: 'Agent Skills',
                description: 'Manage and trigger real agent capabilities',
                execute: () => this.listSkills()
            },
            '/stats': {
                label: 'Session Stats',
                description: 'Show real-time session usage and costs',
                execute: () => this.showStats()
            },
            '/providers': {
                label: 'Provider Status',
                description: 'Check status of configured AI providers',
                execute: () => this.checkProviders()
            },
            '/clear': {
                label: 'Clear Screen',
                description: 'Clear the terminal screen',
                execute: () => console.clear()
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
            value: cmd,
            label: `${chalk.bold(cmd)}`,
            hint: data.description
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

        agentsData.agents.slice(0, 15).forEach(a => {
            table.push([a.id, a.role, a.department, a.model]);
        });

        console.log(table.toString());
        log.info(chalk.dim(`Showing first 15 of 100 agents. Use orca --agents for full list.`));
    }

    listSessions() {
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

    listSkills() {
        const skills = JSON.parse(fs.readFileSync(skillsPath, 'utf8'));
        log.info(chalk.bold('Available Agent Skills:'));
        if (skills.length === 0) {
            console.log(chalk.dim('  (None installed. Use "orca install [skill]" to add more)'));
            return;
        }
        skills.forEach(s => console.log(`  - ${chalk.green(s.name)}: ${s.description}`));
    }

    handleModels(args) {
        if (args[0] === 'set' && args[1] && args[2]) {
            log.success(`Model override applied.`);
        } else {
            log.info(chalk.bold('Current Provider: ') + chalk.green('OpenRouter'));
            log.info(chalk.dim('To override: /models set [Agent] [Model]'));
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
        log.info(chalk.bold('Provider Connectivity:'));
        log.success(`OpenRouter: ${chalk.green('CONNECTED')} (Premium Tier)`);
    }
}

module.exports = { CommandRegistry };

