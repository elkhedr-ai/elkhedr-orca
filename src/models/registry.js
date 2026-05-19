/**
 * Model Registry
 * Centralizes model configuration, health state, routing, and fallbacks.
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger.js');
const {
  DEFAULT_HEALTH_CHECK_INTERVAL_MS,
  HEALTH_STATUS,
  ModelHealthMonitor
} = require('./health.js');

const UNIVERSAL_FALLBACK = 'google/gemma-4-26b-a4b-it';

const DEFAULT_MODELS = [
  {
    id: 'openrouter-gpt-4',
    name: 'GPT-4',
    provider: 'openrouter',
    model: 'openai/gpt-4',
    costPer1kTokens: 0.03,
    qualityScore: 9.0,
    maxTokens: 8192,
    isDefault: true,
    source: 'default'
  },
  {
    id: 'openrouter-claude-3',
    name: 'Claude 3',
    provider: 'openrouter',
    model: 'anthropic/claude-3-opus',
    costPer1kTokens: 0.015,
    qualityScore: 9.0,
    maxTokens: 200000,
    isDefault: false,
    source: 'default'
  },
  {
    id: 'openrouter-llama-3',
    name: 'Llama 3',
    provider: 'openrouter',
    model: 'meta-llama/llama-3-70b-instruct',
    costPer1kTokens: 0.0009,
    qualityScore: 7.5,
    maxTokens: 8192,
    isDefault: false,
    source: 'default'
  }
];

const ROUTING_WEIGHTS = {
  balanced: { health: 0.2, quality: 0.35, cost: 0.25, latency: 0.2 },
  cost: { health: 0.15, quality: 0.2, cost: 0.5, latency: 0.15 },
  quality: { health: 0.15, quality: 0.55, cost: 0.1, latency: 0.2 },
  latency: { health: 0.15, quality: 0.2, cost: 0.1, latency: 0.55 }
};

function getConfigValue(key, fallback) {
  try {
    const { getConfig } = require('../config/index.js');
    const value = getConfig()[key];
    return value === undefined || value === null || value === '' ? fallback : value;
  } catch {
    return process.env[key] === undefined || process.env[key] === '' ? fallback : process.env[key];
  }
}

function parseNumber(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeModelId(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function inferProvider(model) {
  if (!model) return 'openrouter';
  if (model.startsWith('ollama:')) return 'local';
  if (model.startsWith('lmstudio:')) return 'local';
  return 'openrouter';
}

function inferModelProfile(model) {
  const value = String(model || '').toLowerCase();
  const profiles = [
    { match: 'anthropic/', cost: 0.015, quality: 9.0, maxTokens: 200000 },
    { match: 'openai/', cost: 0.03, quality: 9.0, maxTokens: 128000 },
    { match: 'x-ai/', cost: 0.005, quality: 8.6, maxTokens: 128000 },
    { match: 'deepseek/', cost: 0.0015, quality: 8.4, maxTokens: 64000 },
    { match: 'google/gemma-4-31b', cost: 0.0008, quality: 7.8, maxTokens: 32768 },
    { match: 'google/gemma-4-26b', cost: 0.0005, quality: 7.5, maxTokens: 32768 },
    { match: 'google/', cost: 0.0006, quality: 7.3, maxTokens: 32768 },
    { match: 'qwen/', cost: 0.0007, quality: 7.6, maxTokens: 32768 },
    { match: 'mistralai/', cost: 0.001, quality: 7.6, maxTokens: 32768 },
    { match: 'meta-llama/', cost: 0.0009, quality: 7.4, maxTokens: 32768 },
    { match: 'nvidia/', cost: 0.0009, quality: 7.3, maxTokens: 32768 },
    { match: 'z-ai/', cost: 0.0007, quality: 7.2, maxTokens: 32768 },
    { match: 'local:', cost: 0, quality: 6.8, maxTokens: 8192 }
  ];

  const found = profiles.find(profile => value.includes(profile.match));
  return found || { cost: 0.001, quality: 6.8, maxTokens: 8192 };
}

function loadAgentsData() {
  const agentsPath = path.join(__dirname, '..', 'agents.json');
  if (!fs.existsSync(agentsPath)) {
    return { orchestrator: null, agents: [] };
  }
  return JSON.parse(fs.readFileSync(agentsPath, 'utf8'));
}

function buildModelConfig(modelName, attributes = {}) {
  const profile = inferModelProfile(modelName);
  const provider = attributes.provider || inferProvider(modelName);
  const model = {
    id: attributes.id || `${provider}-${normalizeModelId(modelName)}`,
    name: attributes.name || modelName,
    provider,
    model: modelName,
    endpoint: attributes.endpoint,
    costPer1kTokens: attributes.costPer1kTokens ?? profile.cost,
    qualityScore: attributes.qualityScore ?? profile.quality,
    maxTokens: attributes.maxTokens ?? profile.maxTokens,
    fallbackModel: attributes.fallbackModel,
    agentRoles: attributes.agentRoles || [],
    source: attributes.source || 'dynamic',
    isDefault: attributes.isDefault || false,
    health: attributes.health,
    metrics: attributes.metrics
  };

  return model;
}

function buildAgentModelConfigs(agentsData = loadAgentsData()) {
  const configs = new Map();

  const addModel = (modelName, role, fallbackModel, source) => {
    if (!modelName) return;
    const provider = inferProvider(modelName);
    const id = `${provider}-${normalizeModelId(modelName)}`;
    const existing = configs.get(modelName);
    if (existing) {
      existing.agentRoles = Array.from(new Set([...existing.agentRoles, role].filter(Boolean)));
      if (!existing.fallbackModel && fallbackModel) existing.fallbackModel = fallbackModel;
      return;
    }

    configs.set(modelName, buildModelConfig(modelName, {
      id,
      fallbackModel,
      agentRoles: role ? [role] : [],
      source
    }));
  };

  if (agentsData.orchestrator) {
    addModel(
      agentsData.orchestrator.model,
      agentsData.orchestrator.role || 'orchestrator',
      agentsData.orchestrator.fallbackModel,
      'agents.json'
    );
    addModel(
      agentsData.orchestrator.fallbackModel,
      `${agentsData.orchestrator.role || 'orchestrator'} fallback`,
      UNIVERSAL_FALLBACK,
      'agents.json'
    );
  }

  for (const agent of agentsData.agents || []) {
    addModel(agent.model, agent.role, agent.fallbackModel, 'agents.json');
    addModel(agent.fallbackModel, `${agent.role} fallback`, UNIVERSAL_FALLBACK, 'agents.json');
  }

  addModel(UNIVERSAL_FALLBACK, 'Universal Fallback', null, 'built-in');
  return Array.from(configs.values());
}

class ModelRegistry {
  constructor(options = {}) {
    this.models = new Map();
    this.aliases = new Map();
    this.healthCheckInterval = parseInteger(
      options.healthCheckInterval ?? getConfigValue('ORCA_MODEL_HEALTH_INTERVAL_MS', DEFAULT_HEALTH_CHECK_INTERVAL_MS),
      DEFAULT_HEALTH_CHECK_INTERVAL_MS
    );
    this.routingStrategy = options.routingStrategy || getConfigValue('ORCA_MODEL_ROUTING_STRATEGY', 'balanced');
    this.maxFallbacks = parseInteger(options.maxFallbacks ?? getConfigValue('ORCA_MODEL_MAX_FALLBACKS', 3), 3);
    this.latencyBudgetMs = parseInteger(options.latencyBudgetMs ?? getConfigValue('ORCA_MODEL_LATENCY_BUDGET_MS', 30000), 30000);
    this.failureThreshold = parseInteger(options.failureThreshold ?? getConfigValue('ORCA_MODEL_FAILURE_THRESHOLD', 1), 1);
    this.healthMonitor = options.healthMonitor || new ModelHealthMonitor({
      intervalMs: this.healthCheckInterval,
      checker: options.healthChecker,
      logger
    });

    this.initModels(options.models, options.agentsData);
  }

  initModels(models, agentsData) {
    const sourceModels = models || [
      ...DEFAULT_MODELS,
      ...buildAgentModelConfigs(agentsData)
    ];

    for (const model of sourceModels) {
      this.registerModel(model, { replace: false });
    }
  }

  registerModel(config, options = {}) {
    const modelName = config.model || config.id;
    const profile = inferModelProfile(modelName);
    const id = config.id || `${config.provider || inferProvider(modelName)}-${normalizeModelId(modelName)}`;
    const existing = this.models.get(id) || this.getModel(modelName);

    if (existing && options.replace === false) {
      existing.agentRoles = Array.from(new Set([
        ...(existing.agentRoles || []),
        ...(config.agentRoles || [])
      ]));
      existing.aliases = Array.from(new Set([...(existing.aliases || []), id, modelName]));
      this._indexModel(existing);
      return existing;
    }

    const model = {
      id,
      name: config.name || modelName,
      provider: config.provider || inferProvider(modelName),
      model: modelName,
      endpoint: config.endpoint,
      costPer1kTokens: config.costPer1kTokens ?? profile.cost,
      qualityScore: config.qualityScore ?? profile.quality,
      maxTokens: config.maxTokens ?? profile.maxTokens,
      fallbackModel: config.fallbackModel || null,
      agentRoles: config.agentRoles || [],
      source: config.source || 'dynamic',
      isDefault: Boolean(config.isDefault),
      health: {
        status: HEALTH_STATUS.UNKNOWN,
        lastCheck: null,
        latency: null,
        ...(config.health || {})
      },
      metrics: {
        requests: 0,
        successes: 0,
        failures: 0,
        consecutiveFailures: 0,
        totalLatency: 0,
        averageLatency: null,
        totalTokens: 0,
        totalCost: 0,
        lastUsed: null,
        lastSuccess: null,
        lastFailure: null,
        ...(config.metrics || {})
      }
    };

    this.models.set(model.id, model);
    this._indexModel(model);
    logger.debug({ modelId: model.id, model: model.model }, 'Model registered');
    return model;
  }

  _indexModel(model) {
    const aliases = new Set([model.id, model.model, normalizeModelId(model.model), ...(model.aliases || [])]);
    for (const alias of aliases) {
      if (alias) this.aliases.set(alias, model.id);
    }
  }

  ensureModel(modelName, attributes = {}) {
    if (!modelName) return null;
    const existing = this.getModel(modelName);
    if (existing) return existing;
    return this.registerModel(buildModelConfig(modelName, attributes));
  }

  getModel(idOrModel) {
    if (!idOrModel) return undefined;
    const direct = this.models.get(idOrModel);
    if (direct) return direct;

    const aliasId = this.aliases.get(idOrModel) || this.aliases.get(normalizeModelId(idOrModel));
    return aliasId ? this.models.get(aliasId) : undefined;
  }

  getAllModels() {
    return Array.from(this.models.values());
  }

  setModelHealth(idOrModel, health) {
    const model = this.ensureModel(idOrModel);
    if (!model) return null;
    model.health = {
      ...model.health,
      ...health,
      status: health.status || model.health.status,
      lastCheck: health.lastCheck || new Date().toISOString()
    };
    return model.health;
  }

  isRoutable(model, options = {}) {
    if (!model) return false;
    if (model.health?.status === HEALTH_STATUS.UNHEALTHY) return false;
    if (options.maxCost !== undefined && model.costPer1kTokens > options.maxCost) return false;
    if (options.minQuality !== undefined && model.qualityScore < options.minQuality) return false;
    return true;
  }

  scoreModel(model, options = {}) {
    const strategy = options.strategy || this.routingStrategy;
    const weights = ROUTING_WEIGHTS[strategy] || ROUTING_WEIGHTS.balanced;
    const healthStatus = model.health?.status || HEALTH_STATUS.UNKNOWN;
    const healthScore = healthStatus === HEALTH_STATUS.HEALTHY
      ? 1
      : healthStatus === HEALTH_STATUS.UNKNOWN
        ? 0.65
        : 0;
    const qualityScore = Math.max(0, Math.min(1, (model.qualityScore || 0) / 10));
    const costCeiling = parseNumber(options.costCeiling, 0.05);
    const costScore = 1 - Math.min(model.costPer1kTokens || 0, costCeiling) / costCeiling;
    const latency = model.metrics?.averageLatency || model.health?.latency;
    const latencyScore = latency
      ? Math.max(0, 1 - Math.min(latency, this.latencyBudgetMs) / this.latencyBudgetMs)
      : 0.6;

    return (
      weights.health * healthScore +
      weights.quality * qualityScore +
      weights.cost * costScore +
      weights.latency * latencyScore
    );
  }

  getHealthyModels(options = {}) {
    return this.getAllModels()
      .filter(model => this.isRoutable(model, options))
      .sort((a, b) => this.scoreModel(b, options) - this.scoreModel(a, options));
  }

  getDefaultModel(options = {}) {
    const configured = this.getAllModels().find(model => model.isDefault && this.isRoutable(model, options));
    return configured || this.getHealthyModels(options)[0] || this.getAllModels()[0];
  }

  routeModel(options = {}) {
    const {
      preferredModel,
      fallbackModels = [],
      fallbackModel,
      respectPreferred = true,
      maxCost,
      minQuality,
      strategy
    } = options;
    const constraints = { maxCost, minQuality, strategy };

    const preferred = preferredModel ? this.ensureModel(preferredModel) : null;
    const fallbacks = [...fallbackModels, fallbackModel].filter(Boolean).map(model => this.ensureModel(model));

    if (respectPreferred && this.isRoutable(preferred, constraints)) {
      return preferred;
    }

    const explicitFallback = fallbacks.find(model => this.isRoutable(model, constraints));
    if (explicitFallback) {
      return explicitFallback;
    }

    return this.getHealthyModels(constraints)[0] || this.getDefaultModel(constraints);
  }

  buildFallbackChain(options = {}) {
    const fallbackModels = [
      ...(Array.isArray(options.fallbackModels) ? options.fallbackModels : []),
      options.fallbackModel,
      options.universalFallback || UNIVERSAL_FALLBACK
    ].filter(Boolean);

    const routed = this.routeModel({
      ...options,
      fallbackModels,
      respectPreferred: options.respectPreferred !== false
    });
    const candidates = [
      routed,
      options.preferredModel ? this.ensureModel(options.preferredModel) : null,
      ...fallbackModels.map(model => this.ensureModel(model)),
      ...this.getHealthyModels(options)
    ].filter(Boolean);

    const seen = new Set();
    const chain = [];
    for (const candidate of candidates) {
      if (!this.isRoutable(candidate, options)) continue;
      if (seen.has(candidate.model)) continue;
      seen.add(candidate.model);
      chain.push(candidate);
      if (chain.length >= (options.maxAttempts || this.maxFallbacks)) break;
    }

    return chain.length > 0 ? chain : [this.getDefaultModel(options)].filter(Boolean);
  }

  async checkModelHealth(modelId) {
    const model = this.ensureModel(modelId);
    if (!model) return false;

    const health = await this.healthMonitor.check(model);
    model.health = health;
    logger.info({ modelId: model.id, status: health.status, latency: health.latency }, 'Model health check');
    return health.status === HEALTH_STATUS.HEALTHY;
  }

  async runHealthChecks() {
    logger.info('Running model health checks...');
    const results = await this.healthMonitor.run(this.getAllModels(), (model, health) => {
      model.health = health;
    });
    const healthy = results.filter(result => result.health.status === HEALTH_STATUS.HEALTHY).length;
    logger.info({ total: this.models.size, healthy }, 'Health checks complete');
    return { total: this.models.size, healthy, results };
  }

  startHealthChecks(options = {}) {
    this.healthMonitor.start(
      () => this.getAllModels(),
      (model, health) => {
        model.health = health;
      },
      { runImmediately: options.runImmediately !== false }
    );
    logger.info({ interval: this.healthMonitor.intervalMs }, 'Health checks started');
  }

  stopHealthChecks() {
    this.healthMonitor.stop();
  }

  /**
   * Discover and register models from local providers (Ollama/LM Studio)
   */
  async discoverLocalModels(localClient) {
    if (!localClient) return 0;

    try {
      const models = await localClient.listModels();
      let count = 0;

      for (const model of models) {
        this.registerModel({
          id: model.id,
          name: model.name,
          provider: 'local',
          model: model.name,
          endpoint: model.endpoint,
          costPer1kTokens: 0,
          qualityScore: 6.8,
          maxTokens: 8192,
          source: 'local-discovery',
          health: {
            status: HEALTH_STATUS.HEALTHY,
            lastCheck: new Date().toISOString(),
            latency: null
          }
        }, { replace: true });
        count++;
      }

      logger.info({ count }, 'Local models discovered and registered');
      return count;
    } catch (error) {
      logger.warn({ error: error.message }, 'Local model discovery failed');
      return 0;
    }
  }

  /**
   * Get all models with provider === 'local'
   */
  getLocalModels() {
    return this.getAllModels().filter(m => m.provider === 'local');
  }

  recordModelSuccess(idOrModel, usage = {}) {
    const model = this.ensureModel(idOrModel);
    if (!model) return null;

    const latency = usage.latency;
    model.metrics.requests += 1;
    model.metrics.successes += 1;
    model.metrics.consecutiveFailures = 0;
    model.metrics.lastUsed = new Date().toISOString();
    model.metrics.lastSuccess = model.metrics.lastUsed;
    model.metrics.totalTokens += usage.tokens || 0;
    model.metrics.totalCost += usage.cost || 0;

    if (Number.isFinite(latency)) {
      model.metrics.totalLatency += latency;
      model.metrics.averageLatency = model.metrics.totalLatency / model.metrics.successes;
      model.health.latency = latency;
    }

    model.health.status = HEALTH_STATUS.HEALTHY;
    model.health.lastCheck = model.metrics.lastSuccess;
    delete model.health.error;
    return model;
  }

  recordModelFailure(idOrModel, error = {}) {
    const model = this.ensureModel(idOrModel);
    if (!model) return null;

    const message = error.message || String(error);
    model.metrics.requests += 1;
    model.metrics.failures += 1;
    model.metrics.consecutiveFailures += 1;
    model.metrics.lastUsed = new Date().toISOString();
    model.metrics.lastFailure = model.metrics.lastUsed;
    model.health.lastCheck = model.metrics.lastFailure;
    model.health.error = message;

    if (model.metrics.consecutiveFailures >= this.failureThreshold) {
      model.health.status = HEALTH_STATUS.UNHEALTHY;
    }

    return model;
  }

  getCostOptimizationSuggestions(options = {}) {
    const minSavingsPercent = parseNumber(options.minSavingsPercent, 10);
    const maxQualityDrop = parseNumber(options.maxQualityDrop, 0.5);
    const candidates = this.getHealthyModels({ strategy: 'cost' });
    const suggestions = [];

    for (const model of this.getAllModels()) {
      if (!this.isRoutable(model)) continue;
      const replacement = candidates.find(candidate => (
        candidate.model !== model.model &&
        candidate.costPer1kTokens < model.costPer1kTokens &&
        candidate.qualityScore >= model.qualityScore - maxQualityDrop
      ));

      if (!replacement) continue;
      const savings = ((model.costPer1kTokens - replacement.costPer1kTokens) / model.costPer1kTokens) * 100;
      if (savings < minSavingsPercent) continue;

      suggestions.push({
        model: model.model,
        suggestedModel: replacement.model,
        currentCostPer1kTokens: model.costPer1kTokens,
        suggestedCostPer1kTokens: replacement.costPer1kTokens,
        estimatedSavingsPercent: Math.round(savings),
        qualityDelta: Number((replacement.qualityScore - model.qualityScore).toFixed(2)),
        reason: `${replacement.model} has similar quality at lower estimated token cost.`
      });
    }

    return suggestions;
  }

  getStats() {
    const models = this.getAllModels();
    return {
      total: models.length,
      healthy: models.filter(model => model.health.status === HEALTH_STATUS.HEALTHY).length,
      unhealthy: models.filter(model => model.health.status === HEALTH_STATUS.UNHEALTHY).length,
      unknown: models.filter(model => model.health.status === HEALTH_STATUS.UNKNOWN).length,
      routingStrategy: this.routingStrategy,
      healthCheckInterval: this.healthCheckInterval,
      suggestions: this.getCostOptimizationSuggestions(),
      models: models.map(model => ({
        id: model.id,
        name: model.name,
        provider: model.provider,
        model: model.model,
        status: model.health.status,
        latency: model.health.latency,
        averageLatency: model.metrics.averageLatency,
        qualityScore: model.qualityScore,
        costPer1kTokens: model.costPer1kTokens,
        requests: model.metrics.requests,
        failures: model.metrics.failures,
        source: model.source
      }))
    };
  }
}

let instance = null;

function getModelRegistry(options = {}) {
  if (!instance || options.reset) {
    instance = new ModelRegistry(options);
  }
  return instance;
}

function resetModelRegistry(options = {}) {
  if (instance) {
    instance.stopHealthChecks();
  }
  instance = new ModelRegistry(options);
  return instance;
}

module.exports = {
  DEFAULT_MODELS,
  HEALTH_STATUS,
  ModelRegistry,
  buildAgentModelConfigs,
  getModelRegistry,
  resetModelRegistry
};
