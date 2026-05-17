#!/usr/bin/env node
const { orchestrate, runSingleAgent } = require('./core.js');
const { parseArgs, displayHelp } = require('./cli/args.js');
const { logger } = require('./utils/logger.js');

async function main() {
  try {
    const { options, prompt, isInteractive } = parseArgs(process.argv);
    
    logger.info({ options, hasPrompt: !!prompt }, 'Orca CLI started');

    if (options.agent) {
      // Direct agent mode
      const agentId = parseInt(options.agent);
      if (isNaN(agentId)) {
        console.error('❌ Invalid agent ID. Must be a number.');
        process.exit(1);
      }
      
      if (!prompt) {
        console.error('❌ Prompt required when using --agent mode');
        console.log('Usage: orca --agent <id> "Your prompt here"');
        process.exit(1);
      }

      console.log(`🤖 Direct Agent Mode (ID: ${agentId})`);
      const result = await runSingleAgent(agentId, prompt, null, {
        level: options.level,
        sandbox: options.sandbox
      });
      console.log(result);
      return;
    }

    if (prompt) {
      // CLI single-shot mode
      const result = await orchestrate(prompt, null, {
        level: options.level,
        sandbox: options.sandbox !== false
      });
      console.log(result);
      return;
    }

    if (isInteractive) {
      // Interactive TUI mode
      const { interactiveSession } = require('./tui.js');
      await interactiveSession();
    }
  } catch (error) {
    logger.error({ error: error.message, stack: error.stack }, 'Unhandled error in main');
    console.error(`❌ Error: ${error.message}`);
    try {
      const { getConfig } = require('./config/index.js');
      if (getConfig().ORCA_LOG_LEVEL === 'debug') {
        console.error(error.stack);
      }
    } catch {
      // Config not loaded, don't show stack
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { orchestrate, runSingleAgent, main };
