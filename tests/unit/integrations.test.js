/**
 * Tests for T48: Third-Party Integrations
 * Tests IntegrationManager, adapter registration, and CRUD operations.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

// Mock database adapter
const mockRows = { integrations: [], logs: [] };

const mockDb = {
  getAdapter: () => ({
    execute: async (sql, params) => {
      if (sql.includes('CREATE TABLE')) return [];
      if (sql.includes('CREATE INDEX')) return [];

      // INSERT INTO integrations
      if (sql.includes('INSERT INTO integrations')) {
        const integration = {
          id: mockRows.integrations.length + 1,
          user_id: params?.[0],
          provider: params?.[1],
          name: params?.[2],
          credentials: params?.[3],
          config: params?.[4],
          active: 1,
          last_test_at: null,
          last_test_status: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        mockRows.integrations.push(integration);
        return { lastInsertRowid: integration.id, insertId: integration.id };
      }

      // INSERT INTO integration_logs
      if (sql.includes('INSERT INTO integration_logs')) {
        mockRows.logs.push({
          id: mockRows.logs.length + 1,
          integration_id: params?.[0],
          action: params?.[1],
          status: params?.[2],
          request: params?.[3],
          response: params?.[4],
          error: params?.[5],
          latency_ms: params?.[6],
          created_at: new Date().toISOString()
        });
        return { lastInsertRowid: mockRows.logs.length };
      }

      // SELECT * FROM integrations WHERE id AND user_id
      if (sql.includes('SELECT * FROM integrations WHERE id = ? AND user_id = ?')) {
        const row = mockRows.integrations.find(i => i.id === params?.[0] && i.user_id === params?.[1]);
        return row ? [row] : [];
      }

      // SELECT * FROM integrations WHERE user_id
      if (sql.includes('SELECT * FROM integrations WHERE user_id = ?')) {
        return mockRows.integrations.filter(i => i.user_id === params?.[0]);
      }

      // UPDATE integrations
      if (sql.includes('UPDATE integrations SET')) {
        const integrationId = params?.[params.length - 2];
        const integration = mockRows.integrations.find(i => i.id === integrationId);
        if (integration) {
          if (sql.includes('last_test_status')) integration.last_test_status = params?.[0];
          if (sql.includes('name = ?')) integration.name = params?.[0];
          if (sql.includes('active = ?')) integration.active = params?.[0];
        }
        return { changes: integration ? 1 : 0 };
      }

      // DELETE
      if (sql.includes('DELETE FROM integrations')) {
        const idx = mockRows.integrations.findIndex(i => i.id === params?.[0] && i.user_id === params?.[1]);
        if (idx !== -1) {
          mockRows.integrations.splice(idx, 1);
          return { changes: 1 };
        }
        return { changes: 0 };
      }

      // SELECT FROM logs
      if (sql.includes('SELECT * FROM integration_logs')) {
        return mockRows.logs.filter(l => l.integration_id === params?.[0]);
      }

      return [];
    }
  })
};

// Mock modules
require.cache[require.resolve('../../src/db')] = {
  loaded: true,
  exports: { getDatabaseInstance: async () => mockDb }
};

require.cache[require.resolve('../../src/utils/logger.js')] = {
  loaded: true,
  exports: { logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }
};

const { IntegrationManager, ADAPTERS } = require('../../src/integrations/index.js');

describe('T48: Integration Providers', () => {
  it('should list all supported providers', () => {
    const manager = new IntegrationManager();
    const providers = manager.listProviders();

    assert.ok(providers.length >= 5);
    const names = providers.map(p => p.id);
    assert.ok(names.includes('slack'));
    assert.ok(names.includes('discord'));
    assert.ok(names.includes('github'));
    assert.ok(names.includes('jira'));
    assert.ok(names.includes('notion'));
  });

  it('should include capabilities for each provider', () => {
    const manager = new IntegrationManager();
    const providers = manager.listProviders();

    for (const provider of providers) {
      assert.ok(Array.isArray(provider.capabilities));
      assert.ok(provider.capabilities.length > 0);
    }
  });

  it('should have adapter classes for all providers', () => {
    assert.ok(ADAPTERS.slack);
    assert.ok(ADAPTERS.discord);
    assert.ok(ADAPTERS.github);
    assert.ok(ADAPTERS.jira);
    assert.ok(ADAPTERS.notion);
  });
});

describe('T48: IntegrationManager', () => {
  let manager;

  beforeEach(() => {
    mockRows.integrations = [];
    mockRows.logs = [];
    manager = new IntegrationManager();
  });

  it('should register a new integration', async () => {
    const result = await manager.registerIntegration(1, {
      provider: 'slack',
      name: 'My Slack',
      credentials: { botToken: 'xoxb-test' }
    });

    assert.ok(result.id);
    assert.strictEqual(result.provider, 'slack');
    assert.strictEqual(result.name, 'My Slack');
    assert.strictEqual(result.active, true);
  });

  it('should reject unknown providers', async () => {
    await assert.rejects(
      () => manager.registerIntegration(1, {
        provider: 'unknown',
        credentials: {}
      }),
      { message: 'Unknown provider: unknown' }
    );
  });

  it('should list integrations for a user', async () => {
    await manager.registerIntegration(1, { provider: 'slack', credentials: { botToken: 'a' } });
    await manager.registerIntegration(1, { provider: 'github', credentials: { token: 'b' } });
    await manager.registerIntegration(2, { provider: 'discord', credentials: { botToken: 'c' } });

    const list = await manager.listIntegrations(1);
    assert.strictEqual(list.length, 2);
  });

  it('should get a specific integration', async () => {
    const created = await manager.registerIntegration(1, {
      provider: 'github',
      name: 'GitHub',
      credentials: { token: 'ghp_test' }
    });

    const fetched = await manager.getIntegration(created.id, 1);
    assert.ok(fetched);
    assert.strictEqual(fetched.provider, 'github');
    assert.strictEqual(fetched.name, 'GitHub');
  });

  it('should return null for non-existent integration', async () => {
    const fetched = await manager.getIntegration(999, 1);
    assert.strictEqual(fetched, null);
  });

  it('should not return integrations belonging to other users', async () => {
    const created = await manager.registerIntegration(1, {
      provider: 'slack',
      credentials: { botToken: 'test' }
    });

    const fetched = await manager.getIntegration(created.id, 2);
    assert.strictEqual(fetched, null);
  });

  it('should update an integration', async () => {
    const created = await manager.registerIntegration(1, {
      provider: 'slack',
      name: 'Old Name',
      credentials: { botToken: 'test' }
    });

    const updated = await manager.updateIntegration(created.id, 1, {
      name: 'New Name'
    });

    assert.ok(updated);
    assert.strictEqual(updated.name, 'New Name');
  });

  it('should deactivate an integration', async () => {
    const created = await manager.registerIntegration(1, {
      provider: 'slack',
      credentials: { botToken: 'test' }
    });

    const updated = await manager.updateIntegration(created.id, 1, { active: false });
    assert.ok(updated);
    assert.strictEqual(updated.active, false);
  });

  it('should delete an integration', async () => {
    const created = await manager.registerIntegration(1, {
      provider: 'slack',
      credentials: { botToken: 'test' }
    });

    const deleted = await manager.deleteIntegration(created.id, 1);
    assert.ok(deleted);

    const fetched = await manager.getIntegration(created.id, 1);
    assert.strictEqual(fetched, null);
  });

  it('should not delete integrations belonging to other users', async () => {
    const created = await manager.registerIntegration(1, {
      provider: 'slack',
      credentials: { botToken: 'test' }
    });

    const deleted = await manager.deleteIntegration(created.id, 2);
    assert.ok(!deleted);
  });

  it('should return null when getting logs for non-existent integration', async () => {
    const logs = await manager.getLogs(999, 1);
    assert.strictEqual(logs, null);
  });

  it('should get action logs for an integration', async () => {
    const created = await manager.registerIntegration(1, {
      provider: 'slack',
      credentials: { botToken: 'test' }
    });

    // Add a log entry directly
    mockRows.logs.push({
      id: 1,
      integration_id: created.id,
      action: 'sendMessage',
      status: 'success',
      request: null,
      response: null,
      error: null,
      latency_ms: 150,
      created_at: new Date().toISOString()
    });

    const logs = await manager.getLogs(created.id, 1);
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].action, 'sendMessage');
  });
});
