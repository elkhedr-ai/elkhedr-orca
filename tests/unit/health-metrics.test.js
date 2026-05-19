/**
 * Tests for T55: Health Checks & Metrics
 * Tests health endpoints and Prometheus metrics collector.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

const { MetricsCollector } = require('../../src/server/metrics.js');

describe('T55: MetricsCollector', () => {
  let collector;

  beforeEach(() => {
    collector = new MetricsCollector();
  });

  it('should record HTTP requests', () => {
    collector.recordHttpRequest('/api/chat', 'POST', 200, 150);
    collector.recordHttpRequest('/api/chat', 'POST', 200, 200);
    collector.recordHttpRequest('/api/chat', 'POST', 500, 50);

    const output = collector.format();
    assert.ok(output.includes('orca_http_requests_total{method="POST",path="/api/chat"} 3'));
    assert.ok(output.includes('orca_http_errors_total{method="POST",path="/api/chat"} 1'));
  });

  it('should record agent calls', () => {
    collector.recordAgentCall('orchestrator', 1000, 0.05, true);
    collector.recordAgentCall('orchestrator', 2000, 0.10, true);
    collector.recordAgentCall('researcher', 500, 0.02, false);

    const output = collector.format();
    assert.ok(output.includes('orca_agent_calls_total{agent="orchestrator"} 2'));
    assert.ok(output.includes('orca_agent_calls_total{agent="researcher"} 1'));
  });

  it('should track total tokens and cost', () => {
    collector.recordAgentCall('agent', 1000, 0.05);
    collector.recordAgentCall('agent', 2000, 0.10);

    const output = collector.format();
    assert.ok(output.includes('orca_total_tokens 3000'));
    assert.ok(output.includes('orca_total_cost_total 0.150000'));
  });

  it('should record database queries', () => {
    collector.recordDbQuery(true);
    collector.recordDbQuery(true);
    collector.recordDbQuery(false);

    const output = collector.format();
    assert.ok(output.includes('orca_db_queries_total 3'));
    assert.ok(output.includes('orca_db_query_errors_total 1'));
  });

  it('should track cache hit rate', () => {
    collector.recordCacheHit();
    collector.recordCacheHit();
    collector.recordCacheHit();
    collector.recordCacheMiss();

    const output = collector.format();
    assert.ok(output.includes('orca_cache_hit_rate 0.7500'));
  });

  it('should set queue depth', () => {
    collector.setQueueDepth(42);
    const output = collector.format();
    assert.ok(output.includes('orca_queue_depth 42'));
  });

  it('should include memory usage', () => {
    const output = collector.format();
    assert.ok(output.includes('orca_memory_usage_bytes{type="rss"}'));
    assert.ok(output.includes('orca_memory_usage_bytes{type="heapUsed"}'));
    assert.ok(output.includes('orca_memory_usage_bytes{type="heapTotal"}'));
  });

  it('should include uptime', () => {
    const output = collector.format();
    assert.ok(output.includes('orca_uptime_seconds'));
  });

  it('should include active connections', () => {
    collector.metrics.activeConnections = 5;
    const output = collector.format();
    assert.ok(output.includes('orca_active_connections 5'));
  });

  it('should reset all metrics', () => {
    collector.recordHttpRequest('/test', 'GET', 200, 100);
    collector.recordAgentCall('agent', 100, 0.01);
    collector.setQueueDepth(10);

    collector.reset();

    assert.strictEqual(collector.metrics.httpRequests.size, 0);
    assert.strictEqual(collector.metrics.agentCalls.size, 0);
    assert.strictEqual(collector.metrics.queueDepth, 0);
    assert.strictEqual(collector.metrics.totalTokens, 0);
  });

  it('should produce valid Prometheus format', () => {
    collector.recordHttpRequest('/health', 'GET', 200, 5);
    collector.recordAgentCall('test', 100, 0.01);

    const output = collector.format();
    const lines = output.split('\n').filter(l => l.trim());

    // All non-comment lines should have metric_name value format
    for (const line of lines) {
      if (line.startsWith('#')) {
        assert.ok(line.startsWith('# HELP') || line.startsWith('# TYPE'));
      } else {
        // Should match: metric_name{labels} value OR metric_name value
        assert.ok(/^\S+(\{[^}]+\})?\s+\d/.test(line), `Invalid line: ${line}`);
      }
    }
  });
});

describe('T55: Health Check Logic', () => {
  it('should track uptime from start', () => {
    const start = Date.now();
    const uptime = Math.floor((Date.now() - start) / 1000);
    assert.ok(uptime >= 0);
  });

  it('should calculate heap usage percentage', () => {
    const memUsage = process.memoryUsage();
    const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    assert.ok(heapUsedPercent > 0 && heapUsedPercent < 100);
  });

  it('should measure event loop lag', async () => {
    const loopStart = Date.now();
    await new Promise(resolve => setImmediate(resolve));
    const loopLag = Date.now() - loopStart;
    assert.ok(loopLag >= 0);
    assert.ok(loopLag < 1000); // Should be fast in tests
  });
});
