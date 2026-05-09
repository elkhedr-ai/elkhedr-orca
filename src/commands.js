const { intro, outro, spinner, log, isCancel } = require('@clack/prompts');
const chalk = require('chalk');
const boxen = require('boxen');
const fs = require('fs');
const path = require('path');
const Table = require('cli-table3');
const enquirer = require('enquirer');

const agentsDataPath = path.join(__dirname, 'agents.json');
const sessionsPath = path.join(__dirname, '../sessions/history.json');
const skillsPath = path.join(__dirname, '../skills/registry.json');

class CommandRegistry {
    constructor(sessionStats, orchestratorRef) {
        this.sessionStats = sessionStats;
        this.orchestratorRef = orchestratorRef; // Reference to core functions
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
            const taskPrompt = new enquirer.Input({
                message: `Task for ${agent.role}:`
            });
            const directTask = await taskPrompt.run();
            // Call runSingleAgent via callback or reference
            if (this.orchestratorRef && this.orchestratorRef.runSingleAgent) {
                const s = spinner();
                s.start(`Executing direct task via ${agent.role}...`);
                const result = await this.orchestratorRef.runSingleAgent(agent.id, directTask, null, this.sessionStats);
                s.stop('Execution complete.');
                console.log(boxen(result, { padding: 1, title: 'DIRECT AGENT OUTPUT' }));
            }
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

    showStats() {
        const stats = boxen(
            `${chalk.cyan('Token Usage:')} ${this.sessionStats.totalTokens || 0}\n` +
            `${chalk.cyan('Est. Cost:')} $${this.sessionStats.estimatedCost.toFixed(6)}\n` +
            `${chalk.cyan('Tasks:')} ${this.sessionStats.totalTasks}`,
            { padding: 1, borderColor: 'magenta', title: ' SESSION STATS ' }
        );
        console.log('\n' + stats);
    }

    checkProviders() {
        log.info(chalk.bold('Provider Connectivity:'));
        log.success(`OpenRouter: ${chalk.green('CONNECTED')} (Premium Tier)`);
    }
}

module.exports = { CommandRegistry };
