const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { confirm } = require('@clack/prompts');
const chalk = require('chalk');
const { z } = require('zod');
const skills = require('./skills.js');
const { logger } = require('./utils/logger.js');
const { withRetry } = require('./utils/retry.js');
const { createCircuitBreaker } = require('./utils/circuit-breaker.js');
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
const { loadConfig, getConfig } = require('./config/index.js');
const { initializeDatabaseInstance } = require('./db/index.js');
const { addMessage, getContext } = require('./memory/manager');
const { getOrCreateSession, updateSession } = require('./session/manager');
const { getUserContext } = require('./auth/context');
const { queryWithRag, extractCitations } = require('./rag/prompts.js');
const { getModelRegistry } = require('./models/registry.js');
const { getLocalModelClient } = require('./models/local.js');
const { getQuotaManager } = require('./billing/quotas.js');
const { calculateCost } = require('./billing/pricing.js');

// Load and validate configuration on module initialization
loadConfig();
const config = getConfig();

const OPENROUTER_API_KEY = config.OPENROUTER_API_KEY;
const OPENROUTER_BASE_URL = config.ORCA_OPENROUTER_BASE_URL.replace(/\/$/, '');
const agentsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'agents.json'), 'utf8'));
const UNIVERSAL_FALLBACK = "google/gemma-4-26b-a4b-it";

// Database instance will be initialized asynchronously
let dbInstance = null;

// Initialize database on first use
async function getDbInstance() {
  if (!dbInstance) {
    dbInstance = await initializeDatabaseInstance();
  }
  return dbInstance;
}

// Initialize circuit breaker for OpenRouter API
const openRouterCircuitBreaker = createCircuitBreaker('OpenRouter', {
  failureThreshold: 5,      // Open after 5 failures
  successThreshold: 2,      // Close after 2 successes in HALF_OPEN
  timeout: 60000,           // 60 second timeout
  resetTimeout: 30000       // Try recovery after 30 seconds
});

// Validate config at startup
if (!OPENROUTER_API_KEY) {
  throw new ConfigError('OPENROUTER_API_KEY is missing. Please create a .env file with your API key.', {
    envVar: 'OPENROUTER_API_KEY',
    solution: 'Create .env file with OPENROUTER_API_KEY=your_key_here'
  });
}

// Local model support
const LOCAL_MODEL_ENABLED = String(config.ORCA_LOCAL_MODEL_ENABLED || 'false').toLowerCase() === 'true';
const LOCAL_MODEL_PRIORITY = config.ORCA_LOCAL_MODEL_PRIORITY || 'local-first';
let _localClient = null;

function getLocalClient() {
  if (!_localClient) {
    _localClient = getLocalModelClient();
  }
  return _localClient;
}

// Auto-discover local models on startup if enabled
if (LOCAL_MODEL_ENABLED) {
  const localClient = getLocalClient();
  const registry = getModelRegistry();
  localClient.listModels().then(models => {
    for (const model of models) {
      registry.registerModel({
        id: model.id,
        name: model.name,
        provider: 'local',
        model: model.name,
        endpoint: model.endpoint,
        costPer1kTokens: 0,
        qualityScore: 6.8,
        maxTokens: 8192,
        source: 'local-discovery',
        health: { status: 'healthy', lastCheck: new Date().toISOString(), latency: null }
      }, { replace: true });
    }
    if (models.length > 0) {
      logger.info({ count: models.length }, 'Local models auto-discovered on startup');
    }
  }).catch(err => {
    logger.warn({ error: err.message }, 'Local model auto-discovery failed on startup');
  });
}

/**
 * Track usage in quota system (non-blocking)
 */
async function trackQuotaUsage(tokens, cost, model) {
  try {
    const { userId } = getUserContext();
    if (!userId) return;
    const quotaManager = getQuotaManager();
    await quotaManager.trackUsage(userId, {
      tokens,
      cost,
      operationType: 'agent_call',
      model
    });
  } catch (e) {
    logger.warn({ error: e.message }, 'Failed to track quota usage');
  }
}

/**
 * Check quota before API call — returns { allowed, reason, quota } or throws
 */
async function checkQuotaBeforeCall() {
  try {
    const { userId } = getUserContext();
    if (!userId) return { allowed: true };
    const quotaManager = getQuotaManager();
    const result = await quotaManager.checkQuota(userId);
    if (!result.allowed) {
      throw new APIError(result.reason || 'Quota exceeded', { quota: result.quota });
    }
    return result;
  } catch (e) {
    if (e instanceof APIError) throw e;
    logger.warn({ error: e.message }, 'Quota check failed, allowing request');
    return { allowed: true };
  }
}

/**
 * Update analytics with operation metrics
 */
async function updateAnalytics(agentRole, tokens, cost) {
  try {
    const db = await getDbInstance();
    const { userId } = getUserContext();
    
    // Create a task record first
    const taskResult = await db.getAdapter().execute(
      `INSERT INTO tasks (user_id, agent_role, prompt, result, tokens, cost)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userId,
        agentRole,
        `Analytics update: ${tokens} tokens, $${cost.toFixed(4)} cost`,
        `Updated analytics for ${agentRole}`,
        tokens,
        cost
      ]
    );
    
    // Then insert the cost record linked to this task
    await db.updateAnalytics(taskResult.lastInsertRowid, tokens, cost);
  } catch (e) {
    logger.warn({ error: e.message }, 'Failed to update analytics');
  }
}

function parseBoolean(value, defaultValue = true) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return String(value).toLowerCase() !== 'false';
}

function parseNumber(value, defaultValue) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function getRagConfig(sessionStats = {}, overrides = {}) {
  const { userId } = getUserContext();
  const ragOptions = sessionStats.rag || {};
  const agentScoped = parseBoolean(
    ragOptions.agentScoped ?? sessionStats.ragAgentScoped ?? process.env.ORCA_RAG_AGENT_SCOPED,
    false
  );

  const config = {
    ragLimit: Number.parseInt(
      ragOptions.limit ?? sessionStats.ragLimit ?? process.env.ORCA_RAG_LIMIT ?? '3',
      10
    ) || 3,
    ragThreshold: parseNumber(
      ragOptions.threshold ?? sessionStats.ragThreshold ?? process.env.ORCA_RAG_THRESHOLD,
      0.15
    ),
    minConfidence: parseNumber(
      ragOptions.minConfidence ?? sessionStats.ragMinConfidence ?? process.env.ORCA_RAG_MIN_CONFIDENCE,
      0.2
    ),
    userId,
    sourceType: ragOptions.sourceType ?? sessionStats.ragSourceType ?? 'knowledge_entry',
    ragMetadata: ragOptions.metadata ?? sessionStats.ragMetadata
  };

  if (agentScoped && overrides.agentId !== undefined && overrides.agentId !== null) {
    config.agentId = String(overrides.agentId);
  }

  return config;
}

function isRagEnabled(sessionStats = {}) {
  const ragOptions = sessionStats.rag || {};
  return parseBoolean(
    ragOptions.enabled ?? sessionStats.ragEnabled ?? process.env.ORCA_RAG_ENABLED,
    true
  );
}

async function prepareRagMessages(prompt, contextMessages = [], options = {}) {
  const sessionStats = options.sessionStats || {};
  const baseMessages = [
    ...contextMessages,
    { role: 'user', content: prompt }
  ];

  if (!isRagEnabled(sessionStats)) {
    return { messages: baseMessages, rag: { usedRag: false, disabled: true } };
  }

  try {
    if (options.onEvent) {
      options.onEvent({ type: 'status', message: '📚 Retrieving knowledge context...' });
    }

    const rag = await queryWithRag(prompt, getRagConfig(sessionStats, options));

    if (!rag.usedRag) {
      if (options.onEvent) {
        options.onEvent({
          type: 'rag',
          usedRag: false,
          confidence: rag.confidence || 0,
          sources: []
        });
      }
      return { messages: baseMessages, rag };
    }

    if (options.onEvent) {
      options.onEvent({
        type: 'rag',
        usedRag: true,
        confidence: rag.confidence,
        sources: rag.sources,
        retrievalTime: rag.retrievalTime
      });
    }

    return {
      messages: [
        ...contextMessages,
        { role: 'user', content: rag.prompt }
      ],
      rag
    };
  } catch (error) {
    logger.warn({ error: error.message }, 'RAG preparation failed; using original prompt');
    return {
      messages: baseMessages,
      rag: {
        usedRag: false,
        error: error.message,
        sources: [],
        confidence: 0
      }
    };
  }
}

function formatSourceLine(source) {
  const metadata = source.metadata || {};
  const title = metadata.title || source.documentId || `Source ${source.index}`;
  const similarity = Number.isFinite(source.similarity)
    ? `, score ${source.similarity.toFixed(2)}`
    : '';
  return `[Source: ${source.index}] ${title}${similarity}`;
}

function finalizeRagResponse(content, rag) {
  const responseText = content || '';
  if (!rag?.usedRag || !Array.isArray(rag.sources) || rag.sources.length === 0) {
    return responseText;
  }

  const citations = extractCitations(responseText).citations;
  const cited = citations.length > 0
    ? rag.sources.filter(source => citations.includes(source.index))
    : rag.sources;

  if (cited.length === 0) {
    return responseText;
  }

  const sourceLines = cited.map(formatSourceLine).join('\n');
  const confidence = Number.isFinite(rag.confidence)
    ? `\nRetrieval confidence: ${(rag.confidence * 100).toFixed(0)}%`
    : '';

  return `${responseText}\n\nSources:\n${sourceLines}${confidence}`;
}

/**
 * Make an API call to OpenRouter with retry logic
 */
async function callOpenRouter(model, messages, fallbackModel = null, sandbox = false, agentRole = "Orchestrator", useTools = false) {
  const traceId = `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const log = logger.child({ traceId, agentRole, model });
  const modelRegistry = getModelRegistry();
  
  log.debug({ messageCount: messages.length }, 'Starting API call');

  const payload = { model, messages };
  
  if (useTools) {
    skills.init();
    payload.tools = skills.registry.getToolDefinitions();
  }
  if (sandbox) {
    messages.unshift({ 
      role: 'system', 
      content: "SECURITY: Operation in restricted Sandbox ~/elkhedr-orca-sandbox/." 
    });
  }

  // Build fallback chain with local-first priority if enabled
  const localModels = LOCAL_MODEL_ENABLED && LOCAL_MODEL_PRIORITY === 'local-first'
    ? modelRegistry.getLocalModels()
    : [];
  const modelAttempts = modelRegistry.buildFallbackChain({
    preferredModel: localModels.length > 0 ? localModels[0].model : model,
    fallbackModels: localModels.length > 0 ? [model, ...(localModels.slice(1).map(m => m.model))] : [],
    fallbackModel,
    universalFallback: UNIVERSAL_FALLBACK
  });
  const attemptedModels = [];
  let lastError = null;

  const tryCall = async (targetModel) => {
    log.info({ targetModel }, 'Attempting API call');
    const startedAt = Date.now();

    try {
      payload.model = targetModel;

      // Check if this is a local model — dispatch to LocalModelClient
      const modelConfig = modelRegistry.getModel(targetModel);
      if (modelConfig && modelConfig.provider === 'local' && LOCAL_MODEL_ENABLED) {
        log.info({ targetModel, type: modelConfig.type || 'local' }, 'Dispatching to local model');
        const localClient = getLocalClient();
        const localResult = await localClient.generate(
          modelConfig,
          messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: m.content })),
          { maxTokens: 2048 }
        );
        const tokens = (localResult.prompt_eval_count || 0) + (localResult.eval_count || 0) ||
          localResult.usage?.total_tokens || 0;
        const latency = Date.now() - startedAt;
        log.info({ tokens, latency }, 'Local model call successful');
        return {
          content: localResult.text,
          usage: { total_tokens: tokens },
          model: targetModel,
          latency
        };
      }

      // Wrap API call with circuit breaker protection
      const response = await openRouterCircuitBreaker.execute(async () => {
        return await withRetry(
          () => axios.post(`${OPENROUTER_BASE_URL}/chat/completions`, payload, {
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
      });

      if (response.data?.choices?.[0]) {
        const choice = response.data.choices[0];
        const tokens = response.data.usage?.total_tokens || 0;
        const cost = calculateCost(tokens, targetModel);

        await updateAnalytics(agentRole, tokens, cost);
        await trackQuotaUsage(tokens, cost, targetModel);
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
              // Dynamic skill execution
              if (skills.registry.has(name)) {
                const manifest = skills.registry.getManifest(name);
                
                // Check permissions - terminal requires user approval
                if (manifest.permissions.includes('execute')) {
                  const validated = executeTerminalSchema.parse(args);
                  console.log(chalk.yellow(`\n⚠️  Agent ${chalk.bold(agentRole)} wants to run command: ${chalk.bold(validated.command || JSON.stringify(args))}`));
                  const approved = await confirm({ message: `Approve ${name} execution?` });
                  if (!approved) {
                    result = "User denied command execution.";
                  } else {
                    result = await skills.registry.execute(name, args);
                  }
                  log.info({ approved, skill: name }, 'Skill execution handled');
                } else {
                  result = await skills.registry.execute(name, args);
                }
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
        
        return {
          content: choice.message.content,
          usage: response.data.usage,
          model: targetModel,
          latency: Date.now() - startedAt
        };
      }
      
      lastError = new APIError(`OpenRouter returned no choices for model ${targetModel}`, {
        model: targetModel
      });
      return null;
    } catch (e) {
      lastError = e;
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
        lastError = new APIError(`Rate limit exceeded for model ${targetModel}. Trying fallback if available.`, {
          model: targetModel,
          status: e.response.status
        });
        return null;
      }
      if (e.response?.status >= 500) {
        lastError = new APIError(`OpenRouter server error (${e.response.status}) for model ${targetModel}. Trying fallback if available.`, {
          model: targetModel,
          status: e.response.status
        });
        return null;
      }
      
      return null;
    }
  };

  for (const modelConfig of modelAttempts) {
    attemptedModels.push(modelConfig.model);
    let res;

    try {
      res = await tryCall(modelConfig.model);
    } catch (error) {
      modelRegistry.recordModelFailure(modelConfig.model, error);
      throw error;
    }

    if (res) {
      const tokens = res.usage?.total_tokens || 0;
      const cost = calculateCost(tokens, modelConfig.model);
      modelRegistry.recordModelSuccess(modelConfig.model, {
        latency: res.latency,
        tokens,
        cost
      });
      return res;
    }

    modelRegistry.recordModelFailure(
      modelConfig.model,
      lastError || new APIError(`Model ${modelConfig.model} returned no response`, { model: modelConfig.model })
    );
  }
  
  throw new APIError('All models failed to respond. Please check your API key and try again.', {
    models: attemptedModels,
    lastError: lastError?.message
  });
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

  // Check quota before proceeding
  const quotaResult = await checkQuotaBeforeCall();
  const quotaWarning = quotaResult.quota?.status === 'warning'
    ? `Warning: You have used ${(quotaResult.quota.highestPercent * 100).toFixed(0)}% of your quota.`
    : null;
  if (quotaWarning && onEvent) {
    onEvent({ type: 'quota_warning', message: quotaWarning });
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

    // Load or create session stats from database with user isolation
    const { getOrCreateSession, updateSession } = require('./session/manager');
    const { userId: ctxUserId } = getUserContext();
    const { sessionId: loadedSessionId, level: loadedLevel, sandbox: loadedSandbox, currentAgent: loadedCurrentAgent } = await getOrCreateSession(sessionStats.sessionId, ctxUserId);
    // Override with any values passed in (if they exist)
    const finalLevel = sessionStats.level ?? loadedLevel;
    const finalSandbox = sessionStats.sandbox ?? loadedSandbox;
    const finalCurrentAgent = sessionStats.currentAgent ?? loadedCurrentAgent;

    // Store the merged stats back (so that changes persist)
    await updateSession(sessionStats.sessionId || loadedSessionId, {
      level: finalLevel,
      sandbox: finalSandbox,
      currentAgent: finalCurrentAgent
    }, ctxUserId);

    // Use merged stats for the rest of the function
    const crypto = require('crypto');
    // Note: sessionId is already from the session manager (or newly created if none)
    sessionStats = {
      sessionId: sessionStats.sessionId || loadedSessionId,
      level: finalLevel,
      sandbox: finalSandbox,
      currentAgent: finalCurrentAgent
    };

  // Load recent context for this agent/session (default window size 20)
  const { getContext, addMessage } = require('./memory/manager');
  const contextMessages = await getContext('orchestrator', sessionStats.sessionId, 20);

  if (level === 'Instant') {
    if (onEvent) onEvent({ type: 'status', message: '⚡ Running instant mode...' });
    const { messages: instantMessages, rag } = await prepareRagMessages(
      userPrompt,
      contextMessages,
      {
        sessionStats,
        agentRole: 'Instant',
        onEvent
      }
    );
      const res = await callOpenRouter(
        "google/gemma-4-26b-it",
        instantMessages,
        null,
        sessionStats.sandbox,
        "Instant",
        true
      );
      const content = finalizeRagResponse(res?.content, rag);
      // Store conversation turn
      await addMessage('orchestrator', sessionStats.sessionId, 'user', userPrompt);
      await addMessage('orchestrator', sessionStats.sessionId, 'assistant', content);
      return content;
  }

  if (level === 'Swarm' || level === 'Full' || level === 'Thinking') {
    if (onEvent) onEvent({ type: 'status', message: `🏢 Running ${level} mode...` });
    
    const { messages: orchestratorMessages, rag } = await prepareRagMessages(
      userPrompt,
      contextMessages,
      {
        sessionStats,
        agentRole: 'CEO',
        onEvent
      }
    );
      const res = await callOpenRouter(
        orchestrator.model,
        orchestratorMessages,
        orchestrator.fallbackModel,
        sessionStats.sandbox,
        "CEO",
        true
      );
      const content = finalizeRagResponse(res?.content, rag);
      // Store conversation turn
      await addMessage('orchestrator', sessionStats.sessionId, 'user', userPrompt);
      await addMessage('orchestrator', sessionStats.sessionId, 'assistant', content);
      return content;
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

  // Check quota before proceeding
  await checkQuotaBeforeCall();

  const agent = agentsData.agents.find(a => a.id === agentId);
  if (!agent) {
    throw new AgentError(`Agent with ID ${agentId} not found`, { availableAgents: agentsData.agents.map(a => a.id) });
  }

  logger.info({ agentId, agentRole: agent.role, prompt: prompt.substring(0, 100) }, 'Running single agent');

  if (onEvent) onEvent({ type: 'agent_start', agent: agent.role, task: prompt.substring(0, 50) });

  const { messages, rag } = await prepareRagMessages(prompt, [], {
    sessionStats,
    agentId,
    agentRole: agent.role,
    onEvent
  });
  
  const res = await callOpenRouter(
    agent.model, 
    messages,
    agent.fallbackModel, 
    sessionStats.sandbox, 
    agent.role, 
    true
  );
  
  return finalizeRagResponse(res?.content, rag);
}

/**
 * Get circuit breaker health status
 */
function getCircuitBreakerStatus() {
  return openRouterCircuitBreaker.getStatus();
}

/**
 * Reset circuit breaker manually
 */
function resetCircuitBreaker() {
  openRouterCircuitBreaker.reset();
  logger.info('Circuit breaker manually reset');
}

module.exports = {
  orchestrate,
  runSingleAgent,
  callOpenRouter,
  prepareRagMessages,
  finalizeRagResponse,
  getCircuitBreakerStatus,
  resetCircuitBreaker,
  updateAnalytics
};
