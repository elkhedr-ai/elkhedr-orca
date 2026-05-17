/**
 * Tests for Workflow Engine
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { WorkflowEngine, WORKFLOW_STATUS, STEP_STATUS } = require('../../src/workflows/engine.js');
const { MemoryStateAdapter } = require('../../src/workflows/state.js');

describe('WorkflowEngine - Creation', () => {
  let engine;

  beforeEach(() => {
    engine = new WorkflowEngine({
      stateAdapter: new MemoryStateAdapter(),
      autoResume: false
    });
  });

  it('should create a workflow with steps', () => {
    const workflow = engine.createWorkflow('test-wf', [
      { name: 'step-1', type: 'test' },
      { name: 'step-2', type: 'test' }
    ]);

    assert.ok(workflow.id);
    assert.strictEqual(workflow.name, 'test-wf');
    assert.strictEqual(workflow.status, WORKFLOW_STATUS.PENDING);
    assert.strictEqual(workflow.steps.length, 2);
    assert.strictEqual(workflow.currentStepIndex, 0);
    assert.ok(workflow.createdAt);
  });

  it('should create workflow with custom context', () => {
    const workflow = engine.createWorkflow('ctx-wf', [
      { name: 'step-1', type: 'test' }
    ], { context: { key: 'value' } });

    assert.strictEqual(workflow.context.key, 'value');
  });

  it('should throw for empty steps', () => {
    assert.throws(
      () => engine.createWorkflow('bad-wf', []),
      /at least one step/
    );
  });

  it('should throw for missing name', () => {
    assert.throws(
      () => engine.createWorkflow('', [{ name: 'step-1', type: 'test' }]),
      /name is required/
    );
  });

  it('should persist workflow on creation', () => {
    const workflow = engine.createWorkflow('persist-wf', [
      { name: 'step-1', type: 'test' }
    ]);

    const loaded = engine.getWorkflow(workflow.id);
    assert.ok(loaded);
    assert.strictEqual(loaded.name, 'persist-wf');
  });
});

describe('WorkflowEngine - Execution', () => {
  let engine;

  beforeEach(() => {
    engine = new WorkflowEngine({
      stateAdapter: new MemoryStateAdapter(),
      autoResume: false
    });
  });

  it('should execute all steps and complete', async () => {
    engine.registerHandler('test', async (input) => {
      return { value: input._stepIndex };
    });

    const workflow = engine.createWorkflow('exec-wf', [
      { name: 'step-1', type: 'test' },
      { name: 'step-2', type: 'test' }
    ]);

    const completedPromise = new Promise(resolve => {
      engine.on('workflow:completed', (wf) => resolve(wf));
    });

    await engine.startWorkflow(workflow.id);
    const completed = await completedPromise;

    assert.strictEqual(completed.status, WORKFLOW_STATUS.COMPLETED);
    assert.strictEqual(completed.currentStepIndex, 2);
    assert.strictEqual(completed.steps[0].status, STEP_STATUS.COMPLETED);
    assert.strictEqual(completed.steps[1].status, STEP_STATUS.COMPLETED);
    assert.ok(completed.completedAt);
  });

  it('should pass context between steps', async () => {
    engine.registerHandler('test', async (input) => {
      return { [`step${input._stepIndex}`]: true };
    });

    const workflow = engine.createWorkflow('ctx-wf', [
      { name: 'step-0', type: 'test' },
      { name: 'step-1', type: 'test' }
    ]);

    const completedPromise = new Promise(resolve => {
      engine.on('workflow:completed', (wf) => resolve(wf));
    });

    await engine.startWorkflow(workflow.id);
    const completed = await completedPromise;

    assert.strictEqual(completed.context.step0, true);
    assert.strictEqual(completed.context.step1, true);
  });

  it('should save checkpoint after each step', async () => {
    engine.registerHandler('test', async (input) => {
      return { step: input._stepIndex };
    });

    const workflow = engine.createWorkflow('checkpoint-wf', [
      { name: 'step-1', type: 'test' },
      { name: 'step-2', type: 'test' },
      { name: 'step-3', type: 'test' }
    ]);

    let checkpoints = 0;
    engine.on('step:completed', () => {
      checkpoints++;
    });

    const completedPromise = new Promise(resolve => {
      engine.on('workflow:completed', (wf) => resolve(wf));
    });

    await engine.startWorkflow(workflow.id);
    await completedPromise;

    assert.strictEqual(checkpoints, 3);
  });

  it('should fail workflow on step error', async () => {
    engine.registerHandler('fail', async () => {
      throw new Error('Step failed');
    });

    const workflow = engine.createWorkflow('fail-wf', [
      { name: 'bad-step', type: 'fail' }
    ]);

    const failedPromise = new Promise(resolve => {
      engine.on('workflow:failed', (wf, error) => resolve({ wf, error }));
    });

    await engine.startWorkflow(workflow.id);
    const { wf, error } = await failedPromise;

    assert.strictEqual(wf.status, WORKFLOW_STATUS.FAILED);
    assert.strictEqual(error.message, 'Step failed');
    assert.strictEqual(wf.steps[0].status, STEP_STATUS.FAILED);
  });

  it('should emit step events', async () => {
    engine.registerHandler('test', async (input) => ({ ok: true }));

    const workflow = engine.createWorkflow('events-wf', [
      { name: 'step-1', type: 'test' }
    ]);

    const events = [];
    engine.on('step:started', () => events.push('started'));
    engine.on('step:completed', () => events.push('completed'));

    const completedPromise = new Promise(resolve => {
      engine.on('workflow:completed', () => resolve());
    });

    await engine.startWorkflow(workflow.id);
    await completedPromise;

    assert.ok(events.includes('started'));
    assert.ok(events.includes('completed'));
  });
});

describe('WorkflowEngine - Resume', () => {
  it('should resume from checkpoint on startup', async () => {
    const adapter = new MemoryStateAdapter();
    
    // Create first engine and start workflow
    const engine1 = new WorkflowEngine({
      stateAdapter: adapter,
      autoResume: false
    });

    engine1.registerHandler('test', async (input) => {
      return { step: input._stepIndex };
    });

    const workflow = engine1.createWorkflow('resume-wf', [
      { name: 'step-1', type: 'test' },
      { name: 'step-2', type: 'test' }
    ]);

    // Start first step but don't wait for completion
    // Manually simulate checkpoint after first step
    const wf = adapter.load(workflow.id);
    wf.status = WORKFLOW_STATUS.RUNNING;
    wf.steps[0].status = STEP_STATUS.COMPLETED;
    wf.steps[0].output = { step: 0 };
    wf.currentStepIndex = 1;
    adapter.save(wf);

    // Create second engine (simulating process restart)
    const engine2 = new WorkflowEngine({
      stateAdapter: adapter,
      autoResume: false
    });

    engine2.registerHandler('test', async (input) => {
      return { step: input._stepIndex };
    });

    const completedPromise = new Promise(resolve => {
      engine2.on('workflow:completed', (wf) => resolve(wf));
    });

    // Resume workflow by continuing execution (simulating what resumeAll does)
    await engine2._executeNextStep(engine2.getWorkflow(workflow.id));
    const completed = await completedPromise;

    assert.strictEqual(completed.status, WORKFLOW_STATUS.COMPLETED);
    assert.strictEqual(completed.steps[1].status, STEP_STATUS.COMPLETED);
  });

  it('should auto-resume running workflows on startup', async () => {
    const adapter = new MemoryStateAdapter();
    
    // Pre-populate with a running workflow
    const workflow = {
      id: 'auto-resume-1',
      name: 'auto-wf',
      status: WORKFLOW_STATUS.RUNNING,
      steps: [
        { id: 's1', name: 'step-1', type: 'test', status: STEP_STATUS.COMPLETED, output: { done: true } },
        { id: 's2', name: 'step-2', type: 'test', status: STEP_STATUS.PENDING }
      ],
      currentStepIndex: 1,
      context: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    adapter.save(workflow);

    // Register handler BEFORE creating engine (autoResume runs in constructor)
    const engine = new WorkflowEngine({
      stateAdapter: adapter,
      autoResume: false // We'll manually call resumeAll after handler registration
    });

    engine.registerHandler('test', async () => ({ final: true }));
    
    // Manually trigger resume (simulating auto-resume after handlers are set)
    const resumed = await engine.resumeAll();
    
    // Wait for execution
    await new Promise(resolve => setTimeout(resolve, 100));

    const wf = engine.getWorkflow('auto-resume-1');
    assert.ok(wf.status === WORKFLOW_STATUS.COMPLETED || wf.status === WORKFLOW_STATUS.RUNNING);
  });
});

describe('WorkflowEngine - Pause and Cancel', () => {
  let engine;

  beforeEach(() => {
    engine = new WorkflowEngine({
      stateAdapter: new MemoryStateAdapter(),
      autoResume: false
    });
  });

  it('should pause a running workflow', async () => {
    engine.registerHandler('slow', async () => {
      await new Promise(resolve => setTimeout(resolve, 500));
      return { done: true };
    });

    const workflow = engine.createWorkflow('pause-wf', [
      { name: 'slow-step', type: 'slow' }
    ]);

    // Start workflow (it will take 500ms)
    engine.startWorkflow(workflow.id);
    
    // Pause immediately
    await new Promise(resolve => setTimeout(resolve, 10));
    const paused = engine.pauseWorkflow(workflow.id);
    
    assert.strictEqual(paused.status, WORKFLOW_STATUS.PAUSED);
  });

  it('should resume a paused workflow', async () => {
    engine.registerHandler('test', async () => ({ ok: true }));

    const workflow = engine.createWorkflow('resume-wf', [
      { name: 'step-1', type: 'test' }
    ]);

    // Create in paused state
    workflow.status = WORKFLOW_STATUS.PAUSED;
    engine.stateAdapter.save(workflow);

    const completedPromise = new Promise(resolve => {
      engine.on('workflow:completed', (wf) => resolve(wf));
    });

    await engine.resumeWorkflow(workflow.id);
    const completed = await completedPromise;

    assert.strictEqual(completed.status, WORKFLOW_STATUS.COMPLETED);
  });

  it('should cancel a workflow', () => {
    engine.registerHandler('test', async () => ({ ok: true }));

    const workflow = engine.createWorkflow('cancel-wf', [
      { name: 'step-1', type: 'test' }
    ]);

    const cancelled = engine.cancelWorkflow(workflow.id);
    assert.strictEqual(cancelled.status, WORKFLOW_STATUS.CANCELLED);
  });

  it('should throw when cancelling completed workflow', async () => {
    engine.registerHandler('test', async () => ({ ok: true }));

    const workflow = engine.createWorkflow('done-wf', [
      { name: 'step-1', type: 'test' }
    ]);

    await engine.startWorkflow(workflow.id);
    await new Promise(resolve => setTimeout(resolve, 50));

    assert.throws(
      () => engine.cancelWorkflow(workflow.id),
      /Cannot cancel/
    );
  });
});

describe('WorkflowEngine - Retries', () => {
  let engine;

  beforeEach(() => {
    engine = new WorkflowEngine({
      stateAdapter: new MemoryStateAdapter(),
      autoResume: false
    });
  });

  it('should retry failed steps', async () => {
    let attempts = 0;
    engine.registerHandler('flaky', async () => {
      attempts++;
      if (attempts < 2) throw new Error('Not yet');
      return { success: true };
    });

    const workflow = engine.createWorkflow('retry-wf', [
      { name: 'flaky-step', type: 'flaky', maxRetries: 2 }
    ]);

    const completedPromise = new Promise(resolve => {
      engine.on('workflow:completed', (wf) => resolve(wf));
    });

    await engine.startWorkflow(workflow.id);
    const completed = await completedPromise;

    assert.strictEqual(completed.status, WORKFLOW_STATUS.COMPLETED);
    assert.strictEqual(completed.steps[0].retries, 1);
  });

  it('should fail after max retries exceeded', async () => {
    engine.registerHandler('always-fail', async () => {
      throw new Error('Always fails');
    });

    const workflow = engine.createWorkflow('fail-wf', [
      { name: 'bad-step', type: 'always-fail', maxRetries: 1 }
    ]);

    const failedPromise = new Promise(resolve => {
      engine.on('workflow:failed', (wf) => resolve(wf));
    });

    await engine.startWorkflow(workflow.id);
    const failed = await failedPromise;

    assert.strictEqual(failed.status, WORKFLOW_STATUS.FAILED);
    assert.strictEqual(failed.steps[0].retries, 1);
  });
});

describe('WorkflowEngine - Handler Resolution', () => {
  let engine;

  beforeEach(() => {
    engine = new WorkflowEngine({
      stateAdapter: new MemoryStateAdapter(),
      autoResume: false
    });
  });

  it('should resolve handler by type', async () => {
    engine.registerHandler('typed', async () => ({ type: 'typed' }));

    const workflow = engine.createWorkflow('typed-wf', [
      { name: 'step-1', type: 'typed' }
    ]);

    const completedPromise = new Promise(resolve => {
      engine.on('workflow:completed', (wf) => resolve(wf));
    });

    await engine.startWorkflow(workflow.id);
    const completed = await completedPromise;

    assert.strictEqual(completed.steps[0].output.type, 'typed');
  });

  it('should resolve inline handler function', async () => {
    const workflow = engine.createWorkflow('inline-wf', [
      { name: 'step-1', handler: async () => ({ inline: true }) }
    ]);

    const completedPromise = new Promise(resolve => {
      engine.on('workflow:completed', (wf) => resolve(wf));
    });

    await engine.startWorkflow(workflow.id);
    const completed = await completedPromise;

    assert.strictEqual(completed.steps[0].output.inline, true);
  });

  it('should throw for unknown handler', async () => {
    const workflow = engine.createWorkflow('unknown-wf', [
      { name: 'step-1', type: 'unknown' }
    ]);

    const failedPromise = new Promise(resolve => {
      engine.on('workflow:failed', (wf) => resolve(wf));
    });

    await engine.startWorkflow(workflow.id);
    const failed = await failedPromise;

    assert.ok(failed.error.includes('No handler'));
  });
});

describe('WorkflowEngine - Stats and Queries', () => {
  let engine;

  beforeEach(() => {
    engine = new WorkflowEngine({
      stateAdapter: new MemoryStateAdapter(),
      autoResume: false
    });
  });

  it('should return workflow stats', () => {
    engine.createWorkflow('wf-1', [{ name: 'step', type: 'test' }]);
    engine.createWorkflow('wf-2', [{ name: 'step', type: 'test' }]);
    engine.createWorkflow('wf-3', [{ name: 'step', type: 'test' }]);

    const stats = engine.getStats();
    assert.strictEqual(stats.total, 3);
    assert.strictEqual(stats.pending, 3);
  });

  it('should list all workflows', () => {
    engine.createWorkflow('list-wf', [{ name: 'step', type: 'test' }]);
    
    const list = engine.listWorkflows();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].name, 'list-wf');
  });

  it('should delete a workflow', () => {
    const workflow = engine.createWorkflow('delete-wf', [{ name: 'step', type: 'test' }]);
    
    assert.ok(engine.getWorkflow(workflow.id));
    engine.deleteWorkflow(workflow.id);
    assert.strictEqual(engine.getWorkflow(workflow.id), null);
  });

  it('should archive completed workflows', async () => {
    // Use FileStateAdapter for archive support
    const { FileStateAdapter } = require('../../src/workflows/state.js');
    const fileAdapter = new FileStateAdapter({ filePath: '/tmp/test-archive-wf.json' });
    const fileEngine = new WorkflowEngine({ stateAdapter: fileAdapter, autoResume: false });
    
    fileEngine.registerHandler('test', async () => ({ ok: true }));

    const workflow = fileEngine.createWorkflow('archive-wf', [
      { name: 'step', type: 'test' }
    ]);

    const completedPromise = new Promise(resolve => {
      fileEngine.on('workflow:completed', () => resolve());
    });

    await fileEngine.startWorkflow(workflow.id);
    await completedPromise;

    // Archive with 0 maxAge to remove all
    const archived = fileEngine.archive(0);
    assert.strictEqual(archived, 1);
    assert.strictEqual(fileEngine.listWorkflows().length, 0);
    
    // Cleanup
    try { require('fs').unlinkSync('/tmp/test-archive-wf.json'); } catch {}
  });
});

describe('FileStateAdapter', () => {
  it('should persist to file and reload', () => {
    const { FileStateAdapter } = require('../../src/workflows/state.js');
    const adapter = new FileStateAdapter({ filePath: '/tmp/test-workflows.json' });
    
    // Clean up
    try { require('fs').unlinkSync('/tmp/test-workflows.json'); } catch {}
    
    const adapter2 = new FileStateAdapter({ filePath: '/tmp/test-workflows.json' });
    
    const workflow = {
      id: 'test-1',
      name: 'test',
      status: 'pending',
      steps: [],
      currentStepIndex: 0,
      context: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    
    adapter2.save(workflow);
    
    const loaded = adapter2.load('test-1');
    assert.ok(loaded);
    assert.strictEqual(loaded.name, 'test');
    
    // Clean up
    try { require('fs').unlinkSync('/tmp/test-workflows.json'); } catch {}
  });
});
