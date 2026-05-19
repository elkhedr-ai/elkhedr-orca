/**
 * SwarmExecutor
 * Executes parallel agent tasks with timeout, result aggregation, and conflict resolution.
 */

// callOpenRouter is injected at runtime to avoid circular dependency
let _callOpenRouter = null;

const { logger } = require('../utils/logger.js');
const voting = require('./strategies/voting.js');
const bestOfN = require('./strategies/best-of-n.js');
const synthesis = require('./strategies/synthesis.js');
const { detectConflicts, buildResolutionPrompt } = require('./conflict.js');

const STRATEGIES = {
  voting: { name: 'voting', handler: voting },
  'best-of-n': { name: 'best-of-n', handler: bestOfN },
  synthesis: { name: 'synthesis', handler: synthesis }
};

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Set the callOpenRouter function (injected from core.js to avoid circular deps).
 * @param {function} fn
 */
function setCallOpenRouter(fn) {
  _callOpenRouter = fn;
}

/**
 * @typedef {object} SwarmPlan
 * @property {string} task - The task for this swarm group
 * @property {Array<{agentId: number, role: string, model: string}>} agents
 * @property {string} [strategy=voting] - Aggregation strategy
 * @property {number} [timeout=30000] - Per-agent timeout in ms
 * @property {boolean} [sandbox=false] - Sandbox mode for agent calls
 * @property {object} [sessionStats] - Session stats forwarded to agent calls
 */

/**
 * Execute a swarm of agents in parallel and aggregate results.
 * @param {SwarmPlan} swarmPlan
 * @param {object} options
 * @param {function} [options.onEvent] - Event callback for progress
 * @param {function} [options.callAgent] - Override for agent call function (testing)
 * @returns {Promise<{result: string, agentResults: Array, strategy: string, conflicts: Array, metadata: object}>}
 */
async function executeSwarm(swarmPlan, options = {}) {
  const {
    task,
    agents = [],
    strategy = 'voting',
    timeout = DEFAULT_TIMEOUT_MS,
    sandbox = false,
    sessionStats = {}
  } = swarmPlan;

  const { onEvent, callAgent } = options;

  if (agents.length === 0) {
    throw new Error('Swarm plan must have at least one agent');
  }

  if (onEvent) onEvent({ type: 'swarm_start', task, agentCount: agents.length, strategy });

  // Run all agents in parallel with individual timeouts
  const agentPromises = agents.map(agent =>
    runAgentWithTimeout(agent, task, timeout, sandbox, sessionStats, onEvent, callAgent)
  );

  const settled = await Promise.allSettled(agentPromises);

  // Collect results and failures
  const results = [];
  const failures = [];

  for (let i = 0; i < settled.length; i++) {
    const s = settled[i];
    if (s.status === 'fulfilled') {
      if (s.value) {
        results.push(s.value);
      } else {
        failures.push({ agentId: agents[i].agentId, role: agents[i].role, reason: 'Empty response' });
      }
    } else {
      failures.push({ agentId: agents[i].agentId, role: agents[i].role, reason: s.reason?.message || 'Unknown error' });
    }
  }

  if (onEvent) {
    onEvent({ type: 'swarm_complete', successful: results.length, failed: failures.length });
  }

  if (results.length === 0) {
    throw new Error('All agents failed in swarm execution', { cause: { failures } });
  }

  // Detect conflicts before aggregation
  const conflicts = detectConflicts(results);

  // Aggregate results using chosen strategy
  const strategyModule = STRATEGIES[strategy];
  if (!strategyModule) {
    throw new Error(`Unknown aggregation strategy: ${strategy}. Use: ${Object.keys(STRATEGIES).join(', ')}`);
  }

  let aggregationResult;

  if (strategy === 'voting') {
    const voteResult = strategyModule.handler.aggregate(results);
    aggregationResult = {
      result: voteResult.result,
      votes: voteResult.votes,
      winner: voteResult.winner,
      tieBroken: voteResult.tieBroken,
      agentVotes: voteResult.agentVotes
    };
  } else if (strategy === 'best-of-n') {
    const scored = strategyModule.handler.aggregate(results, { task });
    aggregationResult = {
      result: scored.result,
      scores: scored.scores,
      winner: scored.winner
    };
  } else if (strategy === 'synthesis') {
    const merged = strategyModule.handler.aggregate(results, { task });

    if (merged.metadata?.singleOutput) {
      aggregationResult = { result: merged.synthesisPrompt, synthesisDone: false };
    } else if (_callOpenRouter) {
      const synthesized = await mergeViaLLM(merged.synthesisPrompt);
      aggregationResult = { result: synthesized, synthesisDone: true };
    } else {
      aggregationResult = { result: merged.synthesisPrompt, synthesisDone: false };
    }
  }

  return {
    result: aggregationResult.result,
    agentResults: results,
    failures: failures.length > 0 ? failures : undefined,
    strategy,
    conflicts,
    metadata: {
      agentCount: agents.length,
      successfulCount: results.length,
      failedCount: failures.length
    }
  };
}

/**
 * Run a single agent with timeout.
 * @returns {Promise<{agentId: number, role: string, output: string}>}
 */
async function runAgentWithTimeout(agent, task, timeoutMs, sandbox, sessionStats, onEvent, callAgentOverride) {
  const startTime = Date.now();

  if (onEvent) {
    onEvent({ type: 'agent_start', agentId: agent.agentId, role: agent.role });
  }

  const execute = async () => {
    let output;

    if (callAgentOverride) {
      output = await callAgentOverride(agent, task);
    } else if (_callOpenRouter) {
      const agentPrompt = [
        `You are ${agent.role}. Your task: "${task}"`,
        '',
        'Provide your expert analysis and solution. Be specific and actionable.'
      ].join('\n');

      const response = await _callOpenRouter(
        agent.model,
        [{ role: 'user', content: agentPrompt }],
        null,
        sandbox,
        agent.role,
        false
      );

      output = response?.content || '';
    } else {
      output = `[${agent.role}] Mock response for: ${task.substring(0, 80)}`;
    }

    const latency = Date.now() - startTime;
    if (onEvent) {
      onEvent({
        type: 'agent_complete',
        agentId: agent.agentId,
        role: agent.role,
        latency,
        outputLength: output.length
      });
    }

    return { agentId: agent.agentId, role: agent.role, output };
  };

  // Apply timeout via Promise.race
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Agent ${agent.role} timed out after ${timeoutMs}ms`)), timeoutMs)
  );

  return Promise.race([execute(), timeoutPromise]);
}

/**
 * Use injected callOpenRouter to perform LLM-based merge.
 */
async function mergeViaLLM(prompt) {
  if (!_callOpenRouter) return prompt;

  const path = require('path');
  const fs = require('fs');
  const agentsData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'agents.json'), 'utf8'));
  const orchestrator = agentsData.orchestrator;

  const response = await _callOpenRouter(
    orchestrator.model,
    [{ role: 'user', content: prompt }],
    orchestrator.fallbackModel,
    false,
    'CEO (Synthesis)',
    false
  );

  return response?.content || prompt;
}

/**
 * Execute a full swarm task with decomposition, parallel execution, and CEO synthesis.
 * @param {string} task - The user's task
 * @param {object} options
 * @param {function} [options.callOpenRouter] - Injected from core.js
 * @param {function} [options.onEvent]
 * @param {object} [options.sessionStats]
 * @param {string} [options.strategy]
 * @returns {Promise<{finalResult: string, swarmResults: Array}>}
 */
async function executeSwarmTask(task, options = {}) {
  const { callOpenRouter, onEvent, sessionStats = {}, strategy: overrideStrategy } = options;
  const startTime = Date.now();

  if (callOpenRouter) setCallOpenRouter(callOpenRouter);

  if (onEvent) onEvent({ type: 'status', message: '🧠 CEO: Decomposing task into swarm plan...' });

  // Step 1: Decompose task using CEO
  const { decompose } = require('./decomposer.js');
  const swarmPlans = await decompose(task);

  if (onEvent) onEvent({ type: 'status', message: `📋 Decomposed into ${swarmPlans.length} swarm group(s)` });

  // Step 2: Execute each swarm group sequentially
  const allResults = [];

  for (let i = 0; i < swarmPlans.length; i++) {
    const plan = swarmPlans[i];
    const strategy = overrideStrategy || selectStrategy(plan.agents.length, plan.department);

    if (onEvent) {
      onEvent({
        type: 'status',
        message: `🐝 Swarm group ${i + 1}/${swarmPlans.length}: ${plan.subtask.substring(0, 60)} (${plan.agents.length} agents, ${strategy})`
      });
    }

    const result = await executeSwarm(
      { task: plan.subtask, agents: plan.agents, strategy, sessionStats },
      { onEvent }
    );

    allResults.push({
      subtask: plan.subtask,
      department: plan.department,
      ...result
    });
  }

  // Step 3: CEO synthesis of all swarm results
  if (swarmPlans.length > 1 && _callOpenRouter) {
    if (onEvent) onEvent({ type: 'status', message: '🧠 CEO: Synthesizing swarm results...' });

    const ceoResult = await synthesizeSwarmResults(task, allResults, onEvent, sessionStats);
    return { finalResult: ceoResult, swarmResults: allResults, totalDuration: Date.now() - startTime };
  }

  return {
    finalResult: allResults[0].result,
    swarmResults: allResults,
    totalDuration: Date.now() - startTime
  };
}

/**
 * Select best aggregation strategy based on context.
 */
function selectStrategy(agentCount, department) {
  if (agentCount <= 2) return 'synthesis';
  if (department === 'Engineering' && agentCount >= 3) return 'best-of-n';
  if (agentCount >= 4) return 'voting';
  return 'synthesis';
}

/**
 * Synthesize multiple swarm group results via the CEO orchestrator model.
 */
async function synthesizeSwarmResults(task, swarmResults, onEvent, sessionStats) {
  if (!_callOpenRouter) {
    return swarmResults.map(sr => `## ${sr.subtask}\n${sr.result}`).join('\n\n');
  }

  const path = require('path');
  const fs = require('fs');
  const agentsData = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'agents.json'), 'utf8'));
  const orchestrator = agentsData.orchestrator;

  const sections = swarmResults.map((sr, i) =>
    `## Swarm Group ${i + 1}: ${sr.subtask}\n` +
    `Strategy: ${sr.strategy} | Agents: ${sr.metadata.agentCount}\n` +
    sr.result
  ).join('\n\n');

  const synthesisPrompt = [
    `You are the Super Orchestrator (CEO). Original task: "${task}"`,
    '',
    'Below are the results from your swarm execution groups. Synthesize them into a single coherent final response.',
    '',
    sections,
    '',
    'Provide the final synthesized answer to the original task. Include key findings and any noted conflicts:'
  ].join('\n');

  const response = await _callOpenRouter(
    orchestrator.model,
    [{ role: 'user', content: synthesisPrompt }],
    orchestrator.fallbackModel,
    sessionStats.sandbox,
    'CEO (Synthesis)',
    false
  );

  return response?.content || 'Synthesis failed';
}

module.exports = {
  executeSwarm,
  executeSwarmTask,
  runAgentWithTimeout,
  setCallOpenRouter,
  STRATEGIES,
  DEFAULT_TIMEOUT_MS
};
