/**
 * Model health checking helpers.
 */

const axios = require('axios');

const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 60000;

const HEALTH_STATUS = {
  HEALTHY: 'healthy',
  UNHEALTHY: 'unhealthy',
  UNKNOWN: 'unknown'
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

async function defaultHealthChecker(model, options = {}) {
  const axiosClient = options.axiosClient || axios;
  const start = Date.now();

  if (model.provider === 'openrouter') {
    const baseUrl = options.openRouterBaseUrl || getConfigValue('ORCA_OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1');
    const apiKey = options.openRouterApiKey || getConfigValue('OPENROUTER_API_KEY');
    const response = await axiosClient.get(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: options.timeout || 10000
    });
    const available = response.data?.data?.some(item => item.id === model.model);

    return {
      status: available ? HEALTH_STATUS.HEALTHY : HEALTH_STATUS.UNHEALTHY,
      lastCheck: new Date().toISOString(),
      latency: Date.now() - start,
      error: available ? undefined : 'Model not listed by provider'
    };
  }

  if (model.provider === 'local' && model.endpoint) {
    await axiosClient.get(`${model.endpoint.replace(/\/$/, '')}/health`, {
      timeout: options.timeout || 5000
    });
    return {
      status: HEALTH_STATUS.HEALTHY,
      lastCheck: new Date().toISOString(),
      latency: Date.now() - start
    };
  }

  return {
    status: HEALTH_STATUS.UNKNOWN,
    lastCheck: new Date().toISOString(),
    latency: null,
    error: `No health checker for provider ${model.provider}`
  };
}

class ModelHealthMonitor {
  constructor(options = {}) {
    this.intervalMs = options.intervalMs || DEFAULT_HEALTH_CHECK_INTERVAL_MS;
    this.checker = options.checker || defaultHealthChecker;
    this.logger = options.logger || console;
    this._timer = null;
    this._running = false;
  }

  async check(model) {
    try {
      const health = await this.checker(model);
      return {
        status: health.status || HEALTH_STATUS.UNKNOWN,
        lastCheck: health.lastCheck || new Date().toISOString(),
        latency: health.latency ?? null,
        error: health.error
      };
    } catch (error) {
      return {
        status: HEALTH_STATUS.UNHEALTHY,
        lastCheck: new Date().toISOString(),
        latency: null,
        error: error.message
      };
    }
  }

  async run(models, onHealth) {
    const list = Array.isArray(models) ? models : [];
    const results = await Promise.all(list.map(async model => {
      const health = await this.check(model);
      if (onHealth) onHealth(model, health);
      return { model, health };
    }));
    return results;
  }

  start(getModels, onHealth, options = {}) {
    if (this._timer) {
      return;
    }

    const run = async () => {
      if (this._running) return;
      this._running = true;
      try {
        const models = typeof getModels === 'function' ? getModels() : getModels;
        await this.run(models, onHealth);
      } catch (error) {
        if (this.logger?.warn) {
          this.logger.warn({ error: error.message }, 'Model health monitor failed');
        }
      } finally {
        this._running = false;
      }
    };

    if (options.runImmediately !== false) {
      run();
    }

    this._timer = setInterval(run, this.intervalMs);
    if (typeof this._timer.unref === 'function') {
      this._timer.unref();
    }
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}

module.exports = {
  DEFAULT_HEALTH_CHECK_INTERVAL_MS,
  HEALTH_STATUS,
  ModelHealthMonitor,
  defaultHealthChecker
};
