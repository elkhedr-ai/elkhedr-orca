/**
 * CLI argument parsing with Commander
 */

const { Command } = require('commander');
const fs = require('fs');
const path = require('path');
const { version } = require('../../package.json');

const program = new Command();

program
  .name('orca')
  .description('Elkhedr Orca - Multi-Agent Orchestration System')
  .version(version, '-v, --version', 'Display version number')
  .option('-c, --config <path>', 'Path to custom configuration file')
  .option('--verbose', 'Enable verbose logging')
  .option('-l, --level <level>', 'Set intelligence level (Auto|Instant|Thinking|Swarm)', 'Auto')
  .option('--no-sandbox', 'Disable sandbox mode')
  .option('--agent <id>', 'Run in direct agent mode with specific agent ID')
  .argument('[prompt...]', 'Task prompt to execute')
  .helpOption('-h, --help', 'Display help information');

/**
 * Parse CLI arguments and return options
 * @returns {Object} Parsed options and arguments
 */
function parseArgs(argv) {
  program.parse(argv);
  
  const options = program.opts();
  const args = program.args;
  
  // Handle verbose flag
  if (options.verbose) {
    process.env.ORCA_LOG_LEVEL = 'debug';
  }
  
  // Handle config file
  if (options.config) {
    const configPath = path.resolve(options.config);
    if (!fs.existsSync(configPath)) {
      console.error(`❌ Configuration file not found: ${configPath}`);
      process.exit(1);
    }
    process.env.ORCA_CONFIG_PATH = configPath;
  }
  
  return {
    options,
    prompt: args.length > 0 ? args.join(' ') : null,
    isInteractive: args.length === 0 && !options.agent
  };
}

/**
 * Display help with examples
 */
function displayHelp() {
  console.log(`
${program.description()}

Usage:
  orca [options] [prompt...]           Execute a task prompt
  orca                                 Start interactive TUI mode

Options:
  -v, --version                        Display version number
  -c, --config <path>                  Use custom configuration file
  --verbose                            Enable verbose debug logging
  -l, --level <level>                  Set intelligence level: Auto, Instant, Thinking, Swarm (default: Auto)
  --no-sandbox                         Disable sandbox restrictions
  --agent <id>                         Run in direct agent mode with specific agent
  -h, --help                           Display help

Examples:
  orca "Build a React app"             Execute in CLI mode
  orca -l Swarm "Complex project"      Use Swarm intelligence level
  orca --agent 5 "API design"          Talk to Backend Node.js Lead directly
  orca --verbose                       Start TUI with debug logging
  orca -c ./my-config.json             Use custom configuration
  `);
}

module.exports = {
  parseArgs,
  displayHelp,
  program
};
