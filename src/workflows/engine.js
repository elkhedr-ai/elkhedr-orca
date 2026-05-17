/**
 * Workflow Engine
 * 
 * Durable workflow execution with checkpoint/resume.
 * Integrates with TaskQueue (T15) for step execution.
 * 
 * A workflow consists of:
 *   - Multiple steps executed sequentially
 *   - Shared context passed between steps
 *   - State persisted after each step (checkpoint)
 *   - Automatic resume on process restart
 */

const { EventEmitter } = require('events');
const { logger } = require('../utils/logger.js');
const { ValidationError } = require('../utils/errors.js');
const { FileStateAdapter, MemoryStateAdapter } = require('./state.js');

const WORKFLOW_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

const STEP_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped'
};

let workflowIdCounter = 0;

function generateWorkflowId() {
  return `wf_${++workflowIdCounter}_${Date.now()}`;
}

class WorkflowEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // State adapter (file-based default, memory for testing)
    this.stateAdapter = options.stateAdapter || new FileStateAdapter();
    
    // Task queue for executing steps
    this.taskQueue = options.taskQueue || null;
    
    // Step handlers registry
    this.handlers = new Map();
    
    // Active workflow executions
    this.activeExecutions = new Map();
    
    // Auto-resume on startup
    this.autoResume = options.autoResume !== false;
    
    // Metrics
    this.metrics = {
      totalCreated: 0,
      totalCompleted: 0,
      totalFailed: 0,
      totalResumed: 0
    };
    
    if (this.autoResume) {
      this.resumeAll().catch(error => {
        logger.error({ error: error.message }, 'Failed to auto-resume workflows');
      });
    }
  }

  /**
   * Register a step handler
   */
  registerHandler(stepType, handler) {
    if (typeof handler !== 'function') {
      throw new ValidationError('Step handler must be a function');
    }
    this.handlers.set(stepType, handler);
    logger.debug({ stepType }, 'Registered workflow step handler');
  }

  /**
   * Create a new workflow
   */
  createWorkflow(name, steps, options = {}) {
    if (!name || typeof name !== 'string') {
      throw new ValidationError('Workflow name is required');
    }
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new ValidationError('Workflow must have at least one step');
    }

    const workflowId = options.id || generateWorkflowId();
    
    const workflow = {
      id: workflowId,
      name,
      description: options.description || '',
      status: WORKFLOW_STATUS.PENDING,
      steps: steps.map((step, index) => ({
        id: `${workflowId}_step_${index}`,
        name: step.name || `step-${index}`,
        type: step.type || 'default',
        handler: step.handler,
        status: STEP_STATUS.PENDING,
        input: step.input || {},
        output: null,
        error: null,
        startedAt: null,
        completedAt: null,
        retries: step.retries || 0,
        maxRetries: step.maxRetries || 0
      })),
      currentStepIndex: 0,
      context: options.context || {},
      metadata: options.metadata || {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
      completedAt: null,
      error: null
    };

    this.stateAdapter.save(workflow);
    this.metrics.totalCreated++;
    
    this.emit('workflow:created', workflow);
    logger.info({ workflowId, name, steps: steps.length }, 'Workflow created');
    
    return workflow;
  }

  /**
   * Start executing a workflow
   */
  async startWorkflow(workflowId) {
    const workflow = this.stateAdapter.load(workflowId);
    if (!workflow) {
      throw new ValidationError(`Workflow ${workflowId} not found`);
    }

    if (workflow.status === WORKFLOW_STATUS.RUNNING) {
      logger.warn({ workflowId }, 'Workflow is already running');
      return workflow;
    }

    if (workflow.status === WORKFLOW_STATUS.COMPLETED || 
        workflow.status === WORKFLOW_STATUS.FAILED ||
        workflow.status === WORKFLOW_STATUS.CANCELLED) {
      throw new ValidationError(`Workflow ${workflowId} is already ${workflow.status}`);
    }

    workflow.status = WORKFLOW_STATUS.RUNNING;
    workflow.updatedAt = Date.now();
    this.stateAdapter.save(workflow);

    this.emit('workflow:started', workflow);
    logger.info({ workflowId, step: workflow.currentStepIndex }, 'Workflow started');

    // Begin execution
    await this._executeNextStep(workflow);
    return workflow;
  }

  /**
   * Execute the next step in a workflow
   */
  async _executeNextStep(workflow) {
    const { currentStepIndex, steps } = workflow;
    
    // Check if all steps completed
    if (currentStepIndex >= steps.length) {
      await this._completeWorkflow(workflow);
      return;
    }

    const step = steps[currentStepIndex];
    
    // Check if workflow was cancelled/paused
    const currentState = this.stateAdapter.load(workflow.id);
    if (currentState.status === WORKFLOW_STATUS.CANCELLED) {
      logger.info({ workflowId: workflow.id }, 'Workflow was cancelled');
      return;
    }
    if (currentState.status === WORKFLOW_STATUS.PAUSED) {
      logger.info({ workflowId: workflow.id }, 'Workflow is paused');
      return;
    }

    step.status = STEP_STATUS.RUNNING;
    step.startedAt = Date.now();
    workflow.updatedAt = Date.now();
    this.stateAdapter.save(workflow);

    this.emit('step:started', workflow, step);
    logger.info({ workflowId: workflow.id, stepId: step.id, stepName: step.name }, 'Step started');

    try {
      // Get handler
      const handler = this._getHandler(step);
      
      // Prepare input (merge context + step input)
      const input = {
        ...workflow.context,
        ...step.input,
        _workflowId: workflow.id,
        _stepId: step.id,
        _stepIndex: currentStepIndex
      };

      // Execute step
      const output = await handler(input);

      // Update step
      step.status = STEP_STATUS.COMPLETED;
      step.output = output;
      step.completedAt = Date.now();
      step.error = null;

      // Update context with output
      if (output && typeof output === 'object') {
        workflow.context = {
          ...workflow.context,
          ...output,
          [`_${step.name}_output`]: output
        };
      }

      workflow.currentStepIndex = currentStepIndex + 1;
      workflow.updatedAt = Date.now();
      
      // Save checkpoint
      this.stateAdapter.save(workflow);
      
      this.emit('step:completed', workflow, step, output);
      logger.info({ 
        workflowId: workflow.id, 
        stepId: step.id,
        duration: step.completedAt - step.startedAt 
      }, 'Step completed');

      // Continue to next step
      await this._executeNextStep(workflow);
      
    } catch (error) {
      step.status = STEP_STATUS.FAILED;
      step.error = error.message;
      step.completedAt = Date.now();
      workflow.error = error.message;
      workflow.updatedAt = Date.now();
      
      // Retry logic
      if (step.retries < step.maxRetries) {
        step.retries++;
        step.status = STEP_STATUS.PENDING;
        workflow.updatedAt = Date.now();
        this.stateAdapter.save(workflow);
        
        logger.warn({
          workflowId: workflow.id,
          stepId: step.id,
          retry: step.retries,
          maxRetries: step.maxRetries,
          error: error.message
        }, 'Step failed, will retry');
        
        // Retry after delay
        const retryDelay = Math.pow(2, step.retries) * 1000;
        setTimeout(() => {
          this._executeNextStep(workflow).catch(err => {
            logger.error({ error: err.message }, 'Workflow retry failed');
          });
        }, retryDelay);
        
        return;
      }
      
      this.stateAdapter.save(workflow);
      await this._failWorkflow(workflow, error);
    }
  }

  /**
   * Get handler for a step
   */
  _getHandler(step) {
    // Check step-specific handler first
    if (step.handler) {
      if (typeof step.handler === 'function') {
        return step.handler;
      }
      // Handler is a string reference
      if (this.handlers.has(step.handler)) {
        return this.handlers.get(step.handler);
      }
    }
    
    // Check by step type
    if (this.handlers.has(step.type)) {
      return this.handlers.get(step.type);
    }
    
    throw new ValidationError(`No handler registered for step type: ${step.type}`);
  }

  /**
   * Complete a workflow
   */
  async _completeWorkflow(workflow) {
    workflow.status = WORKFLOW_STATUS.COMPLETED;
    workflow.completedAt = Date.now();
    workflow.updatedAt = Date.now();
    this.stateAdapter.save(workflow);
    
    this.metrics.totalCompleted++;
    this.emit('workflow:completed', workflow);
    logger.info({ 
      workflowId: workflow.id, 
      name: workflow.name,
      duration: workflow.completedAt - workflow.createdAt 
    }, 'Workflow completed');
  }

  /**
   * Fail a workflow
   */
  async _failWorkflow(workflow, error) {
    workflow.status = WORKFLOW_STATUS.FAILED;
    workflow.error = error.message;
    workflow.completedAt = Date.now();
    workflow.updatedAt = Date.now();
    this.stateAdapter.save(workflow);
    
    this.metrics.totalFailed++;
    this.emit('workflow:failed', workflow, error);
    logger.error({ 
      workflowId: workflow.id, 
      name: workflow.name,
      error: error.message 
    }, 'Workflow failed');
  }

  /**
   * Pause a running workflow
   */
  pauseWorkflow(workflowId) {
    const workflow = this.stateAdapter.load(workflowId);
    if (!workflow) {
      throw new ValidationError(`Workflow ${workflowId} not found`);
    }
    
    if (workflow.status !== WORKFLOW_STATUS.RUNNING) {
      throw new ValidationError(`Cannot pause workflow with status: ${workflow.status}`);
    }
    
    workflow.status = WORKFLOW_STATUS.PAUSED;
    workflow.updatedAt = Date.now();
    this.stateAdapter.save(workflow);
    
    this.emit('workflow:paused', workflow);
    logger.info({ workflowId }, 'Workflow paused');
    return workflow;
  }

  /**
   * Resume a paused workflow
   */
  async resumeWorkflow(workflowId) {
    const workflow = this.stateAdapter.load(workflowId);
    if (!workflow) {
      throw new ValidationError(`Workflow ${workflowId} not found`);
    }
    
    if (workflow.status !== WORKFLOW_STATUS.PAUSED) {
      throw new ValidationError(`Cannot resume workflow with status: ${workflow.status}`);
    }
    
    workflow.status = WORKFLOW_STATUS.RUNNING;
    workflow.updatedAt = Date.now();
    this.stateAdapter.save(workflow);
    
    this.emit('workflow:resumed', workflow);
    logger.info({ workflowId }, 'Workflow resumed');
    
    // Continue execution
    await this._executeNextStep(workflow);
    return workflow;
  }

  /**
   * Cancel a workflow
   */
  cancelWorkflow(workflowId) {
    const workflow = this.stateAdapter.load(workflowId);
    if (!workflow) {
      throw new ValidationError(`Workflow ${workflowId} not found`);
    }
    
    if (workflow.status === WORKFLOW_STATUS.COMPLETED || 
        workflow.status === WORKFLOW_STATUS.FAILED ||
        workflow.status === WORKFLOW_STATUS.CANCELLED) {
      throw new ValidationError(`Cannot cancel workflow with status: ${workflow.status}`);
    }
    
    workflow.status = WORKFLOW_STATUS.CANCELLED;
    workflow.updatedAt = Date.now();
    this.stateAdapter.save(workflow);
    
    this.emit('workflow:cancelled', workflow);
    logger.info({ workflowId }, 'Workflow cancelled');
    return workflow;
  }

  /**
   * Resume all running workflows from storage
   * Called on startup to recover from process restart
   */
  async resumeAll() {
    const workflows = this.stateAdapter.loadAll();
    const runningWorkflows = workflows.filter(w => w.status === WORKFLOW_STATUS.RUNNING);
    
    if (runningWorkflows.length === 0) {
      logger.debug('No running workflows to resume');
      return [];
    }
    
    logger.info({ count: runningWorkflows.length }, 'Resuming workflows after restart');
    
    const resumed = [];
    for (const workflow of runningWorkflows) {
      try {
        // Mark as running (they should already be, but ensure consistency)
        workflow.status = WORKFLOW_STATUS.RUNNING;
        workflow.updatedAt = Date.now();
        this.stateAdapter.save(workflow);
        
        // Resume execution from current step
        await this._executeNextStep(workflow);
        resumed.push(workflow.id);
        this.metrics.totalResumed++;
        
        this.emit('workflow:resumed', workflow);
      } catch (error) {
        logger.error({ 
          workflowId: workflow.id, 
          error: error.message 
        }, 'Failed to resume workflow');
      }
    }
    
    logger.info({ resumed: resumed.length }, 'Workflow resumption complete');
    return resumed;
  }

  /**
   * Get workflow by ID
   */
  getWorkflow(workflowId) {
    return this.stateAdapter.load(workflowId);
  }

  /**
   * List all workflows
   */
  listWorkflows() {
    return this.stateAdapter.list();
  }

  /**
   * Delete a workflow
   */
  deleteWorkflow(workflowId) {
    return this.stateAdapter.delete(workflowId);
  }

  /**
   * Get workflow statistics
   */
  getStats() {
    const counts = this.stateAdapter.countByStatus();
    return {
      ...counts,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      metrics: { ...this.metrics }
    };
  }

  /**
   * Archive old completed workflows
   */
  archive(maxAge = 86400000) {
    return this.stateAdapter.archive(maxAge);
  }
}

module.exports = {
  WorkflowEngine,
  WORKFLOW_STATUS,
  STEP_STATUS
};
