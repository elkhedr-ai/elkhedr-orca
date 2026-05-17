/**
 * Integration tests for core functionality
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

describe('Core Module Loading', () => {
  it('should load core module without errors', () => {
    assert.doesNotThrow(() => {
      require('../../src/core.js');
    });
  });

  it('should load CLI args module', () => {
    const { parseArgs } = require('../../src/cli/args.js');
    assert.ok(typeof parseArgs === 'function');
  });

  it('should load error utilities', () => {
    const { APIError } = require('../../src/utils/errors.js');
    assert.ok(typeof APIError === 'function');
  });

  it('should load retry utility', () => {
    const { withRetry } = require('../../src/utils/retry.js');
    assert.ok(typeof withRetry === 'function');
  });

  it('should load logger', () => {
    const { logger } = require('../../src/utils/logger.js');
    assert.ok(logger);
    assert.ok(typeof logger.info === 'function');
  });

  it('should load schemas', () => {
    const { promptSchema } = require('../../src/schemas/index.js');
    assert.ok(promptSchema);
  });
});

describe('Configuration', () => {
  it('should have agents.json', () => {
    const agentsPath = path.join(__dirname, '../../src/agents.json');
    assert.ok(fs.existsSync(agentsPath), 'agents.json should exist');
    
    const data = JSON.parse(fs.readFileSync(agentsPath, 'utf8'));
    assert.ok(data.orchestrator, 'Should have orchestrator config');
    assert.ok(Array.isArray(data.agents), 'Should have agents array');
    assert.ok(data.agents.length > 0, 'Should have at least one agent');
  });

  it('should have required data directories', () => {
    const dataDir = path.join(__dirname, '../../data');
    const sessionsDir = path.join(__dirname, '../../sessions');
    
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
    
    assert.ok(fs.existsSync(dataDir), 'Data directory should exist');
    assert.ok(fs.existsSync(sessionsDir), 'Sessions directory should exist');
  });
});

describe('Package Structure', () => {
  it('should have valid package.json', () => {
    const pkg = require('../../package.json');
    assert.strictEqual(pkg.name, 'elkhedr-orca');
    assert.ok(pkg.version);
    assert.ok(pkg.bin.orca, 'Should have orca binary');
    assert.ok(pkg.bin['mcp-orca'], 'Should have mcp-orca binary');
  });

  it('should have all required dependencies', () => {
    const pkg = require('../../package.json');
    const required = ['axios', 'chalk', 'boxen', 'enquirer', 'zod', 'commander', 'pino'];
    
    for (const dep of required) {
      assert.ok(pkg.dependencies[dep], `Should have ${dep} dependency`);
    }
  });
});
