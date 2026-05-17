/**
 * Tests for Workflow Definition DSL
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  validateWorkflowDefinition,
  compileWorkflowDefinition,
  evaluateCondition,
  parseTemplate,
  parseTemplateObject,
  getNestedValue,
  loadFromJSON,
  loadFromFile
} = require('../../src/workflows/dsl.js');
const { WorkflowEngine } = require('../../src/workflows/engine.js');
const { registerBuiltInHandlers } = require('../../src/workflows/handlers.js');
const { MemoryStateAdapter } = require('../../src/workflows/state.js');

describe('DSL - Schema Validation', () => {
  it('should validate minimal workflow', () => {
    const definition = {
      name: 'test-wf',
      steps: [{ name: 'step-1', type: 'test' }]
    };
    
    const result = validateWorkflowDefinition(definition);
    assert.strictEqual(result.name, 'test-wf');
    assert.strictEqual(result.steps.length, 1);
    assert.strictEqual(result.version, '1.0.0');
  });

  it('should validate workflow with metadata', () => {
    const definition = {
      name: 'complex-wf',
      description: 'A complex workflow',
      version: '1.2.3',
      metadata: { author: 'test' },
      steps: [{ name: 'step-1', type: 'test' }]
    };
    
    const result = validateWorkflowDefinition(definition);
    assert.strictEqual(result.description, 'A complex workflow');
    assert.strictEqual(result.version, '1.2.3');
    assert.strictEqual(result.metadata.author, 'test');
  });

  it('should throw for missing name', () => {
    assert.throws(
      () => validateWorkflowDefinition({ steps: [] }),
      /validation failed/
    );
  });

  it('should throw for empty steps', () => {
    assert.throws(
      () => validateWorkflowDefinition({ name: 'test', steps: [] }),
      /validation failed/
    );
  });

  it('should throw for invalid version format', () => {
    assert.throws(
      () => validateWorkflowDefinition({
        name: 'test',
        version: 'invalid',
        steps: [{ name: 'step', type: 'test' }]
      }),
      /validation failed/
    );
  });

  it('should validate condition step', () => {
    const definition = {
      name: 'cond-wf',
      steps: [{
        name: 'branch',
        type: 'condition',
        if: '{{status}} === "passed"',
        then: [{ name: 'good', type: 'test' }],
        else: [{ name: 'bad', type: 'test' }]
      }]
    };
    
    const result = validateWorkflowDefinition(definition);
    assert.strictEqual(result.steps[0].type, 'condition');
  });

  it('should validate parallel step', () => {
    const definition = {
      name: 'parallel-wf',
      steps: [{
        name: 'parallel-work',
        type: 'parallel',
        steps: [
          { name: 'task-a', type: 'test' },
          { name: 'task-b', type: 'test' }
        ]
      }]
    };
    
    const result = validateWorkflowDefinition(definition);
    assert.strictEqual(result.steps[0].type, 'parallel');
  });

  it('should validate human-approval step', () => {
    const definition = {
      name: 'approval-wf',
      steps: [{
        name: 'approval-gate',
        type: 'human-approval',
        message: 'Approve deployment?',
        timeout: 30000
      }]
    };
    
    const result = validateWorkflowDefinition(definition);
    assert.strictEqual(result.steps[0].type, 'human-approval');
    assert.strictEqual(result.steps[0].timeout, 30000);
  });
});

describe('DSL - Template Parsing', () => {
  it('should parse simple template variable', () => {
    const result = parseTemplate('Hello {{name}}', { name: 'World' });
    assert.strictEqual(result, 'Hello World');
  });

  it('should keep template if variable not found', () => {
    const result = parseTemplate('Hello {{missing}}', {});
    assert.strictEqual(result, 'Hello {{missing}}');
  });

  it('should parse template in nested object', () => {
    const result = parseTemplateObject(
      { greeting: 'Hello {{name}}', items: ['{{item}}'] },
      { name: 'World', item: 'test' }
    );
    assert.strictEqual(result.greeting, 'Hello World');
    assert.strictEqual(result.items[0], 'test');
  });

  it('should get nested value', () => {
    const obj = { a: { b: { c: 'deep' } } };
    assert.strictEqual(getNestedValue(obj, 'a.b.c'), 'deep');
    assert.strictEqual(getNestedValue(obj, 'x.y.z'), undefined);
  });
});

describe('DSL - Condition Evaluation', () => {
  it('should evaluate equality', () => {
    assert.strictEqual(evaluateCondition('"passed" === "passed"'), true);
    assert.strictEqual(evaluateCondition('"passed" === "failed"'), false);
  });

  it('should evaluate with template variables', () => {
    const context = { status: 'passed', count: 5 };
    // Template variables without extra quotes - function handles string quoting
    assert.strictEqual(evaluateCondition('{{status}} === "passed"', context), true);
    assert.strictEqual(evaluateCondition('{{count}} > 3', context), true);
  });

  it('should evaluate logical operators', () => {
    assert.strictEqual(evaluateCondition('true && true'), true);
    assert.strictEqual(evaluateCondition('true && false'), false);
    assert.strictEqual(evaluateCondition('true || false'), true);
  });

  it('should throw for unknown variable', () => {
    assert.throws(
      () => evaluateCondition('"{{unknown}}" === "test"', {}),
      /not found/
    );
  });
});

describe('DSL - Compilation', () => {
  it('should compile simple workflow', () => {
    const definition = {
      name: 'simple-wf',
      steps: [{ name: 'step-1', type: 'test', input: { key: 'value' } }]
    };
    
    const compiled = compileWorkflowDefinition(definition);
    assert.strictEqual(compiled.name, 'simple-wf');
    assert.strictEqual(compiled.steps.length, 1);
    assert.strictEqual(compiled.steps[0].name, 'step-1');
    assert.strictEqual(compiled.steps[0].type, 'test');
  });

  it('should compile with context variables', () => {
    const definition = {
      name: 'ctx-wf',
      context: { repo: 'my-repo' },
      steps: [{ name: 'clone', type: 'git', input: { repo: '{{repo}}' } }]
    };
    
    const compiled = compileWorkflowDefinition(definition);
    assert.strictEqual(compiled.steps[0].input.repo, 'my-repo');
  });

  it('should compile condition step', () => {
    const definition = {
      name: 'cond-wf',
      steps: [{
        name: 'branch',
        type: 'condition',
        if: '{{status}} === "passed"',
        then: [{ name: 'good', type: 'test' }],
        else: [{ name: 'bad', type: 'test' }]
      }]
    };
    
    const compiled = compileWorkflowDefinition(definition);
    assert.strictEqual(compiled.steps[0].type, 'condition');
    assert.strictEqual(compiled.steps[0].handler, 'condition');
    assert.ok(compiled.steps[0].input.thenSteps);
    assert.ok(compiled.steps[0].input.elseSteps);
  });

  it('should compile parallel step', () => {
    const definition = {
      name: 'parallel-wf',
      steps: [{
        name: 'parallel-work',
        type: 'parallel',
        steps: [
          { name: 'task-a', type: 'test' },
          { name: 'task-b', type: 'test' }
        ]
      }]
    };
    
    const compiled = compileWorkflowDefinition(definition);
    assert.strictEqual(compiled.steps[0].type, 'parallel');
    assert.strictEqual(compiled.steps[0].handler, 'parallel');
    assert.strictEqual(compiled.steps[0].input.branches.length, 2);
  });

  it('should compile human-approval step', () => {
    const definition = {
      name: 'approval-wf',
      steps: [{
        name: 'approve',
        type: 'human-approval',
        message: 'Deploy to production?'
      }]
    };
    
    const compiled = compileWorkflowDefinition(definition);
    assert.strictEqual(compiled.steps[0].type, 'human-approval');
    assert.strictEqual(compiled.steps[0].input.message, 'Deploy to production?');
    assert.strictEqual(compiled.steps[0].input.timeout, 3600000);
  });
});

describe('DSL - Load from JSON', () => {
  it('should load from JSON string', () => {
    const json = JSON.stringify({
      name: 'json-wf',
      steps: [{ name: 'step', type: 'test' }]
    });
    
    const result = loadFromJSON(json);
    assert.strictEqual(result.name, 'json-wf');
  });

  it('should throw for invalid JSON', () => {
    assert.throws(
      () => loadFromJSON('not json'),
      /Invalid JSON/
    );
  });

  it('should load from file', () => {
    const testFile = '/tmp/test-wf.json';
    fs.writeFileSync(testFile, JSON.stringify({
      name: 'file-wf',
      steps: [{ name: 'step', type: 'test' }]
    }));
    
    const result = loadFromFile(testFile);
    assert.strictEqual(result.name, 'file-wf');
    
    fs.unlinkSync(testFile);
  });

  it('should throw for missing file', () => {
    assert.throws(
      () => loadFromFile('/nonexistent/path.json'),
      /not found/
    );
  });
});

describe('DSL - End-to-End Execution', () => {
  it('should execute compiled simple workflow', async () => {
    const definition = {
      name: 'e2e-wf',
      steps: [
        { name: 'step-1', type: 'test' },
        { name: 'step-2', type: 'test' }
      ]
    };
    
    const compiled = compileWorkflowDefinition(definition);
    const engine = new WorkflowEngine({
      stateAdapter: new MemoryStateAdapter(),
      autoResume: false
    });
    
    engine.registerHandler('test', async () => ({ ok: true }));
    
    const completedPromise = new Promise(resolve => {
      engine.on('workflow:completed', (wf) => resolve(wf));
    });
    
    const workflow = engine.createWorkflow(compiled.name, compiled.steps);
    await engine.startWorkflow(workflow.id);
    const result = await completedPromise;
    
    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.steps.length, 2);
  });

  it('should execute workflow with condition', async () => {
    const definition = {
      name: 'cond-e2e',
      context: { status: 'passed' },
      steps: [{
        name: 'branch',
        type: 'condition',
        if: '"{{status}}" === "passed"',
        then: [{ name: 'good', type: 'test' }]
      }]
    };
    
    const compiled = compileWorkflowDefinition(definition);
    const engine = new WorkflowEngine({
      stateAdapter: new MemoryStateAdapter(),
      autoResume: false
    });
    
    registerBuiltInHandlers(engine);
    engine.registerHandler('test', async () => ({ ok: true }));
    
    const completedPromise = new Promise(resolve => {
      engine.on('workflow:completed', (wf) => resolve(wf));
    });
    
    const workflow = engine.createWorkflow(compiled.name, compiled.steps, {
      context: compiled.context
    });
    await engine.startWorkflow(workflow.id);
    const result = await completedPromise;
    
    assert.strictEqual(result.status, 'completed');
  });

  it('should execute workflow with parallel steps', async () => {
    const definition = {
      name: 'parallel-e2e',
      steps: [{
        name: 'parallel-work',
        type: 'parallel',
        steps: [
          { name: 'task-a', type: 'test' },
          { name: 'task-b', type: 'test' }
        ]
      }]
    };
    
    const compiled = compileWorkflowDefinition(definition);
    const engine = new WorkflowEngine({
      stateAdapter: new MemoryStateAdapter(),
      autoResume: false
    });
    
    registerBuiltInHandlers(engine);
    engine.registerHandler('test', async () => ({ ok: true }));
    
    const completedPromise = new Promise(resolve => {
      engine.on('workflow:completed', (wf) => resolve(wf));
    });
    
    const workflow = engine.createWorkflow(compiled.name, compiled.steps);
    await engine.startWorkflow(workflow.id);
    const result = await completedPromise;
    
    assert.strictEqual(result.status, 'completed');
  });

  it('should execute workflow with human approval', async () => {
    const definition = {
      name: 'approval-e2e',
      steps: [{
        name: 'approve',
        type: 'human-approval',
        message: 'Continue?'
      }]
    };
    
    const compiled = compileWorkflowDefinition(definition);
    const engine = new WorkflowEngine({
      stateAdapter: new MemoryStateAdapter(),
      autoResume: false
    });
    
    registerBuiltInHandlers(engine);
    
    const completedPromise = new Promise(resolve => {
      engine.on('workflow:completed', (wf) => resolve(wf));
    });
    
    const workflow = engine.createWorkflow(compiled.name, compiled.steps);
    await engine.startWorkflow(workflow.id);
    const result = await completedPromise;
    
    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.steps[0].output.approved, true);
  });
});
