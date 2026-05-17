/**
 * Built-in Workflow Step Handlers
 * 
 * Provides handlers for DSL-specific step types:
 *   - condition: Evaluates if/else branching
 *   - parallel: Executes multiple branches concurrently
 *   - human-approval: Waits for human confirmation
 */

const { WorkflowEngine } = require('./engine.js');
const { evaluateCondition, parseTemplateObject } = require('./dsl.js');
const { ValidationError } = require('../utils/errors.js');
const { logger } = require('../utils/logger.js');

/**
 * Condition handler - evaluates an expression and returns which branch to execute
 */
async function conditionHandler(input) {
  const { expression, thenSteps, elseSteps } = input;
  const context = input._context || {};
  
  try {
    const result = evaluateCondition(expression, context);
    
    logger.info({ expression, result }, 'Condition evaluated');
    
    return {
      condition: expression,
      result,
      nextBranch: result ? 'then' : 'else',
      steps: result ? thenSteps : (elseSteps || [])
    };
  } catch (error) {
    logger.error({ expression, error: error.message }, 'Condition evaluation failed');
    throw error;
  }
}

/**
 * Parallel handler - executes multiple branches concurrently
 * Returns when all branches complete
 */
async function parallelHandler(input) {
  const { branches } = input;
  const context = input._context || {};
  
  if (!Array.isArray(branches) || branches.length === 0) {
    throw new ValidationError('Parallel step requires at least one branch');
  }
  
  logger.info({ branchCount: branches.length }, 'Executing parallel branches');
  
  // Execute all branches concurrently
  const promises = branches.map(async (branch, index) => {
    try {
      // Create a mini-engine for each branch
      const branchEngine = new WorkflowEngine({
        stateAdapter: { // In-memory adapter for branch execution
          workflows: [],
          loadAll() { return this.workflows; },
          load(id) { return this.workflows.find(w => w.id === id) || null; },
          save(workflow) {
            const idx = this.workflows.findIndex(w => w.id === workflow.id);
            if (idx >= 0) this.workflows[idx] = workflow;
            else this.workflows.push(workflow);
            return workflow;
          },
          delete(id) {
            const idx = this.workflows.findIndex(w => w.id === id);
            if (idx >= 0) this.workflows.splice(idx, 1);
            return true;
          },
          list() { return this.workflows.map(w => ({ id: w.id, name: w.name, status: w.status })); },
          countByStatus() { return {}; },
          archive() { return 0; }
        },
        autoResume: false
      });
      
      // Register handlers from parent context
      if (context._handlers) {
        for (const [type, handler] of Object.entries(context._handlers)) {
          branchEngine.registerHandler(type, handler);
        }
      }
      
      const workflow = branchEngine.createWorkflow(
        `${branch.name || 'branch'}-${index}`,
        branch.steps || [branch],
        { context }
      );
      
      const completedPromise = new Promise((resolve, reject) => {
        branchEngine.on('workflow:completed', (wf) => resolve({ status: 'completed', output: wf.context, workflow: wf }));
        branchEngine.on('workflow:failed', (wf, error) => reject(error));
      });
      
      await branchEngine.startWorkflow(workflow.id);
      return await completedPromise;
      
    } catch (error) {
      logger.error({ branch: index, error: error.message }, 'Branch execution failed');
      return { status: 'failed', error: error.message, branch: index };
    }
  });
  
  const results = await Promise.all(promises);
  
  const successCount = results.filter(r => r.status === 'completed').length;
  const failureCount = results.filter(r => r.status === 'failed').length;
  
  logger.info({ 
    branchCount: branches.length, 
    successCount, 
    failureCount 
  }, 'Parallel execution complete');
  
  return {
    branches: results,
    allCompleted: failureCount === 0,
    successCount,
    failureCount
  };
}

/**
 * Human approval handler - simulates a human approval gate
 * In production, this would integrate with the UI/API
 */
async function humanApprovalHandler(input) {
  const { message, timeout, approvers } = input;
  
  logger.info({ message, timeout, approvers }, 'Waiting for human approval');
  
  // For now, auto-approve after a short delay (simulating human interaction)
  // In production, this would wait for actual user input via API/UI
  const approvalTimeout = timeout || 30000;
  
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new ValidationError(
        `Human approval timed out after ${approvalTimeout}ms`,
        { message, timeout: approvalTimeout }
      ));
    }, approvalTimeout);
    
    // Simulate approval (in production, this would wait for actual approval)
    // For MVP, we'll auto-approve for testing purposes
    // TODO: Replace with actual approval mechanism (TUI prompt, API endpoint, etc.)
    setTimeout(() => {
      clearTimeout(timeoutId);
      resolve({
        approved: true,
        message,
        approvedBy: 'system',
        approvedAt: Date.now()
      });
    }, 100); // Quick auto-approve for testing
  });
}

/**
 * Register all built-in handlers on a workflow engine
 */
function registerBuiltInHandlers(engine) {
  engine.registerHandler('condition', conditionHandler);
  engine.registerHandler('parallel', parallelHandler);
  engine.registerHandler('human-approval', humanApprovalHandler);
  
  logger.info('Registered built-in workflow handlers');
}

module.exports = {
  conditionHandler,
  parallelHandler,
  humanApprovalHandler,
  registerBuiltInHandlers
};
