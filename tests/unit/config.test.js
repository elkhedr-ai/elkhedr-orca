/**
 * Unit tests for configuration system
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');

// Save original env
const originalEnv = { ...process.env };

describe('Config Schema', () => {
  // Reload config module for each test
  let configModule;

  it('should validate required OPENROUTER_API_KEY', async () => {
    // Clear module cache
    delete require.cache[require.resolve('../../src/config/index.js')];
    delete require.cache[require.resolve('../../src/config/schema.js')];
    
    process.env = { 
      ...originalEnv,
      OPENROUTER_API_KEY: 'sk-test-key-123' 
    };
    
    const { loadConfig, getConfig } = require('../../src/config/index.js');
    loadConfig();
    const config = getConfig();
    assert.strictEqual(config.OPENROUTER_API_KEY, 'sk-test-key-123');
  });

  it('should fail without OPENROUTER_API_KEY', async () => {
    delete require.cache[require.resolve('../../src/config/index.js')];
    delete require.cache[require.resolve('../../src/config/schema.js')];
    
    process.env = { ...originalEnv };
    process.env.OPENROUTER_API_KEY = ''; // Empty string should fail min(1) validation
    
    const { loadConfig } = require('../../src/config/index.js');
    assert.throws(() => loadConfig(), /OPENROUTER_API_KEY/);
  });

  it('should apply default values', async () => {
    delete require.cache[require.resolve('../../src/config/index.js')];
    delete require.cache[require.resolve('../../src/config/schema.js')];
    
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'sk-test-key-123'
    };
    
    const { loadConfig, getConfig } = require('../../src/config/index.js');
    loadConfig();
    const config = getConfig();
    
    assert.strictEqual(config.ORCA_LOG_LEVEL, 'info');
    assert.strictEqual(config.ORCA_SANDBOX, true);
    assert.strictEqual(config.ORCA_MAX_RETRIES, 3);
    assert.strictEqual(config.ORCA_TIMEOUT, 60000);
    assert.strictEqual(config.ORCA_PORT, 3000);
    assert.strictEqual(config.ORCA_ANALYTICS_ENABLED, true);
    assert.strictEqual(config.ORCA_MCP_ENABLED, true);
  });

  it('should parse custom values', async () => {
    delete require.cache[require.resolve('../../src/config/index.js')];
    delete require.cache[require.resolve('../../src/config/schema.js')];
    
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'sk-test-key-123',
      ORCA_LOG_LEVEL: 'debug',
      ORCA_SANDBOX: 'false',
      ORCA_MAX_RETRIES: '5',
      ORCA_PORT: '8080'
    };
    
    const { loadConfig, getConfig } = require('../../src/config/index.js');
    loadConfig();
    const config = getConfig();
    
    assert.strictEqual(config.ORCA_LOG_LEVEL, 'debug');
    assert.strictEqual(config.ORCA_SANDBOX, false);
    assert.strictEqual(config.ORCA_MAX_RETRIES, 5);
    assert.strictEqual(config.ORCA_PORT, 8080);
  });

  it('should reload configuration', async () => {
    delete require.cache[require.resolve('../../src/config/index.js')];
    delete require.cache[require.resolve('../../src/config/schema.js')];
    
    process.env = {
      ...originalEnv,
      OPENROUTER_API_KEY: 'sk-test-key-123',
      ORCA_LOG_LEVEL: 'warn'
    };
    
    const { loadConfig, getConfig, reloadConfig } = require('../../src/config/index.js');
    loadConfig();
    
    process.env.ORCA_LOG_LEVEL = 'error';
    reloadConfig();
    
    const config = getConfig();
    assert.strictEqual(config.ORCA_LOG_LEVEL, 'error');
  });
});

// Restore original env after all tests
process.env = originalEnv;
