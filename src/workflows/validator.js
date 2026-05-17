/**
 * Workflow Validator
 * 
 * Additional validation utilities for workflow definitions
 * Checks semantic correctness beyond JSON schema validation
 */

const { ValidationError } = require('../utils/errors.js');

/**
 * Validate a compiled workflow for execution readiness
 */
function validateCompiledWorkflow(compiledWorkflow) {
  const issues = [];
  
  // Check for duplicate step names
  const names = new Set();
  for (const step of compiledWorkflow.steps) {
    if (names.has(step.name)) {
      issues.push(`Duplicate step name: "${step.name}"`);
    }
    names.add(step.name);
  }
  
  // Check for circular references in conditions
  const visited = new Set();
  function checkCircular(step, depth = 0) {
    if (depth > 50) {
      issues.push(`Possible circular reference detected near step: "${step.name}"`);
      return;
    }
    
    if (step.type === 'condition') {
      const thenSteps = step.input?.thenSteps || [];
      const elseSteps = step.input?.elseSteps || [];
      for (const s of [...thenSteps, ...elseSteps]) {
        checkCircular(s, depth + 1);
      }
    }
  }
  
  for (const step of compiledWorkflow.steps) {
    checkCircular(step);
  }
  
  // Check for undefined template variables
  const templateVars = extractTemplateVariables(compiledWorkflow);
  const contextKeys = Object.keys(compiledWorkflow.context || {});
  for (const varName of templateVars) {
    if (!contextKeys.includes(varName)) {
      issues.push(`Template variable "{{${varName}}}" may be undefined (not in context)`);
    }
  }
  
  // Check for unreachable steps
  if (compiledWorkflow.steps.length > 0) {
    const firstStep = compiledWorkflow.steps[0];
    if (firstStep.type === 'condition') {
      // First step is a condition - ensure it has both branches
      const thenSteps = firstStep.input?.thenSteps || [];
      const elseSteps = firstStep.input?.elseSteps || [];
      if (thenSteps.length === 0 && elseSteps.length === 0) {
        issues.push('First condition has no steps in either branch');
      }
    }
  }
  
  return {
    valid: issues.length === 0,
    issues,
    stepCount: compiledWorkflow.steps.length
  };
}

/**
 * Extract template variables from a workflow definition
 */
function extractTemplateVariables(definition) {
  const variables = new Set();
  
  function scanValue(value) {
    if (typeof value === 'string') {
      const matches = value.match(/\{\{(\w+)\}\}/g);
      if (matches) {
        matches.forEach(match => {
          const varName = match.replace(/\{\{|\}\}/g, '');
          variables.add(varName);
        });
      }
    } else if (Array.isArray(value)) {
      value.forEach(scanValue);
    } else if (value !== null && typeof value === 'object') {
      Object.values(value).forEach(scanValue);
    }
  }
  
  scanValue(definition);
  return Array.from(variables);
}

/**
 * Check if a workflow can be safely executed
 */
function isExecutable(definition) {
  try {
    if (!definition.steps || definition.steps.length === 0) {
      return { executable: false, reason: 'No steps defined' };
    }
    
    if (!definition.name) {
      return { executable: false, reason: 'Workflow name is required' };
    }
    
    return { executable: true };
  } catch (error) {
    return { executable: false, reason: error.message };
  }
}

/**
 * Get workflow summary information
 */
function getWorkflowSummary(definition) {
  const steps = definition.steps || [];
  
  const typeCounts = {};
  for (const step of steps) {
    typeCounts[step.type] = (typeCounts[step.type] || 0) + 1;
  }
  
  const hasConditions = steps.some(s => s.type === 'condition');
  const hasParallel = steps.some(s => s.type === 'parallel');
  const hasApprovals = steps.some(s => s.type === 'human-approval');
  
  const complexity = steps.length <= 3 ? 'simple' :
                    steps.length <= 10 ? 'moderate' : 'complex';
  
  return {
    name: definition.name,
    description: definition.description,
    version: definition.version,
    stepCount: steps.length,
    typeCounts,
    hasConditions,
    hasParallel,
    hasApprovals,
    complexity,
    estimatedExecutionTime: estimateExecutionTime(steps)
  };
}

/**
 * Rough estimate of execution time based on step types
 */
function estimateExecutionTime(steps) {
  let totalMs = 0;
  
  for (const step of steps) {
    switch (step.type) {
      case 'human-approval':
        totalMs += step.timeout || 30000;
        break;
      case 'parallel':
        // Take max of branches (they run concurrently)
        const branchSteps = step.steps || [];
        const maxBranchTime = Math.max(...branchSteps.map(s => estimateExecutionTime([s])));
        totalMs += maxBranchTime;
        break;
      case 'condition':
        // Assume then branch (pessimistic)
        const thenSteps = step.then || [];
        totalMs += estimateExecutionTime(thenSteps);
        break;
      default:
        totalMs += 5000; // Default 5s per step
    }
  }
  
  return totalMs;
}

module.exports = {
  validateCompiledWorkflow,
  extractTemplateVariables,
  isExecutable,
  getWorkflowSummary,
  estimateExecutionTime
};
