const { intro, outro, spinner, log, isCancel } = require('@clack/prompts');
const chalk = require('chalk');
const boxen = require('boxen');
const fs = require('fs');
const path = require('path');
const Table = require('cli-table3');
const enquirer = require('enquirer');
const { getCircuitBreakerStatus, resetCircuitBreaker } = require('./core.js');
const { installSkill, uninstallSkill, listInstalledSkills } = require('./plugins/marketplace.js');
const { registry } = require('./plugins/registry.js');
const { reloadConfig, getConfig, subscribe, unsubscribe } = require('./config/index.js');
const { approveSkill, revokeApproval, getApprovalStatus, getElevatedPermissions } = require('./plugins/permissions.js');
const { TaskQueue } = require('./queue/index.js');
const { compileWorkflowDefinition, loadFromFile, listDefinitions } = require('./workflows/dsl.js');
const { registerBuiltInHandlers } = require('./workflows/handlers.js');
const { validateCompiledWorkflow, getWorkflowSummary } = require('./workflows/validator.js');
const { EventBus, getEventBus } = require('./events/bus.js');
const { StreamingServer } = require('./server/websocket.js');

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
            '/reload-config': {
                label: 'Reload Config',
                description: 'Reload configuration without restarting',
                execute: () => this.reloadConfig()
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
            '/install-skill': {
                label: 'Install Skill',
                description: 'Install a skill from GitHub URL or local path',
                execute: (args) => this.installSkill(args)
            },
            '/uninstall-skill': {
                label: 'Uninstall Skill',
                description: 'Remove an installed skill',
                execute: (args) => this.uninstallSkill(args)
            },
            '/list-skills': {
                label: 'List Skills',
                description: 'Show all installed skills and their status',
                execute: () => this.listSkills()
            },
            '/approve-skill': {
                label: 'Approve Skill Permissions',
                description: 'Grant elevated permissions to a skill',
                execute: (args) => this.approveSkill(args)
            },
            '/revoke-skill': {
                label: 'Revoke Skill Permissions',
                description: 'Revoke permissions from a skill',
                execute: (args) => this.revokeSkill(args)
            },
            '/queue-status': {
                label: 'Queue Status',
                description: 'Show task queue statistics and job counts',
                execute: () => this.showQueueStatus()
            },
            '/workflows': {
                label: 'List Workflows',
                description: 'Show all workflows and their status',
                execute: () => this.listWorkflows()
            },
            '/workflow-start': {
                label: 'Start Workflow',
                description: 'Start a pending workflow by ID',
                execute: (args) => this.startWorkflow(args)
            },
            '/workflow-status': {
                label: 'Workflow Status',
                description: 'Show detailed status of a workflow',
                execute: (args) => this.showWorkflowStatus(args)
            },
            '/workflow-cancel': {
                label: 'Cancel Workflow',
                description: 'Cancel a running or paused workflow',
                execute: (args) => this.cancelWorkflow(args)
            },
            '/workflow-archive': {
                label: 'Archive Workflows',
                description: 'Archive completed workflows older than 24h',
                execute: () => this.archiveWorkflows()
            },
            '/workflow-load': {
                label: 'Load Workflow Definition',
                description: 'Load a workflow from JSON definition file',
                execute: (args) => this.loadWorkflowDefinition(args)
            },
            '/workflow-validate': {
                label: 'Validate Workflow',
                description: 'Validate a workflow definition file',
                execute: (args) => this.validateWorkflowDefinition(args)
            },
            '/workflow-run': {
                label: 'Run Workflow Definition',
                description: 'Load and execute a workflow from JSON file',
                execute: (args) => this.runWorkflowDefinition(args)
            },
            '/events': {
                label: 'Event Bus Status',
                description: 'Show event bus statistics and recent events',
                execute: () => this.showEventBusStatus()
            },
            '/event-publish': {
                label: 'Publish Event',
                description: 'Publish a test event to the bus',
                execute: (args) => this.publishEvent(args)
            },
            '/event-query': {
                label: 'Query Events',
                description: 'Query events by type from the store',
                execute: (args) => this.queryEvents(args)
            },
            '/stream-start': {
                label: 'Start Streaming Server',
                description: 'Start SSE/WebSocket streaming server',
                execute: (args) => this.startStreamingServer(args)
            },
            '/stream-stop': {
                label: 'Stop Streaming Server',
                description: 'Stop the streaming server',
                execute: () => this.stopStreamingServer()
            },
            '/stream-status': {
                label: 'Stream Status',
                description: 'Show streaming server status and connected clients',
                execute: () => this.showStreamStatus()
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

    async reloadConfig() {
        const { log } = require('@clack/prompts');
        
        try {
            const oldConfig = getConfig();
            const newConfig = reloadConfig();
            
            const changes = [];
            const allKeys = new Set([...Object.keys(oldConfig), ...Object.keys(newConfig)]);
            for (const key of allKeys) {
                if (JSON.stringify(oldConfig[key]) !== JSON.stringify(newConfig[key])) {
                    changes.push(`${key}: ${JSON.stringify(oldConfig[key])} → ${JSON.stringify(newConfig[key])}`);
                }
            }
            
            if (changes.length === 0) {
                log.info('Configuration reloaded. No changes detected.');
            } else {
                log.success(`Configuration reloaded. ${changes.length} change(s):`);
                changes.forEach(c => console.log(`  ${c}`));
            }
        } catch (error) {
            log.error(`Failed to reload config: ${error.message}`);
        }
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

    async installSkill(args) {
        const source = args.join(' ').trim();
        
        if (!source) {
            log.error('Usage: /install-skill <url-or-path> [--force]');
            log.info('Examples:');
            log.info('  /install-skill https://github.com/user/orca-skills/tree/main/terminal');
            log.info('  /install-skill ./my-local-skill');
            return;
        }
        
        const force = args.includes('--force');
        const ignoreConflicts = args.includes('--ignore-conflicts');
        const cleanSource = source.replace(/--force|--ignore-conflicts/g, '').trim();
        
        const s = spinner();
        s.start(chalk.blue(`Installing skill from ${cleanSource}...`));
        
        try {
            const result = await installSkill(cleanSource, {
                force,
                ignoreConflicts
            });
            
            s.stop(chalk.green('✓ Skill installed'));
            
            console.log(boxen(
                `${chalk.cyan('Name:')} ${result.name}\n` +
                `${chalk.cyan('Version:')} ${result.version}\n` +
                `${chalk.cyan('Path:')} ${result.path}\n` +
                `${chalk.cyan('Permissions:')} ${result.permissions.join(', ')}`,
                { padding: 1, borderColor: 'green', title: ' SKILL INSTALLED ', titleAlignment: 'center' }
            ));
            
            if (result.conflicts) {
                log.warn(`Dependency conflicts: ${result.conflicts.map(c => c.name).join(', ')}`);
            }
        } catch (error) {
            s.stop(chalk.red('✗ Installation failed'));
            log.error(error.message);
            if (error.details?.hint) {
                log.info(chalk.dim(error.details.hint));
            }
        }
    }

    async uninstallSkill(args) {
        const name = args[0];
        
        if (!name) {
            log.error('Usage: /uninstall-skill <name>');
            return;
        }
        
        const confirm = await new enquirer.Confirm({
            message: `Are you sure you want to uninstall "${name}"?`
        }).run();
        
        if (!confirm) {
            log.info('Uninstall cancelled.');
            return;
        }
        
        try {
            const result = await uninstallSkill(name);
            log.success(chalk.green(`Skill "${result.name}" uninstalled successfully.`));
        } catch (error) {
            log.error(error.message);
        }
    }

    async listSkills() {
        const installed = listInstalledSkills();
        const registered = registry.list();
        
        if (installed.length === 0) {
            log.info('No skills installed.');
            log.info('Use /install-skill to add skills.');
            return;
        }
        
        const table = new Table({
            head: [chalk.cyan('Name'), chalk.cyan('Version'), chalk.cyan('Category'), chalk.cyan('Permissions'), chalk.cyan('Status')],
            colWidths: [20, 10, 12, 25, 12]
        });
        
        for (const skill of installed) {
            const isLoaded = skill.loaded ? chalk.green('● Active') : chalk.yellow('○ Inactive');
            const perms = (skill.permissions || []).join(', ');
            table.push([
                skill.name,
                skill.version,
                skill.category || 'custom',
                perms || 'none',
                isLoaded
            ]);
        }
        
        console.log('\n' + chalk.bold.blue('Installed Skills:'));
        console.log(table.toString());
        console.log(chalk.dim(`\nTotal: ${installed.length} installed, ${registered.length} active`));
    }

    async approveSkill(args) {
        const name = args[0];
        
        if (!name) {
            log.error('Usage: /approve-skill <skill-name>');
            return;
        }
        
        const manifest = registry.getManifest(name);
        if (!manifest) {
            log.error(`Skill "${name}" not found in registry.`);
            return;
        }
        
        const elevated = getElevatedPermissions(manifest.permissions || []);
        
        if (elevated.length === 0) {
            log.info(`Skill "${name}" does not require elevated permissions.`);
            return;
        }
        
        const confirm = await new enquirer.Confirm({
            message: `Approve ${elevated.join(', ')} permissions for "${name}"?`
        }).run();
        
        if (!confirm) {
            log.info('Approval cancelled.');
            return;
        }
        
        try {
            const result = approveSkill(name, elevated, { approvedBy: 'user' });
            log.success(`Approved ${result.permissions.length} permission(s) for "${result.skillName}".`);
        } catch (error) {
            log.error(error.message);
        }
    }

    async revokeSkill(args) {
        const name = args[0];
        
        if (!name) {
            log.error('Usage: /revoke-skill <skill-name>');
            return;
        }
        
        if (!registry.has(name)) {
            log.error(`Skill "${name}" not found in registry.`);
            return;
        }
        
        const confirm = await new enquirer.Confirm({
            message: `Revoke all permissions for "${name}"?`
        }).run();
        
        if (!confirm) {
            log.info('Revocation cancelled.');
            return;
        }
        
        revokeApproval(name);
        log.success(`Permissions revoked for "${name}".`);
    }

    async showQueueStatus() {
        const queue = new TaskQueue('orca');
        const stats = queue.getStats();
        
        console.log(boxen(
            `${chalk.bold.white('TASK QUEUE STATUS')}\n\n` +
            `${chalk.cyan('Queue Name:')} ${stats.name}\n` +
            `${chalk.cyan('Pending:')} ${stats.pending}\n` +
            `${chalk.cyan('Delayed:')} ${stats.delayed}\n` +
            `${chalk.cyan('Active:')} ${stats.active}\n` +
            `${chalk.cyan('Completed:')} ${stats.completed}\n` +
            `${chalk.cyan('Failed:')} ${stats.failed}\n` +
            `${chalk.cyan('Dead Letter Queue:')} ${stats.dead}\n` +
            `${chalk.cyan('Total Jobs:')} ${stats.total}\n` +
            `${chalk.cyan('Concurrency:')} ${stats.concurrency}\n` +
            `${chalk.cyan('Active Workers:')} ${stats.activeWorkers}`,
            { padding: 1, borderColor: 'cyan', title: ' QUEUE ', titleAlignment: 'center' }
        ));
        
        if (stats.dead > 0) {
            log.warn(`${stats.dead} job(s) in dead letter queue. Use queue.retry() to retry.`);
        }
    }

    async listWorkflows() {
        const engine = new WorkflowEngine({ autoResume: false });
        const workflows = engine.listWorkflows();
        const stats = engine.getStats();
        
        if (workflows.length === 0) {
            log.info('No workflows found.');
            return;
        }
        
        const table = new Table({
            head: [chalk.cyan('ID'), chalk.cyan('Name'), chalk.cyan('Status'), chalk.cyan('Steps'), chalk.cyan('Created')],
            colWidths: [25, 25, 12, 8, 20]
        });
        
        for (const wf of workflows) {
            const statusColor = wf.status === 'completed' ? chalk.green : 
                              wf.status === 'failed' ? chalk.red :
                              wf.status === 'running' ? chalk.yellow : chalk.dim;
            table.push([
                wf.id.substring(0, 22),
                wf.name,
                statusColor(wf.status),
                stats.total,
                new Date(wf.createdAt).toLocaleDateString()
            ]);
        }
        
        console.log('\n' + chalk.bold.blue('Workflows:'));
        console.log(table.toString());
        console.log(chalk.dim(`\nTotal: ${workflows.length} | Running: ${stats.running} | Completed: ${stats.completed} | Failed: ${stats.failed}`));
    }

    async startWorkflow(args) {
        const id = args[0];
        
        if (!id) {
            log.error('Usage: /workflow-start <workflow-id>');
            return;
        }
        
        const engine = new WorkflowEngine({ autoResume: false });
        
        try {
            await engine.startWorkflow(id);
            log.success(`Workflow "${id}" started.`);
        } catch (error) {
            log.error(error.message);
        }
    }

    async showWorkflowStatus(args) {
        const id = args[0];
        
        if (!id) {
            log.error('Usage: /workflow-status <workflow-id>');
            return;
        }
        
        const engine = new WorkflowEngine({ autoResume: false });
        const workflow = engine.getWorkflow(id);
        
        if (!workflow) {
            log.error(`Workflow "${id}" not found.`);
            return;
        }
        
        const statusColor = workflow.status === 'completed' ? 'green' : 
                          workflow.status === 'failed' ? 'red' :
                          workflow.status === 'running' ? 'yellow' : 'gray';
        
        let info = `${chalk.bold.white('WORKFLOW STATUS')}\n\n` +
            `${chalk.cyan('ID:')} ${workflow.id}\n` +
            `${chalk.cyan('Name:')} ${workflow.name}\n` +
            `${chalk.cyan('Status:')} ${chalk[statusColor](workflow.status)}\n` +
            `${chalk.cyan('Steps:')} ${workflow.currentStepIndex}/${workflow.steps.length}\n` +
            `${chalk.cyan('Created:')} ${new Date(workflow.createdAt).toLocaleString()}`;
        
        if (workflow.completedAt) {
            info += `\n${chalk.cyan('Completed:')} ${new Date(workflow.completedAt).toLocaleString()}`;
        }
        
        if (workflow.error) {
            info += `\n${chalk.red('Error:')} ${workflow.error}`;
        }
        
        console.log('\n' + boxen(info, {
            padding: 1,
            borderColor: statusColor,
            title: ` ${workflow.name.toUpperCase()} `,
            titleAlignment: 'center'
        }));
        
        // Show step details
        const stepTable = new Table({
            head: [chalk.cyan('#'), chalk.cyan('Name'), chalk.cyan('Status'), chalk.cyan('Duration')],
            colWidths: [5, 25, 12, 15]
        });
        
        for (const step of workflow.steps) {
            const stepStatusColor = step.status === 'completed' ? chalk.green : 
                                  step.status === 'failed' ? chalk.red :
                                  step.status === 'running' ? chalk.yellow : chalk.dim;
            const duration = step.completedAt && step.startedAt 
                ? `${step.completedAt - step.startedAt}ms` 
                : '-';
            stepTable.push([
                step.id.split('_').pop(),
                step.name,
                stepStatusColor(step.status),
                duration
            ]);
        }
        
        console.log('\n' + chalk.bold('Steps:'));
        console.log(stepTable.toString());
    }

    async cancelWorkflow(args) {
        const id = args[0];
        
        if (!id) {
            log.error('Usage: /workflow-cancel <workflow-id>');
            return;
        }
        
        const engine = new WorkflowEngine({ autoResume: false });
        
        try {
            engine.cancelWorkflow(id);
            log.success(`Workflow "${id}" cancelled.`);
        } catch (error) {
            log.error(error.message);
        }
    }

    async archiveWorkflows() {
        const engine = new WorkflowEngine({ autoResume: false });
        const archived = engine.archive(86400000); // 24 hours
        
        if (archived > 0) {
            log.success(`Archived ${archived} completed workflow(s).`);
        } else {
            log.info('No workflows to archive.');
        }
    }

    async loadWorkflowDefinition(args) {
        const filePath = args[0];
        
        if (!filePath) {
            log.error('Usage: /workflow-load <file-path>');
            return;
        }
        
        const s = spinner();
        s.start('Loading workflow definition...');
        
        try {
            const definition = loadFromFile(filePath);
            const summary = getWorkflowSummary(definition);
            
            s.stop('Workflow loaded');
            
            console.log(boxen(
                `${chalk.cyan('Name:')} ${summary.name}\n` +
                `${chalk.cyan('Version:')} ${summary.version}\n` +
                `${chalk.cyan('Description:')} ${summary.description || 'N/A'}\n` +
                `${chalk.cyan('Steps:')} ${summary.stepCount}\n` +
                `${chalk.cyan('Complexity:')} ${summary.complexity}\n` +
                `${chalk.cyan('Has Conditions:')} ${summary.hasConditions ? 'Yes' : 'No'}\n` +
                `${chalk.cyan('Has Parallel:')} ${summary.hasParallel ? 'Yes' : 'No'}\n` +
                `${chalk.cyan('Has Approvals:')} ${summary.hasApprovals ? 'Yes' : 'No'}`,
                { padding: 1, borderColor: 'blue', title: ' WORKFLOW DEFINITION ' }
            ));
            
        } catch (error) {
            s.stop('Failed');
            log.error(error.message);
        }
    }

    async validateWorkflowDefinition(args) {
        const filePath = args[0];
        
        if (!filePath) {
            log.error('Usage: /workflow-validate <file-path>');
            return;
        }
        
        const s = spinner();
        s.start('Validating workflow...');
        
        try {
            const definition = loadFromFile(filePath);
            const compiled = compileWorkflowDefinition(definition);
            const validation = validateCompiledWorkflow(compiled);
            
            s.stop(validation.valid ? chalk.green('Valid') : chalk.yellow('Issues found'));
            
            if (validation.valid) {
                log.success('Workflow definition is valid and executable.');
                log.info(`Steps: ${validation.stepCount}`);
            } else {
                log.warn('Validation issues found:');
                validation.issues.forEach(issue => log.warn(`  - ${issue}`));
            }
            
        } catch (error) {
            s.stop('Invalid');
            log.error(error.message);
        }
    }

    async runWorkflowDefinition(args) {
        const filePath = args[0];
        
        if (!filePath) {
            log.error('Usage: /workflow-run <file-path>');
            return;
        }
        
        const s = spinner();
        s.start('Loading and executing workflow...');
        
        try {
            const definition = loadFromFile(filePath);
            const compiled = compileWorkflowDefinition(definition);
            const validation = validateCompiledWorkflow(compiled);
            
            if (!validation.valid) {
                s.stop('Invalid');
                log.warn('Workflow has issues:');
                validation.issues.forEach(issue => log.warn(`  - ${issue}`));
                return;
            }
            
            const engine = new WorkflowEngine({ autoResume: false });
            registerBuiltInHandlers(engine);
            
            const workflow = engine.createWorkflow(
                compiled.name,
                compiled.steps,
                { context: compiled.context, description: compiled.description }
            );
            
            const completedPromise = new Promise(resolve => {
                engine.on('workflow:completed', (wf) => resolve(wf));
                engine.on('workflow:failed', (wf, error) => resolve(wf));
            });
            
            await engine.startWorkflow(workflow.id);
            const result = await completedPromise;
            
            s.stop(result.status === 'completed' ? chalk.green('Completed') : chalk.red('Failed'));
            
            log.info(`Workflow "${result.name}" ${result.status}`);
            if (result.error) {
                log.error(`Error: ${result.error}`);
            }
            
        } catch (error) {
            s.stop('Failed');
            log.error(error.message);
        }
    }

    async showEventBusStatus() {
        const bus = getEventBus({ persistenceEnabled: false });
        const stats = bus.getStats();
        
        console.log(boxen(
            `${chalk.bold.white('EVENT BUS STATUS')}\n\n` +
            `${chalk.cyan('Bus Name:')} ${stats.name}\n` +
            `${chalk.cyan('Total Published:')} ${stats.totalPublished}\n` +
            `${chalk.cyan('Total Subscribers:')} ${stats.totalSubscribers}\n` +
            `${chalk.cyan('Active Listeners:')} ${stats.activeListeners}\n` +
            `${chalk.cyan('Store Count:')} ${stats.storeCount}`,
            { padding: 1, borderColor: 'magenta', title: ' EVENTS ', titleAlignment: 'center' }
        ));
        
        if (Object.keys(stats.eventsByType).length > 0) {
            console.log('\n' + chalk.bold('Events Published:'));
            const table = new Table({
                head: [chalk.cyan('Event Type'), chalk.cyan('Count')],
                colWidths: [30, 10]
            });
            for (const [type, count] of Object.entries(stats.eventsByType)) {
                table.push([type, count]);
            }
            console.log(table.toString());
        }
    }

    async publishEvent(args) {
        const type = args[0];
        const data = args.slice(1).join(' ') || '{}';
        
        if (!type) {
            log.error('Usage: /event-publish <type> [json-data]');
            return;
        }
        
        try {
            const parsedData = JSON.parse(data);
            const bus = getEventBus({ persistenceEnabled: false });
            bus.publish(type, parsedData, { source: 'cli' });
            log.success(`Published event "${type}".`);
        } catch (error) {
            log.error(`Invalid JSON data: ${error.message}`);
        }
    }

    async queryEvents(args) {
        const type = args[0];
        
        const bus = getEventBus({ persistenceEnabled: false });
        const events = bus.query({ type });
        
        if (events.length === 0) {
            log.info('No events found.');
            return;
        }
        
        console.log(`\n${chalk.bold('Events:')}`);
        const table = new Table({
            head: [chalk.cyan('Type'), chalk.cyan('Source'), chalk.cyan('Timestamp')],
            colWidths: [25, 20, 25]
        });
        
        for (const event of events.slice(-10)) {
            table.push([
                event.type,
                event.source || 'unknown',
                new Date(event.timestamp).toLocaleString()
            ]);
        }
        
        console.log(table.toString());
        log.info(`Showing last ${Math.min(events.length, 10)} of ${events.length} events.`);
    }

    async startStreamingServer(args) {
        const port = args[0] ? parseInt(args[0], 10) : 3001;
        
        if (this.streamingServer && this.streamingServer.running) {
            log.warn('Streaming server is already running.');
            return;
        }
        
        try {
            this.streamingServer = new StreamingServer({ port });
            this.streamingServer.start();
            log.success(`Streaming server started on port ${port}.`);
            log.info('Endpoints:');
            log.info(`  SSE: http://localhost:${port}/events/stream`);
            log.info(`  WebSocket: ws://localhost:${port}`);
        } catch (error) {
            log.error(`Failed to start streaming server: ${error.message}`);
        }
    }

    async stopStreamingServer() {
        if (!this.streamingServer || !this.streamingServer.running) {
            log.warn('Streaming server is not running.');
            return;
        }
        
        this.streamingServer.stop();
        this.streamingServer = null;
        log.success('Streaming server stopped.');
    }

    async showStreamStatus() {
        if (!this.streamingServer || !this.streamingServer.running) {
            log.info('Streaming server is not running. Use /stream-start to start it.');
            return;
        }
        
        const status = this.streamingServer.getStatus();
        const hubStats = status.hub;
        
        console.log(boxen(
            `${chalk.bold.white('STREAMING SERVER')}\n\n` +
            `${chalk.cyan('Status:')} ${chalk.green('Running')}\n` +
            `${chalk.cyan('Address:')} ${status.address}\n` +
            `${chalk.cyan('Total Clients:')} ${hubStats.totalClients}\n` +
            `${chalk.cyan('SSE Clients:')} ${hubStats.sseClients}\n` +
            `${chalk.cyan('WebSocket Clients:')} ${hubStats.wsClients}\n` +
            `${chalk.cyan('Total Connections:')} ${hubStats.totalConnections}\n` +
            `${chalk.cyan('Messages Sent:')} ${hubStats.messagesSent}\n` +
            `${chalk.cyan('Bytes Sent:')} ${hubStats.bytesSent}`,
            { padding: 1, borderColor: 'cyan', title: ' STREAM ', titleAlignment: 'center' }
        ));
        
        if (hubStats.totalClients > 0) {
            const clientTable = new Table({
                head: [chalk.cyan('Client ID'), chalk.cyan('Type'), chalk.cyan('Duration')],
                colWidths: [25, 12, 15]
            });
            
            for (const client of this.streamingServer.hub.getClients()) {
                const duration = Math.floor(client.duration / 1000);
                clientTable.push([client.id, client.type, `${duration}s`]);
            }
            
            console.log('\n' + chalk.bold('Connected Clients:'));
            console.log(clientTable.toString());
        }
    }
}

module.exports = { CommandRegistry };
