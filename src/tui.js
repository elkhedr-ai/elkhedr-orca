#!/usr/bin/env node
const { intro, outro, text, spinner, note, log, isCancel } = require('@clack/prompts');
const chalk = require('chalk');
const boxen = require('boxen');
const gradient = require('gradient-string');
const { orchestrate } = require('./index.js');
const fs = require('fs');
const path = require('path');

async function showSplash() {
    const splash = `
    _______  ___      ___   ___  __   __  _______  ______    ______      _______  ______    _______  _______ 
   |       ||   |    |   | |   ||  | |  ||       ||    _ |  |      |    |       ||    _ |  |       ||   _   |
   |    ___||   |    |   |_|   ||  |_|  ||    ___||   | ||  |  _    |   |   _   ||   | ||  |       ||  |_|  |
   |   |___ |   |    |      _  ||       ||   |___ |   |_||_ | | |   |   |  | |  ||   |_||_ |       ||       |
   |    ___||   |___ |     |_| ||       ||    ___||    __  || |_|   |   |  |_|  ||    __  ||      _||       |
   |   |___ |       ||    _  |  |   _   ||   |___ |   |  | ||       |   |       ||   |  | ||     |_ |   _   |
   |_______||_______||___| |_|  |__| |__||_______||___|  |_||______|    |_______||___|  |_||_______||__| |__|
    `;
    console.log(gradient.cyan.blue(splash));
    console.log(chalk.blue.bold('\n   Corporate Ecosystem Orchestrator | 100 Specialized Agents | Elkhedr OS\n'));
}

async function interactiveSession() {
    await showSplash();
    
    intro(chalk.bgBlue.white.bold(' ORCA INTERACTIVE TUI '));

    while (true) {
        const query = await text({
            message: chalk.cyan('What should the team do?'),
            placeholder: 'e.g., Build a landing page and write an SEO strategy',
            validate(value) {
                if (value.length === 0) return `Value is required!`;
            },
        });

        if (isCancel(query)) {
            outro(chalk.yellow('Orca system standing down. Goodbye!'));
            process.exit(0);
        }

        const s = spinner();
        s.start(chalk.yellow('CEO is analyzing and delegating tasks...'));

        try {
            const result = await orchestrate(query, (event) => {
                if (event.type === 'agent_start') {
                    s.message(chalk.blue(`[${event.agent}] `) + chalk.white(event.task));
                } else if (event.type === 'status') {
                    s.message(chalk.yellow(event.message));
                }
            });
            s.stop(chalk.green('Task Completed!'));
            
            console.log(boxen(result, {
                padding: 1,
                margin: 1,
                borderStyle: 'round',
                borderColor: 'cyan',
                title: chalk.bold.blue('FINAL REPORT'),
                titleAlignment: 'center'
            }));
        } catch (error) {
            s.stop(chalk.red('Orchestration Failed'));
            log.error(error.message);
        }
    }
}

if (require.main === module) {
    interactiveSession().catch(console.error);
}

module.exports = { interactiveSession };
