const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { confirm } = require('@clack/prompts');
const chalk = require('chalk');
const { z } = require('zod');
const skills = require('./skills.js');
const { logger } = require('./utils/logger.js');
const { withRetry } = require('./utils/retry.js');
const { 
  APIError, 
  ValidationError, 
  ConfigError, 
  AgentError,
  ToolExecutionError 
} = require('./utils/errors.js');
const {
  promptSchema,
  executeTerminalSchema,
  webSearchSchema,
  fetchUrlSchema
} = require('./schemas/index.js');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const agentsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'agents.json'), 'utf8'));
const UNIVERSAL_FALLBACK = "google/gemma-4-26b-a4b-it";
const analyticsPath = path.join(__dirname, '../data/analytics.json');

// Validate config at startup
if (!OPENROUTER_API_KEY) {
  throw new ConfigError('OPENROUTER_API_KEY is missing. Please create a .env file with your API key.', {
    envVar: 'OPENROUTER_API_KEY',
    solution: 'Create .env file with OPENROUTER_API_KEY=your_key_here'
  });
}

/**
 * Update analytics with operation metrics
 */
function updateAnalytics(agentRole, tokens, cost) {
  try {
    if (!fs.existsSync(analyticsPath)) {
      fs.writeFileSync(analyticsPath, JSON.stringify({ 
        totalOperations: 0, 
        totalCost: 0, 
        totalTokens: 0, 
        agentUsage: {} 
      }));
    }
    const data = JSON.parse(fs.readFileSync(analyticsPath, 'utf8'));
    data.totalOperations += 1;
    data.totalCost += cost;
    data.totalTokens += tokens;
    if (!data.agentUsage[agentRole]) {
      data.agentUsage[agentRole] = { calls: 0, tokens: 0, cost: 0 };
    }
    data.agentUsage[agentRole].calls += 1;
    data.agentUsage[agentRole].tokens += tokens;
    data.agentUsage[agentRole].cost += cost;
    fs.writeFileSync(analyticsPath, JSON.stringify(data, null, 2));
  } catch (e) {
    logger.warn({ error: e.message }, 'Failed to update analytics');
  }
}

/**
 * Make an API call to OpenRouter with retry logic
 */
async function callOpenRouter(model, messages, fallbackModel = null, sandbox = false, agentRole = "Orchestrator", useTools = false) {
  const traceId = `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const log = logger.child({ traceId, agentRole, model });
  
  log.debug({ messageCount: messages.length }, 'Starting API call');

  const payload = { model, messages };
  
  if (useTools) payload.tools = skills.toolDefinitions;
  if (sandbox) {
    messages.unshift({ 
      role: 'system', 
      content: "SECURITY: Operation in restricted Sandbox ~/elkhedr-orca-sandbox/." 
    });
  }

  const tryCall = async (targetModel) => {
    log.info({ targetModel }, 'Attempting API call');
    
    try {
      payload.model = targetModel;
      
      const response = await withRetry(
        () => axios.post('https://openrouter.ai/api/v1/chat/completions', payload, {
          headers: { 
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`, 
            'X-Title': 'Elkhedr Orca',
            'HTTP-Referer': 'https://github.com/ekagent/elkhedr-orca'
          },
          timeout: 60000 // 60 second timeout
        }),
        {
          maxRetries: 3,
          baseDelay: 1000,
          shouldRetry: (error) => {
            if (!error.response) return true;
            if (error.response.status >= 500) return true;
            if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED') return true;
            return false;
          }
        }
      );

      if (response.data?.choices?.[0]) {
        const choice = response.data.choices[0];
        const tokens = response.data.usage?.total_tokens || 0;
        const cost = (tokens / 1000000) * 0.5;
        
        updateAnalytics(agentRole, tokens, cost);
        log.info({ tokens, cost }, 'API call successful');
        
        // Handle Tool Calls
        if (choice.message.tool_calls) {
          log.info({ toolCount: choice.message.tool_calls.length }, 'Processing tool calls');
          const results = [];
          for (const call of choice.message.tool_calls) {
            const name = call.function.name;
            let args;
            
            try {
              args = JSON.parse(call.function.arguments);
            } catch (e) {
              log.error({ error: e.message, raw: call.function.arguments }, 'Failed to parse tool arguments');
              results.push({ 
                role: "tool", 
                tool_call_id: call.id, 
                name, 
                content: "Error: Invalid tool arguments" 
              });
              continue;
            }
            
            log.info({ toolName: name, args }, 'Executing tool');
            
            let result;
            try {
              if (name === "executeTerminal") {
                const validated = executeTerminalSchema.parse(args);
                console.log(chalk.yellow(`\n⚠️  Agent ${chalk.bold(agentRole)} wants to run command: ${chalk.bold(validated.command)}`));
                const approved = await confirm({ message: "Approve terminal command?" });
                result = approved 
                  ? await skills.executeTerminal(validated.command) 
                  : "User denied command execution.";
                log.info({ approved, command: validated.command }, 'Terminal command handled');
              } else if (name === "webSearch") {
                const validated = webSearchSchema.parse(args);
                result = await skills.webSearch(validated.query);
              } else if (name === "fetchUrl") {
                const validated = fetchUrlSchema.parse(args);
                result = await skills.fetchUrl(validated.url);
              } else {
                result = `Unknown tool: ${name}`;
              }
            } catch (toolError) {
              log.error({ error: toolError.message, tool: name }, 'Tool execution failed');
              result = `Tool execution error: ${toolError.message}`;
            }
            
            results.push({ role: "tool", tool_call_id: call.id, name, content: result });
          }
          
          // Recursion: Feed tool results back
          log.debug('Sending tool results back to model');
          return await callOpenRouter(targetModel, [...messages, choice.message, ...results], null, sandbox, agentRole, false);
        }
        
        return { content: choice.message.content, usage: response.data.usage };
      }
      
      return null;
    } catch (e) {
      log.error({ 
        error: e.message, 
        status: e.response?.status,
        statusText: e.response?.statusText,
        model: targetModel 
      }, 'API call failed');
      
      if (e.response?.status === 401) {
        throw new APIError(`Authentication failed for model ${targetModel}. Check your API key.`, {
          model: targetModel,
          status: e.response.status
        });
      }
      if (e.response?.status === 429) {
        throw new APIError(`Rate limit exceeded for model ${targetModel}. Please try again later.`, {
          model: targetModel,
          status: e.response.status
        });
      }
      if (e.response?.status >= 500) {
        throw new APIError(`OpenRouter server error (${e.response.status}) for model ${targetModel}. Retrying...`, {
          model: targetModel,
          status: e.response.status
        });
      }
      
      return null;
    }
  };

  let res = await tryCall(model);
  if (!res && fallbackModel) {
    log.info({ fallbackModel }, 'Trying fallback model');
    res = await tryCall(fallbackModel);
  }
  if (!res) {
    log.info({ universalFallback: UNIVERSAL_FALLBACK }, 'Trying universal fallback');
    res = await tryCall(UNIVERSAL_FALLBACK);
  }
  
  if (!res) {
    throw new APIError('All models failed to respond. Please check your API key and try again.', {
      models: [model, fallbackModel, UNIVERSAL_FALLBACK]
    });
  }
  
  return res;
}

/**
 * Main orchestration function
 */
async function orchestrate(userPrompt, onEvent = null, sessionStats = {}) {
  // Validate input
  try {
    promptSchema.parse(userPrompt);
  } catch (e) {
    throw new ValidationError('Invalid prompt', { errors: e.errors });
  }

  let level = sessionStats.level || 'Auto';
  const orchestrator = agentsData.orchestrator;

  logger.info({ level, prompt: userPrompt.substring(0, 100) }, 'Starting orchestration');

  if (level === 'Auto') {
    if (onEvent) onEvent({ type: 'status', message: '🤖 Analyzing task complexity...' });
    
    const routeResult = await callOpenRouter(
      "google/gemma-4-26b-a4b-it", 
      [{ role: 'user', content: `Analyze complexity: "${userPrompt}". Reply only: Instant, Thinking, or Swarm.` }], 
      "google/gemma-4-31b-it", 
      sessionStats.sandbox, 
      "Router"
    );
    level = routeResult?.content?.trim() || 'Instant';
    logger.info({ selectedLevel: level }, 'Auto-routing complete');
  }

  if (level === 'Instant') {
    if (onEvent) onEvent({ type: 'status', message: '⚡ Running instant mode...' });
    const res = await callOpenRouter(
      "google/gemma-4-26b-a4b-it", 
      [{ role: 'user', content: userPrompt }], 
      null, 
      sessionStats.sandbox, 
      "Instant", 
      true
    );
    return res?.content;
  }

  if (level === 'Swarm' || level === 'Full' || level === 'Thinking') {
    if (onEvent) onEvent({ type: 'status', message: `🏢 Running ${level} mode...` });
    
    const res = await callOpenRouter(
      orchestrator.model, 
      [{ role: 'user', content: userPrompt }], 
      orchestrator.fallbackModel, 
      sessionStats.sandbox, 
      "CEO", 
      true
    );
    return res?.content;
  }

  throw new ValidationError(`Unknown intelligence level: ${level}`);
}

/**
 * Run a single agent directly
 */
async function runSingleAgent(agentId, prompt, onEvent = null, sessionStats = {}) {
  // Validate inputs
  if (!Number.isInteger(agentId) || agentId < 1) {
    throw new ValidationError('Invalid agent ID', { agentId });
  }
  
  try {
    promptSchema.parse(prompt);
  } catch (e) {
    throw new ValidationError('Invalid prompt', { errors: e.errors });
  }

  const agent = agentsData.agents.find(a => a.id === agentId);
  if (!agent) {
    throw new AgentError(`Agent with ID ${agentId} not found`, { availableAgents: agentsData.agents.map(a => a.id) });
  }

  logger.info({ agentId, agentRole: agent.role, prompt: prompt.substring(0, 100) }, 'Running single agent');

  if (onEvent) onEvent({ type: 'agent_start', agent: agent.role, task: prompt.substring(0, 50) });
  
  const res = await callOpenRouter(
    agent.model, 
    [{ role: 'user', content: prompt }], 
    agent.fallbackModel, 
    sessionStats.sandbox, 
    agent.role, 
    true
  );
  
  return res?.content;
}

module.exports = { orchestrate, runSingleAgent, callOpenRouter };
