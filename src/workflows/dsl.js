/**
 * Workflow Definition DSL
 * 
 * JSON/YAML format for defining complex workflows with:
 *   - Sequential steps
 *   - Conditional branching
 *   - Parallel execution
 *   - Human-in-the-loop approvals
 * 
 * Example workflow definition:
 * {
 *   "name": "code-review",
 *   "description": "Automated code review pipeline",
 *   "steps": [
 *     { "name": "clone", "type": "git", "action": "clone", "input": { "repo": "{{repository}}" } },
 *     { "name": "lint", "type": "command", "cmd": "npm run lint" },
 *     { "name": "approve", "type": "human-approval", "message": "Approve code changes?" },
 *     { 
 *       "name": "branch", 
 *       "type": "condition", 
 *       "if": "{{lint.status}} === 'passed'",
 *       "then": [{ "name": "deploy", "type": "deploy" }],
 *       "else": [{ "name": "fix", "type": "command", "cmd": "npm run fix" }]
 *     },
 *     {
 *       "name": "parallel-checks",
 *       "type": "parallel",
 *       "steps": [
 *         { "name": "test-unit", "type": "command", "cmd": "npm test" },
 *         { "name": "test-e2e", "type": "command", "cmd": "npm run test:e2e" }
 *       ]
 *     }
 *   ]
 * }
 */

const { z } = require('zod');
const { ValidationError } = require('../utils/errors.js');

// Condition schema for if/else branching
const ConditionSchema = z.object({
  name: z.string().min(1),
  type: z.literal('condition'),
  if: z.string().min(1), // Expression like "{{step.output.status}} === 'passed'"
  then: z.lazy(() => z.array(StepDefinitionSchema).min(1)),
  else: z.lazy(() => z.array(StepDefinitionSchema)).optional(),
  metadata: z.record(z.any()).optional()
});

// Parallel execution schema
const ParallelSchema = z.object({
  name: z.string().min(1),
  type: z.literal('parallel'),
  steps: z.lazy(() => z.array(StepDefinitionSchema).min(1)),
  metadata: z.record(z.any()).optional()
});

// Human approval gate schema
const HumanApprovalSchema = z.object({
  name: z.string().min(1),
  type: z.literal('human-approval'),
  message: z.string().min(1),
  timeout: z.number().int().min(1000).max(86400000).optional(), // Default: 1 hour
  approvers: z.array(z.string()).optional(),
  metadata: z.record(z.any()).optional()
});

// Standard step schema
const StandardStepSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1).refine(val => val !== 'condition' && val !== 'parallel' && val !== 'human-approval', {
    message: 'Use condition, parallel, or human-approval types for special steps'
  }),
  handler: z.string().optional(),
  input: z.record(z.any()).optional(),
  retries: z.number().int().min(0).max(10).optional(),
  timeout: z.number().int().min(1000).optional(),
  metadata: z.record(z.any()).optional()
}).passthrough(); // Allow additional fields for specific handler types

// Union of all step types
const StepDefinitionSchema = z.union([
  StandardStepSchema,
  ConditionSchema,
  ParallelSchema,
  HumanApprovalSchema
]);

// Workflow definition schema
const WorkflowDefinitionSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/).optional().default('1.0.0'),
  metadata: z.record(z.any()).optional(),
  context: z.record(z.any()).optional(),
  steps: z.array(StepDefinitionSchema).min(1),
  variables: z.record(z.string()).optional() // Template variables
});

/**
 * Validate a workflow definition
 * @param {Object} definition - Raw workflow definition
 * @returns {Object} Validated definition
 * @throws {ValidationError} On validation failure
 */
function validateWorkflowDefinition(definition) {
  try {
    return WorkflowDefinitionSchema.parse(definition);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n  - ');
      throw new ValidationError(
        `Workflow definition validation failed:\n  - ${issues}`,
        { hint: 'Check your workflow JSON/YAML structure' }
      );
    }
    throw error;
  }
}

/**
 * Parse template variables in a string
 * Replaces {{variable}} with values from context
 */
function parseTemplate(str, context = {}) {
  if (typeof str !== 'string') return str;
  
  return str.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (context[key] !== undefined) {
      return context[key];
    }
    // Try nested path like {{step.output.status}}
    const nestedValue = getNestedValue(context, key);
    return nestedValue !== undefined ? nestedValue : match;
  });
}

/**
 * Parse template variables in nested objects
 */
function parseTemplateObject(obj, context = {}) {
  if (typeof obj === 'string') {
    return parseTemplate(obj, context);
  }
  if (Array.isArray(obj)) {
    return obj.map(item => parseTemplateObject(item, context));
  }
  if (obj !== null && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = parseTemplateObject(value, context);
    }
    return result;
  }
  return obj;
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj, path) {
  const keys = path.split('.');
  let current = obj;
  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

/**
 * Evaluate a simple condition expression
 * Supports: ===, !==, <, >, <=, >=, &&, ||
 * Values can be template expressions or literals
 */
function evaluateCondition(expression, context = {}) {
  // Replace template variables first
  let evalExpr = expression;
  
  // Replace {{path}} with actual values from context
  evalExpr = evalExpr.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const value = getNestedValue(context, path.trim());
    if (value === undefined) {
      throw new ValidationError(`Template variable "${path}" not found in context`);
    }
    // Quote string values for safe evaluation
    return typeof value === 'string' ? `"${value}"` : String(value);
  });
  
  // Safe evaluation of simple boolean expressions
  // Whitelist allowed characters and operators
  const sanitized = evalExpr.replace(/[^0-9a-zA-Z_\s\[\]\'\".\-!<>=&|]/g, '');
  
  try {
    // Use Function constructor for safer eval than direct eval()
    const fn = new Function(`return (${sanitized})`);
    return Boolean(fn());
  } catch (error) {
    throw new ValidationError(`Failed to evaluate condition: "${expression}". Error: ${error.message}`);
  }
}

/**
 * Compile a workflow definition into engine-compatible steps
 * 
 * Expands DSL features into flat step sequences:
 *   - Conditions become branch steps
 *   - Parallel steps become fork/join steps
 *   - Human approvals become approval steps
 */
function compileWorkflowDefinition(definition, context = {}) {
  const validated = validateWorkflowDefinition(definition);
  const mergedContext = { ...validated.context, ...context };
  
  const steps = [];
  
  function processStep(step, parentContext = mergedContext) {
    const stepWithTemplates = parseTemplateObject(step, parentContext);
    
    switch (step.type) {
      case 'condition':
        steps.push({
          name: stepWithTemplates.name,
          type: 'condition',
          handler: 'condition',
          input: {
            expression: stepWithTemplates.if,
            thenSteps: stepWithTemplates.then.map(s => ({ ...s, _compiled: true })),
            elseSteps: stepWithTemplates.else ? stepWithTemplates.else.map(s => ({ ...s, _compiled: true })) : []
          },
          metadata: { ...stepWithTemplates.metadata, isBranch: true }
        });
        break;
        
      case 'parallel':
        steps.push({
          name: stepWithTemplates.name,
          type: 'parallel',
          handler: 'parallel',
          input: {
            branches: stepWithTemplates.steps.map((s, index) => ({
              name: `branch-${index}`,
              steps: [parseTemplateObject(s, parentContext)]
            }))
          },
          metadata: { ...stepWithTemplates.metadata, isParallel: true, branchCount: stepWithTemplates.steps.length }
        });
        break;
        
      case 'human-approval':
        steps.push({
          name: stepWithTemplates.name,
          type: 'human-approval',
          handler: 'human-approval',
          input: {
            message: stepWithTemplates.message,
            timeout: stepWithTemplates.timeout || 3600000,
            approvers: stepWithTemplates.approvers || []
          },
          metadata: { ...stepWithTemplates.metadata, requiresHuman: true }
        });
        break;
        
      default:
        steps.push({
          name: stepWithTemplates.name,
          type: stepWithTemplates.type,
          handler: stepWithTemplates.handler || stepWithTemplates.type,
          input: stepWithTemplates.input || {},
          retries: stepWithTemplates.retries || 0,
          timeout: stepWithTemplates.timeout,
          metadata: stepWithTemplates.metadata
        });
    }
  }
  
  for (const step of validated.steps) {
    processStep(step, mergedContext);
  }
  
  return {
    name: validated.name,
    description: validated.description,
    version: validated.version,
    metadata: validated.metadata,
    context: mergedContext,
    steps
  };
}

/**
 * Load a workflow definition from JSON string
 */
function loadFromJSON(jsonString) {
  try {
    const definition = JSON.parse(jsonString);
    return validateWorkflowDefinition(definition);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ValidationError(`Invalid JSON: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Load a workflow definition from JSON file
 */
function loadFromFile(filePath) {
  const fs = require('fs');
  if (!fs.existsSync(filePath)) {
    throw new ValidationError(`Workflow definition file not found: ${filePath}`);
  }
  
  const content = fs.readFileSync(filePath, 'utf8');
  return loadFromJSON(content);
}

/**
 * List available workflow definition files
 */
function listDefinitions(definitionsDir = './workflows') {
  const fs = require('fs');
  const path = require('path');
  
  if (!fs.existsSync(definitionsDir)) {
    return [];
  }
  
  return fs.readdirSync(definitionsDir)
    .filter(f => f.endsWith('.json') || f.endsWith('.yaml') || f.endsWith('.yml'))
    .map(f => ({
      name: f,
      path: path.join(definitionsDir, f)
    }));
}

module.exports = {
  WorkflowDefinitionSchema,
  StepDefinitionSchema,
  ConditionSchema,
  ParallelSchema,
  HumanApprovalSchema,
  StandardStepSchema,
  validateWorkflowDefinition,
  compileWorkflowDefinition,
  evaluateCondition,
  parseTemplate,
  parseTemplateObject,
  getNestedValue,
  loadFromJSON,
  loadFromFile,
  listDefinitions
};
