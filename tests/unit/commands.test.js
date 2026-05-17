/**
 * Tests for CommandRegistry
 */

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { CommandRegistry } = require('../../src/commands.js');

// Mock @clack/prompts
const mockLog = {
  success: () => {},
  warn: () => {},
  info: () => {},
  error: () => {}
};

require.cache[require.resolve('@clack/prompts')] = {
  id: require.resolve('@clack/prompts'),
  filename: require.resolve('@clack/prompts'),
  loaded: true,
  exports: {
    log: mockLog,
    outro: () => {},
    spinner: () => ({ start: () => {}, stop: () => {} })
  }
};

// Mock enquirer
require.cache[require.resolve('enquirer')] = {
  id: require.resolve('enquirer'),
  filename: require.resolve('enquirer'),
  loaded: true,
  exports: class MockEnquirer {
    constructor() {}
    async run() { return this.mockValue || 'default'; }
  }
};

// Mock core.js circuit breaker
require.cache[require.resolve('../../src/core.js')] = {
  id: require.resolve('../../src/core.js'),
  filename: require.resolve('../../src/core.js'),
  loaded: true,
  exports: {
    getCircuitBreakerStatus: () => ({
      name: 'openrouter',
      state: 'CLOSED',
      isHealthy: true,
      failureCount: 0,
      failureThreshold: 5,
      successCount: 0,
      successThreshold: 2
    }),
    resetCircuitBreaker: () => {}
  }
};

// Mock config
require.cache[require.resolve('../../src/config/index.js')] = {
  id: require.resolve('../../src/config/index.js'),
  filename: require.resolve('../../src/config/index.js'),
  loaded: true,
  exports: {
    reloadConfig: () => ({ ORCA_LOG_LEVEL: 'info' }),
    getConfig: () => ({ ORCA_LOG_LEVEL: 'info' }),
    subscribe: () => () => {},
    unsubscribe: () => {}
  }
};

// Mock marketplace
require.cache[require.resolve('../../src/plugins/marketplace.js')] = {
  id: require.resolve('../../src/plugins/marketplace.js'),
  filename: require.resolve('../../src/plugins/marketplace.js'),
  loaded: true,
  exports: {
    installSkill: async () => ({ success: true, name: 'test-skill', version: '1.0.0', path: '/test', permissions: [] }),
    uninstallSkill: async () => ({ success: true, name: 'test-skill' }),
    listInstalledSkills: () => []
  }
};

// Mock registry
require.cache[require.resolve('../../src/plugins/registry.js')] = {
  id: require.resolve('../../src/plugins/registry.js'),
  filename: require.resolve('../../src/plugins/registry.js'),
  loaded: true,
  exports: {
    registry: {
      list: () => [],
      has: () => false,
      reset: () => {}
    }
  }
};

describe('CommandRegistry', () => {
  let sessionStats;
  let registry;

  beforeEach(() => {
    sessionStats = {
      sandbox: false,
      currentAgent: null,
      level: 'Auto'
    };
    registry = new CommandRegistry(sessionStats, null);
  });

  describe('execute', () => {
    it('should parse command and arguments', async () => {
      const result = await registry.execute('/sandbox on');
      assert.strictEqual(result, true);
      assert.strictEqual(sessionStats.sandbox, true);
    });

    it('should return false for unknown commands', async () => {
      const result = await registry.execute('/unknown-cmd');
      assert.strictEqual(result, false);
    });

    it('should handle commands without arguments', async () => {
      const result = await registry.execute('/reset');
      assert.strictEqual(result, true);
      assert.strictEqual(sessionStats.currentAgent, null);
    });
  });

  describe('sandbox', () => {
    it('should toggle sandbox when no args', async () => {
      sessionStats.sandbox = false;
      await registry.execute('/sandbox');
      assert.strictEqual(sessionStats.sandbox, true);

      await registry.execute('/sandbox');
      assert.strictEqual(sessionStats.sandbox, false);
    });

    it('should turn sandbox on', async () => {
      sessionStats.sandbox = false;
      await registry.execute('/sandbox on');
      assert.strictEqual(sessionStats.sandbox, true);
    });

    it('should turn sandbox off', async () => {
      sessionStats.sandbox = true;
      await registry.execute('/sandbox off');
      assert.strictEqual(sessionStats.sandbox, false);
    });
  });

  describe('reset', () => {
    it('should clear current agent', async () => {
      sessionStats.currentAgent = { id: 'test-agent' };
      await registry.execute('/reset');
      assert.strictEqual(sessionStats.currentAgent, null);
    });
  });

  describe('level', () => {
    it('should exist in command list', () => {
      const commands = registry.getCommandList();
      const levelCmd = commands.find(c => c.name === '/level');
      assert.ok(levelCmd);
      assert.ok(levelCmd.message.includes('/level'));
    });
  });

  describe('health', () => {
    it('should exist in command list', () => {
      const commands = registry.getCommandList();
      const healthCmd = commands.find(c => c.name === '/health');
      assert.ok(healthCmd);
    });
  });

  describe('install-skill', () => {
    it('should exist in command list', () => {
      const commands = registry.getCommandList();
      const cmd = commands.find(c => c.name === '/install-skill');
      assert.ok(cmd);
    });
  });

  describe('uninstall-skill', () => {
    it('should exist in command list', () => {
      const commands = registry.getCommandList();
      const cmd = commands.find(c => c.name === '/uninstall-skill');
      assert.ok(cmd);
    });
  });

  describe('list-skills', () => {
    it('should exist in command list', () => {
      const commands = registry.getCommandList();
      const cmd = commands.find(c => c.name === '/list-skills');
      assert.ok(cmd);
    });
  });

  describe('reload-config', () => {
    it('should exist in command list', () => {
      const commands = registry.getCommandList();
      const cmd = commands.find(c => c.name === '/reload-config');
      assert.ok(cmd);
    });
  });

  describe('getCommandList', () => {
    it('should return all commands', () => {
      const commands = registry.getCommandList();
      assert.ok(commands.length > 10);
      
      const names = commands.map(c => c.name);
      assert.ok(names.includes('/sandbox'));
      assert.ok(names.includes('/agents'));
      assert.ok(names.includes('/exit'));
      assert.ok(names.includes('/health'));
    });

    it('should format command descriptions', () => {
      const commands = registry.getCommandList();
      const sandbox = commands.find(c => c.name === '/sandbox');
      assert.ok(sandbox.message.includes('/sandbox'));
      assert.ok(sandbox.message.includes('sandbox'));
    });
  });

  describe('clear', () => {
    it('should be in command list', () => {
      const commands = registry.getCommandList();
      assert.ok(commands.some(c => c.name === '/clear'));
    });
  });
});
