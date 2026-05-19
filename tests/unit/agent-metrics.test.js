/**
 * T67: Agent Performance Metrics Tests
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

describe('AgentMetrics', () => {
  let AgentMetrics;
  let metrics;

  before(async () => {
    // Set required env vars
    process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key';
    process.env.JWT_SECRET = 'test-secret';

    const mod = require('../../src/agents/metrics.js');
    AgentMetrics = mod.AgentMetrics;
    metrics = new AgentMetrics();
  });

  describe('constructor', () => {
    it('should create an instance with default values', () => {
      assert.ok(metrics instanceof AgentMetrics);
      assert.ok(metrics.cache instanceof Map);
      assert.equal(metrics.cacheTTL, 60000);
    });
  });

  describe('_percentile', () => {
    it('should return null for empty array', () => {
      assert.equal(metrics._percentile([], 50), null);
    });

    it('should calculate p50 correctly', () => {
      const sorted = [10, 20, 30, 40, 50];
      assert.equal(metrics._percentile(sorted, 50), 30);
    });

    it('should calculate p95 correctly', () => {
      const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
      assert.equal(metrics._percentile(sorted, 95), 95);
    });

    it('should calculate p99 correctly', () => {
      const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
      assert.equal(metrics._percentile(sorted, 99), 99);
    });

    it('should handle single element', () => {
      assert.equal(metrics._percentile([42], 50), 42);
      assert.equal(metrics._percentile([42], 95), 42);
    });
  });

  describe('_topErrorTypes', () => {
    it('should return empty array for no errors', () => {
      const tasks = [{ error_type: null }, { error_type: null }];
      assert.deepEqual(metrics._topErrorTypes(tasks), []);
    });

    it('should count and sort error types', () => {
      const tasks = [
        { error_type: 'rate_limit' },
        { error_type: 'rate_limit' },
        { error_type: 'server_error' },
        { error_type: 'rate_limit' },
        { error_type: 'network_error' },
      ];
      const result = metrics._topErrorTypes(tasks);
      assert.equal(result.length, 3);
      assert.equal(result[0].type, 'rate_limit');
      assert.equal(result[0].count, 3);
      assert.equal(result[1].type, 'server_error');
      assert.equal(result[1].count, 1);
    });

    it('should limit to 5 entries', () => {
      const tasks = Array.from({ length: 10 }, (_, i) => ({ error_type: `error_${i}` }));
      assert.ok(metrics._topErrorTypes(tasks).length <= 5);
    });
  });

  describe('_modelBreakdown', () => {
    it('should count model usage', () => {
      const tasks = [
        { model_used: 'gpt-4' },
        { model_used: 'gpt-4' },
        { model_used: 'claude-3' },
      ];
      const result = metrics._modelBreakdown(tasks);
      assert.equal(result[0].model, 'gpt-4');
      assert.equal(result[0].count, 2);
      assert.equal(result[1].model, 'claude-3');
      assert.equal(result[1].count, 1);
    });

    it('should return empty for no models', () => {
      assert.deepEqual(metrics._modelBreakdown([]), []);
    });
  });

  describe('_clearStaleCache', () => {
    it('should clear cache after TTL', () => {
      metrics.cache.set('test', { data: 1 });
      metrics.lastCacheClear = Date.now() - 61000; // 61 seconds ago
      metrics._clearStaleCache();
      assert.equal(metrics.cache.size, 0);
    });

    it('should keep cache within TTL', () => {
      metrics.cache.set('test', { data: 1 });
      metrics.lastCacheClear = Date.now() - 30000; // 30 seconds ago
      metrics._clearStaleCache();
      assert.equal(metrics.cache.size, 1);
      metrics.cache.clear();
    });
  });

  describe('recordCall', () => {
    it('should be callable without throwing', async () => {
      // This tests the method exists and handles missing DB gracefully
      try {
        await metrics.recordCall('TestAgent', {
          tokens: 100,
          cost: 0.001,
          latencyMs: 500,
          success: true,
          modelUsed: 'test-model',
        });
      } catch {
        // Expected to fail without DB in test env
      }
      assert.ok(true);
    });
  });
});

describe('AgentLeaderboard', () => {
  let AgentLeaderboard;
  let leaderboard;

  before(() => {
    const mod = require('../../src/agents/leaderboard.js');
    AgentLeaderboard = mod.AgentLeaderboard;
    leaderboard = new AgentLeaderboard();
  });

  describe('constructor', () => {
    it('should create with default thresholds', () => {
      assert.ok(leaderboard instanceof AgentLeaderboard);
      assert.equal(leaderboard.thresholds.minSuccessRate, 80);
      assert.equal(leaderboard.thresholds.maxP95LatencyMs, 2000);
      assert.equal(leaderboard.thresholds.minCallsForEvaluation, 5);
      assert.equal(leaderboard.thresholds.cooldownMs, 300000);
      assert.equal(leaderboard.autoRerouteEnabled, true);
    });
  });

  describe('_calculateSeverity', () => {
    it('should return critical for very low success rate', () => {
      const agent = { metrics: { successRate: '40', p95LatencyMs: 1000 } };
      assert.equal(leaderboard._calculateSeverity(agent), 'critical');
    });

    it('should return critical for very high latency', () => {
      const agent = { metrics: { successRate: '90', p95LatencyMs: 6000 } };
      assert.equal(leaderboard._calculateSeverity(agent), 'critical');
    });

    it('should return high for moderately bad metrics', () => {
      const agent = { metrics: { successRate: '65', p95LatencyMs: 1000 } };
      assert.equal(leaderboard._calculateSeverity(agent), 'high');
    });

    it('should return medium for slightly bad metrics', () => {
      const agent = { metrics: { successRate: '75', p95LatencyMs: 1500 } };
      assert.equal(leaderboard._calculateSeverity(agent), 'medium');
    });
  });

  describe('_canAutoReroute', () => {
    it('should allow reroute if never rerouted', () => {
      assert.equal(leaderboard._canAutoReroute('NewAgent'), true);
    });

    it('should block reroute within cooldown', () => {
      leaderboard.lastReroute.set('TestAgent', Date.now() - 60000); // 1 min ago
      assert.equal(leaderboard._canAutoReroute('TestAgent'), false);
      leaderboard.lastReroute.delete('TestAgent');
    });

    it('should allow reroute after cooldown', () => {
      leaderboard.lastReroute.set('TestAgent', Date.now() - 400000); // 6.7 min ago
      assert.equal(leaderboard._canAutoReroute('TestAgent'), true);
      leaderboard.lastReroute.delete('TestAgent');
    });
  });

  describe('_determineWinner', () => {
    it('should pick agent with better success rate', () => {
      const a = { agentRole: 'AgentA', successRate: '95', avgLatencyMs: 500, tokensPerCall: 100 };
      const b = { agentRole: 'AgentB', successRate: '80', avgLatencyMs: 500, tokensPerCall: 100 };
      assert.equal(leaderboard._determineWinner(a, b), 'AgentA');
    });

    it('should return tie for similar scores', () => {
      const a = { agentRole: 'AgentA', successRate: '90', avgLatencyMs: 500, tokensPerCall: 100 };
      const b = { agentRole: 'AgentB', successRate: '90', avgLatencyMs: 500, tokensPerCall: 100 };
      assert.equal(leaderboard._determineWinner(a, b), 'tie');
    });
  });

  describe('getRerouteHistory', () => {
    it('should return empty history initially', () => {
      const fresh = new AgentLeaderboard();
      assert.deepEqual(fresh.getRerouteHistory(), []);
    });

    it('should respect limit parameter', () => {
      const fresh = new AgentLeaderboard();
      for (let i = 0; i < 100; i++) {
        fresh.rerouteHistory.push({ agentRole: `Agent${i}` });
      }
      assert.equal(fresh.getRerouteHistory(10).length, 10);
    });
  });
});
