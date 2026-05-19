const { describe, it, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');

// --- Voting Strategy Tests ---

describe('Swarm - Voting Strategy', () => {
  let voting;

  before(() => {
    voting = require('../../src/swarm/strategies/voting.js');
  });

  it('should aggregate simple votes by majority', () => {
    const results = [
      { agentId: 1, role: 'Agent 1', output: 'Vote: Option A' },
      { agentId: 2, role: 'Agent 2', output: 'Vote: Option A' },
      { agentId: 3, role: 'Agent 3', output: 'Vote: Option B' }
    ];
    const result = voting.aggregate(results);
    assert.equal(result.winner, 'Option A');
    assert.ok(result.result.includes('Option A'));
  });

  it('should handle JSON votes', () => {
    const results = [
      { agentId: 1, role: 'Agent 1', output: JSON.stringify({ vote: 'blue', confidence: 0.9 }) },
      { agentId: 2, role: 'Agent 2', output: JSON.stringify({ vote: 'blue', confidence: 0.8 }) },
      { agentId: 3, role: 'Agent 3', output: JSON.stringify({ vote: 'red', confidence: 0.7 }) }
    ];
    const result = voting.aggregate(results);
    assert.equal(result.winner, 'blue');
  });

  it('should handle numeric votes', () => {
    const results = [
      { agentId: 1, role: 'Agent 1', output: '42' },
      { agentId: 2, role: 'Agent 2', output: '42' },
      { agentId: 3, role: 'Agent 3', output: '7' }
    ];
    const result = voting.aggregate(results);
    assert.equal(result.winner, '42');
    assert.ok(result.result);
  });

  it('should return tie when votes are evenly split', () => {
    const results = [
      { agentId: 1, role: 'Agent 1', output: 'Vote: Yes' },
      { agentId: 2, role: 'Agent 2', output: 'Vote: No' }
    ];
    const result = voting.aggregate(results);
    assert.equal(result.winner, null);
    assert.ok(result.result.includes('Tie'));
  });

  it('should handle single result', () => {
    const results = [
      { agentId: 1, role: 'Agent 1', output: 'Vote: Only choice' }
    ];
    const result = voting.aggregate(results);
    assert.equal(result.winner, 'Only choice');
  });

  it('should handle empty results', () => {
    const result = voting.aggregate([]);
    assert.equal(result.winner, null);
    assert.equal(result.result, '');
  });
});

// --- Best-of-N Strategy Tests ---

describe('Swarm - Best-of-N Strategy', () => {
  let bestOfN;

  before(() => {
    bestOfN = require('../../src/swarm/strategies/best-of-n.js');
  });

  it('should score output by length and structure', () => {
    const score = bestOfN.scoreOutput('Short');
    const score2 = bestOfN.scoreOutput('This is a much longer output with more detail and substance that goes beyond one hundred characters to cross the threshold for adequate length scoring.');
    assert.ok(score2.score > score.score);
  });

  it('should detect code blocks', () => {
    const result = bestOfN.scoreOutput('A longer description that goes before the code.\n```\nconst x = 1;\nconst y = 2;\n```\nAnd some concluding remarks.');
    assert.ok(result.score > 0);
    assert.ok(result.reasons.some(r => r.includes('code')));
  });

  it('should prefer outputs with confidence keywords', () => {
    const score = bestOfN.scoreOutput('This is definitely the correct answer with certainty');
    const score2 = bestOfN.scoreOutput('Maybe this could be an answer');
    assert.ok(score.score > score2.score);
  });

  it('should penalize empty outputs', () => {
    const result = bestOfN.scoreOutput('');
    assert.equal(result.score, 0);
    assert.ok(result.reasons.includes('Empty output'));
  });

  it('should select the highest-scored result', () => {
    const results = [
      { agentId: 1, role: 'Agent 1', output: 'Short' },
      { agentId: 2, role: 'Agent 2', output: 'This is a much longer detailed analysis of the problem that exceeds one hundred characters easily with all this extra padding text here.' },
      { agentId: 3, role: 'Agent 3', output: 'Medium length answer here that might also be decent' }
    ];
    const result = bestOfN.aggregate(results, {});
    assert.ok(result.result.length > 50); // Should pick the longest
  });
});

// --- Synthesis Strategy Tests ---

describe('Swarm - Synthesis Strategy', () => {
  let synthesis;

  before(() => {
    synthesis = require('../../src/swarm/strategies/synthesis.js');
  });

  it('should build a synthesis prompt containing all agent outputs', () => {
    const results = [
      { agentId: 1, role: 'Engineer', output: 'Use Redis for caching' },
      { agentId: 2, role: 'Architect', output: 'Use PostgreSQL for persistence' }
    ];
    const result = synthesis.aggregate(results, { task: 'What database?' });
    assert.ok(result.synthesisPrompt);
    assert.ok(result.synthesisPrompt.includes('Redis'));
    assert.ok(result.synthesisPrompt.includes('PostgreSQL'));
    assert.equal(result.metadata.agentCount, 2);
  });

  it('should handle empty results', () => {
    const result = synthesis.aggregate([]);
    assert.equal(result.synthesisPrompt, '');
    assert.equal(result.metadata.agentCount, 0);
  });

  it('should handle single result without merge', () => {
    const results = [
      { agentId: 1, role: 'Expert', output: 'Single answer' }
    ];
    const result = synthesis.aggregate(results);
    assert.equal(result.synthesisPrompt, 'Single answer');
    assert.ok(result.metadata.singleOutput);
  });

  it('buildSynthesisPrompt should format correctly', () => {
    const results = [
      { agentId: 1, role: 'Engineer', output: 'Build with Node.js' },
      { agentId: 2, role: 'DevOps', output: 'Deploy with Docker' }
    ];
    const prompt = synthesis.buildSynthesisPrompt('Build system', results);
    assert.ok(prompt.includes('Engineer'));
    assert.ok(prompt.includes('DevOps'));
    assert.ok(prompt.includes('Build system'));
  });
});

// --- Conflict Detection Tests ---

describe('Swarm - Conflict Detection', () => {
  let conflict;

  before(() => {
    conflict = require('../../src/swarm/conflict.js');
  });

  it('should detect binary contradictions (yes/no)', () => {
    const results = [
      { agentId: 1, role: 'Agent 1', output: 'yes' },
      { agentId: 2, role: 'Agent 2', output: 'no' }
    ];
    const conflicts = conflict.detectConflicts(results);
    assert.ok(conflicts.length > 0);
    assert.equal(conflicts[0].type, 'binary_contradiction');
  });

  it('should detect estimate divergence', () => {
    const results = [
      { agentId: 1, role: 'Agent 1', output: 'It will cost $100 hours' },
      { agentId: 2, role: 'Agent 2', output: 'It will cost $10000 hours' }
    ];
    const conflicts = conflict.detectConflicts(results);
    assert.ok(conflicts.length > 0);
    assert.equal(conflicts[0].type, 'estimate_divergence');
  });

  it('should not find conflicts in agreeing outputs', () => {
    const results = [
      { agentId: 1, role: 'Agent 1', output: 'The answer is blue' },
      { agentId: 2, role: 'Agent 2', output: 'The answer is blue as well' }
    ];
    const conflicts = conflict.detectConflicts(results);
    assert.equal(conflicts.length, 0);
  });

  it('should return empty for single result', () => {
    const conflicts = conflict.detectConflicts([{ agentId: 1, role: 'Agent 1', output: 'Only one answer' }]);
    assert.equal(conflicts.length, 0);
  });

  it('buildResolutionPrompt should return null if no conflicts', () => {
    const prompt = conflict.buildResolutionPrompt('test', [], []);
    assert.equal(prompt, null);
  });
});

// --- Decomposer Tests ---

describe('Swarm - Decomposer', () => {
  let decomposer;

  before(() => {
    decomposer = require('../../src/swarm/decomposer.js');
  });

  it('should decompose with default (no CEO) into single subtask', async () => {
    const plans = await decomposer.decompose('Build a login system');
    assert.ok(Array.isArray(plans));
    assert.ok(plans.length > 0);
    assert.ok(plans[0].subtask);
    assert.ok(Array.isArray(plans[0].agents));
  });

  it('should assign agents to the default plan', async () => {
    const plans = await decomposer.decompose('Write unit tests');
    assert.ok(plans[0].agents.length > 0);
    for (const agent of plans[0].agents) {
      assert.ok(agent.agentId !== undefined);
      assert.ok(agent.role);
    }
  });

  it('should select agents for subtask based on keywords', () => {
    const engineering = decomposer.selectAgentsForSubtask('build a function');
    assert.ok(engineering.length > 0);

    const marketing = decomposer.selectAgentsForSubtask('advertise the product');
    assert.ok(marketing.length > 0);

    const sales = decomposer.selectAgentsForSubtask('sell to customers');
    assert.ok(sales.length > 0);
  });

  it('should handle empty prompt', async () => {
    const plans = await decomposer.decompose('');
    assert.ok(Array.isArray(plans));
  });

  it('parseDecomposition should handle JSON', () => {
    const result = decomposer.parseDecomposition(
      '{"subtasks": [{"subtask": "Test task", "department": "Engineering", "agents_needed": 2}]}'
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].subtask, 'Test task');
  });

  it('parseDecomposition should handle markdown-wrapped JSON', () => {
    const result = decomposer.parseDecomposition(
      '```json\n{"subtasks": [{"subtask": "Wrapped task", "department": "Creative", "agents_needed": 1}]}\n```'
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].subtask, 'Wrapped task');
  });
});

// --- Executor Tests ---

describe('Swarm - Executor', () => {
  let executor;

  before(() => {
    executor = require('../../src/swarm/executor.js');
  });

  it('should execute swarm with mock callAgent override', async () => {
    // Reset callOpenRouter to avoid synthesis calling it
    executor.setCallOpenRouter(null);

    const callAgent = async (agent, task) => {
      return 'Mock agent response';
    };

    const result = await executor.executeSwarm(
      {
        task: 'Test task',
        agents: [{ agentId: 1, role: 'Expert', model: 'test-model' }],
        strategy: 'synthesis'
      },
      { callAgent }
    );

    assert.ok(result);
    // For single-agent synthesis, result may be an object (the raw result) or a string
    assert.ok(result.result !== undefined && result.result !== null);
    assert.equal(result.strategy, 'synthesis');
    assert.equal(result.metadata.agentCount, 1);
  });

  it('should handle multiple agents and aggregate via voting', async () => {
    executor.setCallOpenRouter(null);

    const callAgent = async (agent, task) => {
      return 'Vote: Option A';
    };

    const result = await executor.executeSwarm(
      {
        task: 'Choose option',
        agents: [
          { agentId: 1, role: 'Expert 1', model: 'test-model' },
          { agentId: 2, role: 'Expert 2', model: 'test-model' },
          { agentId: 3, role: 'Expert 3', model: 'test-model' }
        ],
        strategy: 'voting'
      },
      { callAgent }
    );

    assert.equal(result.result, 'Vote: Option A');
    assert.equal(result.strategy, 'voting');
    assert.equal(result.metadata.successfulCount, 3);
  });

  it('should handle agent failures gracefully', async () => {
    const callAgent = async (agent, task) => {
      if (agent.agentId === 1) {
        throw new Error('API failure');
      }
      return 'Survivor output';
    };

    const result = await executor.executeSwarm(
      {
        task: 'Test failures',
        agents: [
          { agentId: 1, role: 'Failing', model: 'test-model' },
          { agentId: 2, role: 'Working', model: 'test-model' }
        ],
        strategy: 'synthesis'
      },
      { callAgent }
    );

    assert.ok(result);
    assert.ok(result.result);
    assert.equal(result.metadata.successfulCount, 1);
    assert.equal(result.metadata.failedCount, 1);
  });

  it('should reject empty swarm plan', async () => {
    await assert.rejects(
      executor.executeSwarm({ task: 'test', agents: [], strategy: 'voting' }),
      { message: 'Swarm plan must have at least one agent' }
    );
  });

  it('selectStrategy constants should be correct', () => {
    assert.equal(executor.STRATEGIES.synthesis.name, 'synthesis');
    assert.equal(executor.DEFAULT_TIMEOUT_MS, 30000);
  });

  after(() => {
    executor.setCallOpenRouter(null);
  });
});

// --- Swarm Index Tests ---

describe('Swarm - Index Entry Point', () => {
  let swarm;

  before(() => {
    swarm = require('../../src/swarm/index.js');
  });

  it('should expose expected functions', () => {
    assert.equal(typeof swarm.init, 'function');
    assert.equal(typeof swarm.executeTask, 'function');
    assert.equal(typeof swarm.executeDirect, 'function');
    assert.equal(typeof swarm.decompose, 'function');
    assert.equal(typeof swarm.detectConflicts, 'function');
  });

  it('executeTask should work with mock callOpenRouter', async () => {
    swarm.init(async (model, messages) => {
      return { content: 'Mock CEO response' };
    });

    const result = await swarm.executeDirect({
      task: 'Direct test',
      agents: [{ agentId: 1, role: 'Tester', model: 'test-model' }],
      strategy: 'synthesis'
    }, { callAgent: async (a) => ({ agentId: a.agentId, role: a.role, output: 'test' }) });

    assert.ok(result);
    assert.ok(result.result);
  });
});
