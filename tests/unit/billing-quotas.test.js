/**
 * Tests for T46: Usage Quotas & Billing
 * Tests QuotaManager, per-model pricing, admin override.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

// Mock database adapter
const mockRows = [];

const mockDb = {
  getAdapter: () => ({
    execute: async (sql, params) => {
      if (sql.includes('INSERT INTO usage_logs')) {
        mockRows.push({ _type: 'usage_log', sql, params });
      }
      if (sql.includes('INSERT INTO quotas')) {
        // Extract values from INSERT to create a mock quota row
        mockRows.push({
          _type: 'quota',
          id: mockRows.filter(r => r._type === 'quota').length + 1,
          user_id: params?.[0],
          workspace_id: null,
          quota_type: 'user',
          tokens_limit: params?.[1] || 1000000,
          tokens_used: 0,
          operations_limit: params?.[2] || 1000,
          operations_used: 0,
          cost_limit: params?.[3] || 10.0,
          cost_used: 0,
          reset_period: params?.[4] || 'monthly',
          last_reset: new Date().toISOString()
        });
      }
      if (sql.includes('UPDATE quotas SET tokens_used')) {
        const userId = params?.[params.length - 1];
        const quotaRow = mockRows.find(r => r._type === 'quota' && r.user_id === userId);
        if (quotaRow) {
          quotaRow.tokens_used += params[0] || 0;
          quotaRow.operations_used += 1;
          quotaRow.cost_used += params[1] || 0;
        }
      }
      if (sql.includes('UPDATE quotas SET') && sql.includes('tokens_limit')) {
        const quotaId = params?.[params.length - 1];
        const quotaRow = mockRows.find(r => r._type === 'quota' && r.id === quotaId);
        if (quotaRow && params) {
          let idx = 0;
          if (sql.includes('tokens_limit')) quotaRow.tokens_limit = params[idx++];
          if (sql.includes('operations_limit')) quotaRow.operations_limit = params[idx++];
          if (sql.includes('cost_limit')) quotaRow.cost_limit = params[idx++];
        }
      }
      if (sql.includes('tokens_used = 0, operations_used = 0')) {
        const quotaId = params?.[0];
        const quotaRow = mockRows.find(r => r._type === 'quota' && r.id === quotaId);
        if (quotaRow) {
          quotaRow.tokens_used = 0;
          quotaRow.operations_used = 0;
          quotaRow.cost_used = 0;
        }
      }
      return { lastInsertRowid: mockRows.length };
    },
    query: async (sql, params) => {
      if (sql.includes('FROM quotas')) {
        return mockRows.filter(r => r._type === 'quota' && r.user_id === params?.[0]);
      }
      if (sql.includes('FROM usage_logs')) {
        return mockRows.filter(r => r._type === 'usage_log');
      }
      return [];
    }
  })
};

// Use absolute paths for mock injection
const dbPath = '/Users/ekf/Downloads/ELKHEDR_WORKSPACE/elkhedr-orca/src/db/index.js';
const loggerPath = '/Users/ekf/Downloads/ELKHEDR_WORKSPACE/elkhedr-orca/src/utils/logger.js';

require.cache[dbPath] = {
  id: dbPath,
  exports: { getDatabaseInstance: async () => mockDb, initializeDatabaseInstance: async () => mockDb },
  loaded: true,
  filename: dbPath
};

require.cache[loggerPath] = {
  id: loggerPath,
  exports: { logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} } },
  loaded: true,
  filename: loggerPath
};

const { QuotaManager, getQuotaManager, WARNING_THRESHOLD } = require('../../src/billing/quotas.js');
const { calculateCost, getModelRate, MODEL_PRICING, DEFAULT_RATE } = require('../../src/billing/pricing.js');

describe('T46: Per-Model Pricing', () => {
  it('should return known model rate', () => {
    assert.strictEqual(getModelRate('openai/gpt-4o-mini'), 0.15);
    assert.strictEqual(getModelRate('anthropic/claude-3.5-sonnet'), 3.00);
    assert.strictEqual(getModelRate('deepseek/deepseek-chat'), 0.14);
  });

  it('should return zero for local models', () => {
    assert.strictEqual(getModelRate('ollama/llama3'), 0);
    assert.strictEqual(getModelRate('lmstudio/my-model'), 0);
  });

  it('should return default rate for unknown models', () => {
    assert.strictEqual(getModelRate('unknown/model'), DEFAULT_RATE);
    assert.strictEqual(getModelRate(null), DEFAULT_RATE);
    assert.strictEqual(getModelRate(''), DEFAULT_RATE);
  });

  it('should calculate cost correctly', () => {
    // 1M tokens at $0.15/1M = $0.15
    assert.strictEqual(calculateCost(1000000, 'openai/gpt-4o-mini'), 0.15);
    // 500k tokens at $3.00/1M = $1.50
    assert.strictEqual(calculateCost(500000, 'anthropic/claude-3.5-sonnet'), 1.50);
    // Local model = $0
    assert.strictEqual(calculateCost(1000000, 'ollama/llama3'), 0);
  });

  it('should export MODEL_PRICING map', () => {
    assert.ok(typeof MODEL_PRICING === 'object');
    assert.ok(Object.keys(MODEL_PRICING).length > 10);
  });
});

describe('T46: QuotaManager', () => {
  let quotaManager;

  beforeEach(async () => {
    // Reset mock state
    mockRows.length = 0;
    quotaManager = new QuotaManager();
    quotaManager.initialized = false;
  });

  it('should initialize tables', async () => {
    await quotaManager.initialize();
    assert.strictEqual(quotaManager.initialized, true);
  });

  it('should get or create default quota for user', async () => {
    // First call creates default quota
    const quota = await quotaManager.getUserQuota(1);
    assert.strictEqual(quota.userId, 1);
    assert.strictEqual(quota.type, 'user');
    assert.ok(quota.limits.tokens > 0);
    assert.ok(quota.limits.operations > 0);
    assert.ok(quota.limits.cost > 0);
    assert.strictEqual(quota.used.tokens, 0);
    assert.strictEqual(quota.status, 'ok');
  });

  it('should track usage and increment counters', async () => {
    // Set up a quota row directly
    mockRows.push({
      _type: 'quota',
      id: 1,
      user_id: 1,
      workspace_id: null,
      quota_type: 'user',
      tokens_limit: 1000000,
      tokens_used: 0,
      operations_limit: 1000,
      operations_used: 0,
      cost_limit: 10.0,
      cost_used: 0,
      reset_period: 'monthly',
      last_reset: new Date().toISOString()
    });

    await quotaManager.trackUsage(1, { tokens: 5000, cost: 0.01, model: 'openai/gpt-4o-mini' });

    // Verify usage_log was inserted
    const usageLogs = mockRows.filter(r => r._type === 'usage_log');
    assert.ok(usageLogs.length > 0);
  });

  it('should allow operation when within quota', async () => {
    mockRows.push({
      _type: 'quota',
      id: 2,
      user_id: 2,
      workspace_id: null,
      quota_type: 'user',
      tokens_limit: 1000000,
      tokens_used: 100,
      operations_limit: 1000,
      operations_used: 1,
      cost_limit: 10.0,
      cost_used: 0.01,
      reset_period: 'monthly',
      last_reset: new Date().toISOString()
    });

    const result = await quotaManager.checkQuota(2, { requireTokens: 100 });
    assert.strictEqual(result.allowed, true);
  });

  it('should block operation when quota exceeded', async () => {
    mockRows.push({
      _type: 'quota',
      id: 3,
      user_id: 3,
      workspace_id: null,
      quota_type: 'user',
      tokens_limit: 100,
      tokens_used: 100, // at limit
      operations_limit: 10,
      operations_used: 10, // at limit
      cost_limit: 1.0,
      cost_used: 1.0, // at limit
      reset_period: 'monthly',
      last_reset: new Date().toISOString()
    });

    const result = await quotaManager.checkQuota(3);
    assert.strictEqual(result.allowed, false);
    assert.ok(result.reason.includes('Quota exceeded'));
  });

  it('should return warning at 80% threshold', async () => {
    mockRows.push({
      _type: 'quota',
      id: 4,
      user_id: 4,
      workspace_id: null,
      quota_type: 'user',
      tokens_limit: 1000,
      tokens_used: 850, // 85%
      operations_limit: 100,
      operations_used: 50,
      cost_limit: 10.0,
      cost_used: 5.0,
      reset_period: 'monthly',
      last_reset: new Date().toISOString()
    });

    const warning = await quotaManager.getWarning(4);
    assert.strictEqual(warning.warning, true);
    assert.ok(warning.message.includes('85%'));
  });

  it('should reset quota usage', async () => {
    mockRows.push({
      _type: 'quota',
      id: 5,
      user_id: 5,
      workspace_id: null,
      quota_type: 'user',
      tokens_limit: 1000,
      tokens_used: 500,
      operations_limit: 100,
      operations_used: 50,
      cost_limit: 10.0,
      cost_used: 5.0,
      reset_period: 'monthly',
      last_reset: new Date().toISOString()
    });

    await quotaManager.resetQuota(5);
    const quotaRow = mockRows.find(r => r._type === 'quota' && r.id === 5);
    assert.strictEqual(quotaRow.tokens_used, 0);
    assert.strictEqual(quotaRow.operations_used, 0);
    assert.strictEqual(quotaRow.cost_used, 0);
  });

  it('should allow admin override', async () => {
    mockRows.push({
      _type: 'quota',
      id: 6,
      user_id: 6,
      workspace_id: null,
      quota_type: 'user',
      tokens_limit: 100,
      tokens_used: 100, // exceeded
      operations_limit: 10,
      operations_used: 10,
      cost_limit: 1.0,
      cost_used: 1.0,
      reset_period: 'monthly',
      last_reset: new Date().toISOString()
    });

    // Without admin override — blocked
    const blocked = await quotaManager.checkQuota(6);
    assert.strictEqual(blocked.allowed, false);

    // With admin override — allowed
    const allowed = await quotaManager.checkQuota(6, { adminOverride: true });
    assert.strictEqual(allowed.allowed, true);
  });

  it('should update quota limits', async () => {
    mockRows.push({
      _type: 'quota',
      id: 7,
      user_id: 7,
      workspace_id: null,
      quota_type: 'user',
      tokens_limit: 1000,
      tokens_used: 0,
      operations_limit: 100,
      operations_used: 0,
      cost_limit: 10.0,
      cost_used: 0,
      reset_period: 'monthly',
      last_reset: new Date().toISOString()
    });

    const result = await quotaManager.updateQuota(7, { tokensLimit: 5000 });
    assert.strictEqual(result.updated, true);
  });

  it('should format quota with percentages', async () => {
    mockRows.push({
      _type: 'quota',
      id: 8,
      user_id: 8,
      workspace_id: null,
      quota_type: 'user',
      tokens_limit: 1000,
      tokens_used: 500,
      operations_limit: 100,
      operations_used: 25,
      cost_limit: 10.0,
      cost_used: 3.0,
      reset_period: 'monthly',
      last_reset: new Date().toISOString()
    });

    const quota = await quotaManager.getUserQuota(8);
    assert.strictEqual(quota.percentages.tokens, 0.5);
    assert.strictEqual(quota.percentages.operations, 0.25);
    assert.strictEqual(quota.percentages.cost, 0.3);
    assert.strictEqual(quota.highestPercent, 0.5);
    assert.strictEqual(quota.status, 'ok');
    assert.strictEqual(quota.remaining.tokens, 500);
  });
});
