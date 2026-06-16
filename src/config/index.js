/**
 * Configuration loader with Zod validation
 * Fail-fast on startup with descriptive errors
 */

const { z } = require('zod');
const { envSchema } = require('./schema.js');
const { ConfigError } = require('../utils/errors.js');
const path = require('path');
const { subscribe, unsubscribe, startWatching } = require('./loader.js');

// Load .env file
require('dotenv').config({ 
  path: process.env.ORCA_CONFIG_PATH || path.join(__dirname, '../../.env') 
});

let validatedConfig = null;

/**
 * Validate and load environment variables
 * @returns {Object} Typed configuration object
 * @throws {ConfigError} On validation failure
 */
function loadConfig() {
  if (validatedConfig) {
    return validatedConfig;
  }

  try {
    const parsed = envSchema.parse(process.env);
    
    // Transform string booleans to actual booleans
    validatedConfig = {
      ...parsed,
      ORCA_SANDBOX: parsed.ORCA_SANDBOX === 'true',
      ORCA_ANALYTICS_ENABLED: parsed.ORCA_ANALYTICS_ENABLED === 'true',
      ORCA_MCP_ENABLED: parsed.ORCA_MCP_ENABLED === 'true',
      ORCA_SWARM_ENABLED: parsed.ORCA_SWARM_ENABLED === 'true',
      ORCA_MAX_RETRIES: parseInt(parsed.ORCA_MAX_RETRIES, 10),
      ORCA_TIMEOUT: parseInt(parsed.ORCA_TIMEOUT, 10),
      ORCA_ANALYTICS_RETENTION_DAYS: parseInt(parsed.ORCA_ANALYTICS_RETENTION_DAYS, 10),
      ORCA_PORT: parseInt(parsed.ORCA_PORT, 10),
      ORCA_MODEL_HEALTH_INTERVAL_MS: parseInt(parsed.ORCA_MODEL_HEALTH_INTERVAL_MS, 10),
      ORCA_MODEL_MAX_FALLBACKS: parseInt(parsed.ORCA_MODEL_MAX_FALLBACKS, 10),
      ORCA_MODEL_LATENCY_BUDGET_MS: parseInt(parsed.ORCA_MODEL_LATENCY_BUDGET_MS, 10),
      ORCA_MODEL_FAILURE_THRESHOLD: parseInt(parsed.ORCA_MODEL_FAILURE_THRESHOLD, 10),
    };

    return validatedConfig;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('\n  - ');
      throw new ConfigError(
        `Environment validation failed:\n  - ${issues}`,
        { 
          hint: 'Check your .env file or environment variables. Run: cp .env.example .env',
          docs: 'https://github.com/elkhedr-ai/elkhedr-orca#configuration'
        }
      );
    }
    throw error;
  }
}

/**
 * Get current config (must call loadConfig first)
 * @returns {Object} Configuration object
 */
function getConfig() {
  if (!validatedConfig) {
    throw new ConfigError('Config not loaded. Call loadConfig() first.', {
      hint: 'Import and call loadConfig() at application startup'
    });
  }
  return validatedConfig;
}

/**
 * Reload configuration (useful for testing)
 */
function reloadConfig() {
  validatedConfig = null;
  return loadConfig();
}

/**
 * Start hot reload watching for config files
 */
function watchConfig(options = {}) {
  return startWatching({
    envPath: process.env.ORCA_CONFIG_PATH || path.join(__dirname, '../../.env'),
    configPaths: options.configPaths || [],
    reloadFn: reloadConfig,
    getConfigFn: getConfig
  });
}

module.exports = {
  loadConfig,
  getConfig,
  reloadConfig,
  watchConfig,
  subscribe,
  unsubscribe,
  envSchema
};
