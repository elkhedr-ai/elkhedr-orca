const { exec } = require('child_process');
const { logger } = require('../../src/utils/logger.js');

/**
 * Execute a terminal command
 */
async function execute(args) {
  const { command } = args;
  
  logger.info({ command }, 'Executing terminal command');
  
  return new Promise((resolve) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        resolve(`Error: ${error.message}\nStderr: ${stderr}`);
      } else {
        resolve(stdout || "Command executed successfully (no output).");
      }
    });
  });
}

/**
 * Tool definition for OpenRouter function calling
 */
const toolDefinition = {
  type: "function",
  function: {
    name: "terminal",
    description: "Run a bash command on the user's terminal. Use this for file operations, system checks, or code execution.",
    parameters: {
      type: "object",
      properties: {
        command: { 
          type: "string", 
          description: "The bash command to run." 
        }
      },
      required: ["command"]
    }
  }
};

module.exports = {
  execute,
  toolDefinition
};
