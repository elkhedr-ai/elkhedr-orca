const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

process.env.ORCA_LOG_LEVEL = process.env.ORCA_LOG_LEVEL || 'error';

const { getDatabaseInstance, initializeDatabaseInstance } = require('../../src/db');
const { VectorStore, getVectorStore } = require('../../src/rag/vector.js');
const { buildRagPrompt, queryWithRag, extractCitations, indexKnowledgeEntry } = require('../../src/rag/prompts.js');
const { prepareRagMessages, finalizeRagResponse } = require('../../src/core.js');
const {
  HEALTH_STATUS,
  ModelRegistry,
  getModelRegistry
} = require('../../src/models/registry.js');
const { ModelHealthMonitor } = require('../../src/models/health.js');
const { LocalModelClient } = require('../../src/models/local.js');
const { QuotaManager, getQuotaManager } = require('../../src/billing/quotas.js');
const { MetricsCollector, getMetricsCollector } = require('../../src/server/metrics.js');
const { AlertManager } = require('../../src/alerts/rules.js');

async function resetInMemoryDatabase() {
  process.env.ORCA_DB_TYPE = 'sqlite';
  delete process.env.ORCA_DB_PATH;
  process.env.ORCA_DB_URL = ':memory:';
  const db = getDatabaseInstance();
  if (db.initialized) {
    await db.close();
  }
  getVectorStore().initialized = false;
  return initializeDatabaseInstance();
}

describe('T41: Vector Database', () => {
  let store;

  beforeEach(async () => {
    await resetInMemoryDatabase();
    store = new VectorStore();
    await store.initialize();
  });

  it('should chunk text', () => {
    const text = 'word '.repeat(1000);
    const chunks = store.chunkText(text, 100, 10);
    assert.ok(chunks.length > 0);
    assert.ok(chunks.length < 15);
  });

  it('should handle empty text chunks', () => {
    assert.deepStrictEqual(store.chunkText(''), []);
    assert.deepStrictEqual(store.chunkText('   '), []);
  });

  it('should embed text', async () => {
    const embedding = await store.embed('hello world this is a test');
    assert.ok(Array.isArray(embedding));
    assert.strictEqual(embedding.length, store.dimensions);
  });

  it('should store and retrieve documents', async () => {
    const docId = 'test-doc-1';
    await store.storeDocument(docId, 'The quick brown fox jumps over the lazy dog', { title: 'Test' });

    const results = await store.search('fox');
    assert.ok(results.length > 0);
    assert.ok(results[0].text.includes('fox'));
  });

  it('should rank semantically matching chunks above unrelated chunks', async () => {
    await store.storeDocument('animals', 'fox burrow forest den wildlife', { title: 'Animals' });
    await store.storeDocument('databases', 'postgresql query planner index statistics vacuum', { title: 'Databases' });

    const results = await store.search('postgresql index planner', { threshold: 0, limit: 2 });
    assert.strictEqual(results[0].documentId, 'databases');
  });

  it('should perform hybrid full-text search across query terms', async () => {
    await store.storeDocument('node-guide', 'Node.js runtime package manager event loop', { title: 'Node Guide' });

    const results = await store.hybridSearch('runtime missingterm', { threshold: 0.9, limit: 3 });
    assert.ok(results.some(result => result.documentId === 'node-guide'));
  });

  it('should report vector stats', async () => {
    await store.storeDocument('stats-doc', 'one two three', { title: 'Stats' });
    const stats = await store.getStats();
    assert.ok(stats.totalChunks >= 1);
    assert.ok(stats.totalDocuments >= 1);
    assert.strictEqual(stats.dimensions, store.dimensions);
  });

  it('should calculate cosine similarity', () => {
    const a = [1, 0, 0];
    const b = [1, 0, 0];
    const c = [0, 1, 0];

    assert.ok(Math.abs(store.cosineSimilarity(a, b) - 1.0) < 0.01);
    assert.ok(Math.abs(store.cosineSimilarity(a, c)) < 0.01);
  });

  it('should include public vectors when filtering by user', async () => {
    await store.storeDocument('public-doc', 'shared deployment checklist', {
      sourceType: 'knowledge_entry',
      userId: null
    });
    await store.storeDocument('private-doc', 'private billing notes', {
      sourceType: 'knowledge_entry',
      userId: 2
    });

    const results = await store.hybridSearch('deployment checklist', {
      userId: 1,
      sourceType: 'knowledge_entry',
      threshold: 0
    });

    assert.ok(results.some(result => result.documentId === 'public-doc'));
    assert.ok(!results.some(result => result.documentId === 'private-doc'));
  });
});

describe('T42: RAG Prompts', () => {
  it('should extract citations', () => {
    const response = 'The answer is 42 [Source: 1]. Also see [Source: 2] for more info.';
    const result = extractCitations(response);
    assert.ok(result.text.includes('The answer'));
    assert.deepStrictEqual(result.citations, [1, 2]);
  });

  it('should build RAG prompt with sources', async () => {
    await resetInMemoryDatabase();
    const store = getVectorStore();
    await store.initialize();
    await store.storeDocument('doc1', 'Node.js is a JavaScript runtime built on Chrome\'s V8 engine.', { title: 'Node.js Guide' });

    const result = await buildRagPrompt('What is Node.js?', { limit: 3 });
    assert.ok(result.prompt.includes('Node.js'));
    assert.ok(result.sources.length > 0);
    assert.ok(result.confidence > 0);
  });

  it('should index knowledge entries into vector search', async () => {
    await resetInMemoryDatabase();

    const indexed = await indexKnowledgeEntry(
      'PostgreSQL Guide',
      'PostgreSQL uses indexes and query planning for efficient retrieval.',
      { agentId: 'test-agent' }
    );

    assert.ok(indexed.entryId);
    const store = getVectorStore();
    const results = await store.hybridSearch('query planning indexes', {
      agentId: 'test-agent',
      sourceType: 'knowledge_entry',
      threshold: 0
    });

    assert.ok(results.some(result => result.metadata.knowledgeEntryId === indexed.entryId));
  });

  it('should prepare core messages with RAG context', async () => {
    await resetInMemoryDatabase();
    await indexKnowledgeEntry(
      'Query Planning',
      'PostgreSQL query planner uses statistics and indexes to optimize retrieval.',
      { agentId: 'rag-system' }
    );

    const events = [];
    const result = await prepareRagMessages(
      'How does PostgreSQL query planner use indexes?',
      [],
      {
        sessionStats: {
          ragEnabled: true,
          ragThreshold: 0,
          ragMinConfidence: 0
        },
        onEvent: event => events.push(event)
      }
    );

    assert.strictEqual(result.rag.usedRag, true);
    assert.ok(result.messages[0].content.includes('Context:'));
    assert.ok(result.messages[0].content.includes('[Source: 1]'));
    assert.ok(events.some(event => event.type === 'rag' && event.usedRag));
  });

  it('should leave core messages unchanged when RAG is disabled', async () => {
    const result = await prepareRagMessages('Plain prompt', [], {
      sessionStats: { ragEnabled: false }
    });

    assert.strictEqual(result.rag.usedRag, false);
    assert.deepStrictEqual(result.messages, [{ role: 'user', content: 'Plain prompt' }]);
  });

  it('should append cited source details to RAG responses', () => {
    const response = finalizeRagResponse('Use indexes [Source: 1].', {
      usedRag: true,
      confidence: 0.73,
      sources: [
        {
          index: 1,
          documentId: 'knowledge-1',
          similarity: 0.42,
          metadata: { title: 'Query Planning' }
        },
        {
          index: 2,
          documentId: 'knowledge-2',
          similarity: 0.2,
          metadata: { title: 'Uncited' }
        }
      ]
    });

    assert.ok(response.includes('Sources:'));
    assert.ok(response.includes('[Source: 1] Query Planning'));
    assert.ok(response.includes('Retrieval confidence: 73%'));
    assert.ok(!response.includes('Uncited'));
  });
});

describe('T43: Model Registry', () => {
  it('should register default models', () => {
    const registry = getModelRegistry();
    const models = registry.getAllModels();
    assert.ok(models.length >= 3);
  });

  it('should get model by ID', () => {
    const registry = getModelRegistry();
    const model = registry.getModel('openrouter-gpt-4');
    assert.ok(model);
    assert.ok(model.name);
  });

  it('should route to default model', () => {
    const registry = getModelRegistry();
    const model = registry.routeModel();
    assert.ok(model);
  });

  it('should track model stats', () => {
    const registry = getModelRegistry();
    const stats = registry.getStats();
    assert.ok(stats.total > 0);
  });

  it('should load agent model assignments into the registry', () => {
    const registry = new ModelRegistry();
    const model = registry.getModel('qwen/qwen3-coder');

    assert.ok(model);
    assert.ok(model.agentRoles.length > 0);
    assert.strictEqual(model.provider, 'openrouter');
  });

  it('should route around unhealthy preferred models to explicit fallbacks', () => {
    const registry = new ModelRegistry({
      models: [
        {
          id: 'primary',
          model: 'provider/primary',
          health: { status: HEALTH_STATUS.UNHEALTHY },
          costPer1kTokens: 0.002,
          qualityScore: 8
        },
        {
          id: 'fallback',
          model: 'provider/fallback',
          health: { status: HEALTH_STATUS.HEALTHY },
          costPer1kTokens: 0.001,
          qualityScore: 7
        }
      ]
    });

    const routed = registry.routeModel({
      preferredModel: 'provider/primary',
      fallbackModel: 'provider/fallback'
    });
    const chain = registry.buildFallbackChain({
      preferredModel: 'provider/primary',
      fallbackModel: 'provider/fallback'
    });

    assert.strictEqual(routed.model, 'provider/fallback');
    assert.strictEqual(chain[0].model, 'provider/fallback');
    assert.ok(!chain.some(model => model.model === 'provider/primary'));
  });

  it('should score routes by cost, quality, and latency strategies', () => {
    const registry = new ModelRegistry({
      models: [
        {
          id: 'cheap',
          model: 'provider/cheap',
          health: { status: HEALTH_STATUS.HEALTHY, latency: 10000 },
          costPer1kTokens: 0.0001,
          qualityScore: 6
        },
        {
          id: 'premium',
          model: 'provider/premium',
          health: { status: HEALTH_STATUS.HEALTHY, latency: 20000 },
          costPer1kTokens: 0.02,
          qualityScore: 9.8
        },
        {
          id: 'fast',
          model: 'provider/fast',
          health: { status: HEALTH_STATUS.HEALTHY, latency: 100 },
          costPer1kTokens: 0.015,
          qualityScore: 6.2
        }
      ]
    });

    assert.strictEqual(registry.routeModel({ respectPreferred: false, strategy: 'cost' }).model, 'provider/cheap');
    assert.strictEqual(registry.routeModel({ respectPreferred: false, strategy: 'quality' }).model, 'provider/premium');
    assert.strictEqual(registry.routeModel({ respectPreferred: false, strategy: 'latency' }).model, 'provider/fast');
  });

  it('should run health checks through a 60 second monitor interval', async () => {
    const registry = new ModelRegistry({
      models: [
        { id: 'healthy', model: 'provider/healthy' },
        { id: 'down', model: 'provider/down' }
      ],
      healthChecker: async model => ({
        status: model.id === 'healthy' ? HEALTH_STATUS.HEALTHY : HEALTH_STATUS.UNHEALTHY,
        latency: 12
      })
    });

    const result = await registry.runHealthChecks();

    assert.strictEqual(registry.healthCheckInterval, 60000);
    assert.strictEqual(result.total, 2);
    assert.strictEqual(result.healthy, 1);
    assert.strictEqual(registry.getModel('provider/down').health.status, HEALTH_STATUS.UNHEALTHY);
  });

  it('should expose cost optimization suggestions', () => {
    const registry = new ModelRegistry({
      models: [
        {
          id: 'expensive',
          model: 'provider/expensive',
          health: { status: HEALTH_STATUS.HEALTHY },
          costPer1kTokens: 0.02,
          qualityScore: 8
        },
        {
          id: 'efficient',
          model: 'provider/efficient',
          health: { status: HEALTH_STATUS.HEALTHY },
          costPer1kTokens: 0.001,
          qualityScore: 7.8
        }
      ]
    });

    const suggestions = registry.getCostOptimizationSuggestions();
    assert.strictEqual(suggestions[0].model, 'provider/expensive');
    assert.strictEqual(suggestions[0].suggestedModel, 'provider/efficient');
    assert.ok(suggestions[0].estimatedSavingsPercent > 90);
  });

  it('should stop health monitor timers', () => {
    const monitor = new ModelHealthMonitor({
      checker: async () => ({ status: HEALTH_STATUS.HEALTHY })
    });

    monitor.start(() => [], null, { runImmediately: false });
    assert.ok(monitor._timer);
    monitor.stop();
    assert.strictEqual(monitor._timer, null);
  });
});

describe('T44: Local Model Client', () => {
  it('should list models (mock)', async () => {
    const client = new LocalModelClient();
    const models = await client.listModels();
    assert.ok(Array.isArray(models));
  });

  it('should benchmark endpoint', async () => {
    const client = new LocalModelClient();
    const results = await client.benchmark();
    assert.ok(results.local !== undefined);
    assert.ok(results.cloud !== undefined);
  });
});

describe('T46: Quota Manager', () => {
  let manager;
  let db;
  let testUserId = 1;

  beforeEach(async () => {
    db = await resetInMemoryDatabase();
    // Create a test user directly in the db we know
    for (const userId of [testUserId, 99, 100]) {
      await db.getAdapter().execute(
        'INSERT INTO users (id, username, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
        [userId, `testuser${userId}`, `test${userId}@example.com`, 'password123', 'user']
      );
    }
    manager = new QuotaManager();
    await manager.initialize();
  });

  afterEach(async () => {
    if (db) {
      await db.close();
    }
  });

  it('should create default quota for user', async () => {
    const quota = await manager.getUserQuota(1);
    assert.ok(quota);
    assert.ok(quota.limits.tokens > 0);
  });

  it('should track usage', async () => {
    await manager.getUserQuota(1); // Create quota
    const quota = await manager.trackUsage(1, { tokens: 100, cost: 0.05 });
    assert.ok(quota.used.tokens >= 100);
  });

  it('should enforce quota limits', async () => {
    const userId = 99;
    await manager.getUserQuota(userId);
    // Use up all tokens
    await manager.trackUsage(userId, { tokens: 2000, cost: 100 });

    const check = await manager.checkQuota(userId, { requireTokens: 1 });
    assert.strictEqual(check.allowed, false);
    assert.ok(check.limitReached);
  });

  it('should warn at 80% usage', async () => {
    const userId = 100;
    await manager.getUserQuota(userId);
    // Use 85% of quota
    await manager.trackUsage(userId, { tokens: 900, cost: 8.5 });

    const warning = await manager.getWarning(userId);
    assert.strictEqual(warning.warning, true);
    assert.ok(warning.message);
  });
});

describe('T55: Metrics Collector', () => {
  let metrics;

  beforeEach(() => {
    metrics = new MetricsCollector();
  });

  it('should record HTTP requests', () => {
    metrics.recordHttpRequest('/api/agents', 'GET', 200, 150);
    metrics.recordHttpRequest('/api/agents', 'GET', 500, 200);

    const output = metrics.format();
    assert.ok(output.includes('orca_http_requests_total'));
    assert.ok(output.includes('orca_http_errors_total'));
  });

  it('should record agent calls', () => {
    metrics.recordAgentCall('developer', 1000, 0.02, true);
    metrics.recordAgentCall('developer', 500, 0.01, false);

    const output = metrics.format();
    assert.ok(output.includes('orca_agent_calls_total'));
  });

  it('should include uptime', () => {
    const output = metrics.format();
    assert.ok(output.includes('orca_uptime_seconds'));
  });

  it('should expose Prometheus format', () => {
    metrics.recordHttpRequest('/health', 'GET', 200, 50);
    const output = metrics.format();
    assert.ok(output.includes('# HELP'));
    assert.ok(output.includes('# TYPE'));
  });
});

describe('T56: Alert Manager', () => {
  let alerts;

  beforeEach(() => {
    alerts = new AlertManager();
    alerts.setupDefaultRules();
  });

  it('should setup default rules', () => {
    const rules = alerts.rules;
    assert.ok(rules.size >= 5);
    assert.ok(rules.has('high-error-rate'));
    assert.ok(rules.has('cost-spike'));
    assert.ok(rules.has('queue-backlog'));
  });

  it('should evaluate rules', () => {
    const metrics = getMetricsCollector();
    metrics.recordHttpRequest('/test', 'GET', 500, 100);
    metrics.recordHttpRequest('/test', 'GET', 500, 100);

    alerts.evaluate();

    const history = alerts.getHistory();
    assert.ok(history.length >= 0);
  });

  it('should track alert history', () => {
    alerts.addRule({
      id: 'test-rule',
      name: 'Test Rule',
      metric: 'queue_depth',
      condition: '>',
      threshold: 10,
      severity: 'warning'
    });

    alerts.evaluate();
    const history = alerts.getHistory();
    assert.ok(Array.isArray(history));
  });

  it('should get active alerts', () => {
    const active = alerts.getActiveAlerts();
    assert.ok(Array.isArray(active));
  });
});
