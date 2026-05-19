/**
 * Swarm Module — Entry Point
 * True parallel agent execution with result aggregation and conflict resolution.
 */

const { executeSwarm, executeSwarmTask, setCallOpenRouter } = require('./executor.js');
const { decompose } = require('./decomposer.js');
const { detectConflicts } = require('./conflict.js');

/**
 * Initialize the swarm module with the callOpenRouter function.
 * Must be called before execution. Injected to avoid circular dependency.
 * @param {function} callOpenRouterFn
 */
function init(callOpenRouterFn) {
  setCallOpenRouter(callOpenRouterFn);
}

/**
 * Execute a full swarm task with automatic decomposition and parallel agents.
 * @param {string} task - The task to execute
 * @param {object} options
 * @param {function} [options.onEvent]
 * @param {object} [options.sessionStats]
 * @param {string} [options.strategy]
 * @returns {Promise<object>}
 */
async function executeTask(task, options = {}) {
  return executeSwarmTask(task, options);
}

/**
 * Direct swarm execution (without decomposition).
 * Useful for targeted multi-agent tasks with explicit agent selection.
 */
async function executeDirect(swarmPlan, options = {}) {
  return executeSwarm(swarmPlan, options);
}

module.exports = {
  init,
  executeTask,
  executeDirect,
  decompose,
  detectConflicts
};
