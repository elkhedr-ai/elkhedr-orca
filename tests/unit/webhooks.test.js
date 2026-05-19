/**
 * Tests for T47: Webhook System
 * Tests HMAC signing, delivery logic, and WebhookManager.
 */

const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

// Mock database adapter
const mockRows = { webhooks: [], deliveries: [] };

const mockDb = {
  getAdapter: () => ({
    execute: async (sql, params) => {
      // CREATE TABLE
      if (sql.includes('CREATE TABLE')) return [];
      if (sql.includes('CREATE INDEX')) return [];

      // INSERT INTO webhooks
      if (sql.includes('INSERT INTO webhooks')) {
        const webhook = {
          id: mockRows.webhooks.length + 1,
          user_id: params?.[0],
          url: params?.[1],
          secret: params?.[2],
          events: params?.[3],
          active: 1,
          description: params?.[4] || null,
          headers: params?.[5] || null,
          max_retries: params?.[6] || 3,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        mockRows.webhooks.push(webhook);
        return { lastInsertRowid: webhook.id, insertId: webhook.id };
      }

      // INSERT INTO webhook_deliveries
      if (sql.includes('INSERT INTO webhook_deliveries')) {
        const delivery = {
          id: mockRows.deliveries.length + 1,
          webhook_id: params?.[0],
          event_type: params?.[1],
          payload: params?.[2],
          status: params?.[3] || 'pending',
          status_code: null,
          error: null,
          attempt: params?.[5] || 0,
          latency_ms: null,
          delivery_id: params?.[4],
          created_at: new Date().toISOString(),
          completed_at: null
        };
        mockRows.deliveries.push(delivery);
        return { lastInsertRowid: delivery.id };
      }

      // SELECT * FROM webhooks WHERE user_id
      if (sql.includes('SELECT * FROM webhooks WHERE user_id = ?') && !sql.includes('active')) {
        return mockRows.webhooks.filter(w => w.user_id === params?.[0]);
      }

      // SELECT active webhooks
      if (sql.includes('active = 1')) {
        return mockRows.webhooks.filter(w => w.active === 1);
      }

      // SELECT single webhook
      if (sql.includes('SELECT * FROM webhooks WHERE id = ? AND user_id = ?')) {
        const row = mockRows.webhooks.find(w => w.id === params?.[0] && w.user_id === params?.[1]);
        return row ? [row] : [];
      }

      // SELECT deliveries
      if (sql.includes('SELECT * FROM webhook_deliveries WHERE webhook_id')) {
        return mockRows.deliveries.filter(d => d.webhook_id === params?.[0]);
      }

      // UPDATE webhooks
      if (sql.includes('UPDATE webhooks SET')) {
        const webhookId = params?.[params.length - 2];
        const webhook = mockRows.webhooks.find(w => w.id === webhookId);
        if (webhook) {
          if (sql.includes('url = ?')) webhook.url = params?.[0];
          if (sql.includes('events = ?')) webhook.events = params?.[0];
          if (sql.includes('active = ?')) webhook.active = params?.[0];
        }
        return { changes: webhook ? 1 : 0 };
      }

      // UPDATE webhook_deliveries
      if (sql.includes('UPDATE webhook_deliveries SET')) {
        const deliveryId = params?.[params.length - 1];
        const delivery = mockRows.deliveries.find(d => d.delivery_id === deliveryId);
        if (delivery) {
          delivery.status = params?.[0];
          delivery.status_code = params?.[1];
          delivery.error = params?.[2];
          delivery.attempt = params?.[3];
          delivery.latency_ms = params?.[4];
          delivery.completed_at = new Date().toISOString();
        }
        return { changes: 1 };
      }

      // DELETE
      if (sql.includes('DELETE FROM webhooks')) {
        const idx = mockRows.webhooks.findIndex(w => w.id === params?.[0] && w.user_id === params?.[1]);
        if (idx !== -1) {
          mockRows.webhooks.splice(idx, 1);
          return { changes: 1 };
        }
        return { changes: 0 };
      }

      // COUNT
      if (sql.includes('COUNT(*)')) {
        return [{ count: mockRows.webhooks.filter(w => w.user_id === params?.[0]).length }];
      }

      return [];
    }
  })
};

// Mock db module
require.cache[require.resolve('../../src/db')] = {
  loaded: true,
  exports: { getDatabaseInstance: async () => mockDb }
};

// Mock logger
require.cache[require.resolve('../../src/utils/logger.js')] = {
  loaded: true,
  exports: { logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }
};

// Mock event bus
require.cache[require.resolve('../../src/events/bus.js')] = {
  loaded: true,
  exports: { getEventBus: () => ({ on: () => {}, emit: () => {} }) }
};

const { signPayload, verifySignature, deliverWebhook } = require('../../src/webhooks/delivery.js');
const { WebhookManager } = require('../../src/webhooks/index.js');

describe('T47: Webhook HMAC Signing', () => {
  it('should generate consistent HMAC-SHA256 signatures', () => {
    const payload = '{"event":"test","data":{}}';
    const secret = 'whsec_test_secret_123';

    const sig1 = signPayload(payload, secret);
    const sig2 = signPayload(payload, secret);

    assert.strictEqual(sig1, sig2);
    assert.ok(sig1.startsWith('sha256='));
  });

  it('should generate different signatures for different payloads', () => {
    const secret = 'whsec_test_secret_123';
    const sig1 = signPayload('{"event":"a"}', secret);
    const sig2 = signPayload('{"event":"b"}', secret);

    assert.notStrictEqual(sig1, sig2);
  });

  it('should generate different signatures for different secrets', () => {
    const payload = '{"event":"test"}';
    const sig1 = signPayload(payload, 'secret1');
    const sig2 = signPayload(payload, 'secret2');

    assert.notStrictEqual(sig1, sig2);
  });

  it('should verify valid signatures', () => {
    const payload = '{"event":"test","data":{"id":1}}';
    const secret = 'whsec_verify_test';
    const signature = signPayload(payload, secret);

    assert.ok(verifySignature(payload, secret, signature));
  });

  it('should reject invalid signatures', () => {
    const payload = '{"event":"test"}';
    const secret = 'whsec_verify_test';

    assert.ok(!verifySignature(payload, secret, 'sha256=invalid'));
  });

  it('should reject tampered payloads', () => {
    const payload = '{"event":"test"}';
    const secret = 'whsec_verify_test';
    const signature = signPayload(payload, secret);

    assert.ok(!verifySignature('{"event":"tampered"}', secret, signature));
  });
});

describe('T47: WebhookManager', () => {
  let manager;

  beforeEach(() => {
    mockRows.webhooks = [];
    mockRows.deliveries = [];
    manager = new WebhookManager();
  });

  it('should create a webhook with auto-generated secret', async () => {
    const webhook = await manager.createWebhook(1, {
      url: 'https://example.com/hook',
      events: ['agent_complete', 'cost_update']
    });

    assert.ok(webhook.id);
    assert.strictEqual(webhook.url, 'https://example.com/hook');
    assert.ok(webhook.secret.startsWith('whsec_'));
    assert.deepStrictEqual(webhook.events, ['agent_complete', 'cost_update']);
    assert.strictEqual(webhook.active, true);
  });

  it('should create a webhook with custom secret', async () => {
    const webhook = await manager.createWebhook(1, {
      url: 'https://example.com/hook',
      events: ['*'],
      secret: 'my_custom_secret'
    });

    assert.strictEqual(webhook.secret, 'my_custom_secret');
  });

  it('should list webhooks for a user', async () => {
    await manager.createWebhook(1, { url: 'https://a.com/hook', events: ['*'] });
    await manager.createWebhook(1, { url: 'https://b.com/hook', events: ['agent_complete'] });
    await manager.createWebhook(2, { url: 'https://c.com/hook', events: ['*'] });

    const list = await manager.listWebhooks(1);
    assert.strictEqual(list.length, 2);
  });

  it('should get a specific webhook', async () => {
    const created = await manager.createWebhook(1, {
      url: 'https://example.com/hook',
      events: ['agent_complete']
    });

    const fetched = await manager.getWebhook(created.id, 1);
    assert.ok(fetched);
    assert.strictEqual(fetched.url, 'https://example.com/hook');
  });

  it('should return null for non-existent webhook', async () => {
    const fetched = await manager.getWebhook(999, 1);
    assert.strictEqual(fetched, null);
  });

  it('should not return webhooks belonging to other users', async () => {
    const created = await manager.createWebhook(1, {
      url: 'https://example.com/hook',
      events: ['*']
    });

    const fetched = await manager.getWebhook(created.id, 2);
    assert.strictEqual(fetched, null);
  });

  it('should update a webhook', async () => {
    const created = await manager.createWebhook(1, {
      url: 'https://example.com/hook',
      events: ['agent_complete']
    });

    const updated = await manager.updateWebhook(created.id, 1, {
      url: 'https://new-url.com/hook',
      events: ['agent_complete', 'cost_update']
    });

    assert.ok(updated);
    assert.strictEqual(updated.url, 'https://new-url.com/hook');
  });

  it('should deactivate a webhook', async () => {
    const created = await manager.createWebhook(1, {
      url: 'https://example.com/hook',
      events: ['*']
    });

    const updated = await manager.updateWebhook(created.id, 1, { active: false });
    assert.ok(updated);
    assert.strictEqual(updated.active, false);
  });

  it('should delete a webhook', async () => {
    const created = await manager.createWebhook(1, {
      url: 'https://example.com/hook',
      events: ['*']
    });

    const deleted = await manager.deleteWebhook(created.id, 1);
    assert.ok(deleted);

    const fetched = await manager.getWebhook(created.id, 1);
    assert.strictEqual(fetched, null);
  });

  it('should not delete webhooks belonging to other users', async () => {
    const created = await manager.createWebhook(1, {
      url: 'https://example.com/hook',
      events: ['*']
    });

    const deleted = await manager.deleteWebhook(created.id, 2);
    assert.ok(!deleted);
  });

  it('should get delivery history for a webhook', async () => {
    const created = await manager.createWebhook(1, {
      url: 'https://example.com/hook',
      events: ['*']
    });

    // Add a delivery record directly
    mockRows.deliveries.push({
      id: 1,
      webhook_id: created.id,
      event_type: 'agent_complete',
      payload: '{}',
      status: 'delivered',
      status_code: 200,
      error: null,
      attempt: 1,
      latency_ms: 150,
      delivery_id: 'del_123',
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString()
    });

    const deliveries = await manager.getDeliveries(created.id, 1);
    assert.strictEqual(deliveries.length, 1);
    assert.strictEqual(deliveries[0].status, 'delivered');
  });

  it('should return null deliveries for non-existent webhook', async () => {
    const deliveries = await manager.getDeliveries(999, 1);
    assert.strictEqual(deliveries, null);
  });
});
