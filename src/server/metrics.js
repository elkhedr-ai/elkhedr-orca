/**
 * Prometheus Metrics
 * Exposes application metrics for scraping by Prometheus.
 */

const { logger } = require('../utils/logger.js');

class MetricsCollector {
  constructor() {
    this.metrics = {
      httpRequests: new Map(), // path -> { count, latency_sum, errors }
      activeConnections: 0,
      agentCalls: new Map(),
      queueDepth: 0,
      totalTokens: 0,
      totalCost: 0,
      dbQueries: { count: 0, errors: 0 },
      cacheHits: 0,
      cacheMisses: 0
    };
    this.startTime = Date.now();
  }

  /**
   * Record HTTP request
   */
  recordHttpRequest(path, method, statusCode, duration) {
    const key = `${method} ${path}`;
    if (!this.metrics.httpRequests.has(key)) {
      this.metrics.httpRequests.set(key, { count: 0, latency_sum: 0, errors: 0 });
    }
    const metric = this.metrics.httpRequests.get(key);
    metric.count++;
    metric.latency_sum += duration;
    if (statusCode >= 400) {
      metric.errors++;
    }
  }

  /**
   * Record agent call
   */
  recordAgentCall(agentRole, tokens, cost, success = true) {
    if (!this.metrics.agentCalls.has(agentRole)) {
      this.metrics.agentCalls.set(agentRole, { count: 0, tokens: 0, cost: 0, errors: 0 });
    }
    const metric = this.metrics.agentCalls.get(agentRole);
    metric.count++;
    metric.tokens += tokens;
    metric.cost += cost;
    if (!success) metric.errors++;

    this.metrics.totalTokens += tokens;
    this.metrics.totalCost += cost;
  }

  /**
   * Record database query
   */
  recordDbQuery(success = true) {
    this.metrics.dbQueries.count++;
    if (!success) this.metrics.dbQueries.errors++;
  }

  /**
   * Record cache hit/miss
   */
  recordCacheHit() {
    this.metrics.cacheHits++;
  }

  recordCacheMiss() {
    this.metrics.cacheMisses++;
  }

  /**
   * Update queue depth
   */
  setQueueDepth(depth) {
    this.metrics.queueDepth = depth;
  }

  /**
   * Generate Prometheus format output
   */
  format() {
    const lines = [];
    const timestamp = Date.now();

    // Uptime
    lines.push('# HELP orca_uptime_seconds Total uptime in seconds');
    lines.push('# TYPE orca_uptime_seconds counter');
    lines.push(`orca_uptime_seconds ${(timestamp - this.startTime) / 1000}`);

    // HTTP requests
    lines.push('# HELP orca_http_requests_total Total HTTP requests');
    lines.push('# TYPE orca_http_requests_total counter');
    for (const [key, metric] of this.metrics.httpRequests) {
      const [method, path] = key.split(' ');
      lines.push(`orca_http_requests_total{method="${method}",path="${path}"} ${metric.count}`);
    }

    // HTTP latency
    lines.push('# HELP orca_http_request_duration_seconds_sum Sum of HTTP request durations');
    lines.push('# TYPE orca_http_request_duration_seconds_sum counter');
    for (const [key, metric] of this.metrics.httpRequests) {
      const [method, path] = key.split(' ');
      lines.push(`orca_http_request_duration_seconds_sum{method="${method}",path="${path}"} ${metric.latency_sum / 1000}`);
    }

    // HTTP errors
    lines.push('# HELP orca_http_errors_total Total HTTP errors');
    lines.push('# TYPE orca_http_errors_total counter');
    for (const [key, metric] of this.metrics.httpRequests) {
      const [method, path] = key.split(' ');
      if (metric.errors > 0) {
        lines.push(`orca_http_errors_total{method="${method}",path="${path}"} ${metric.errors}`);
      }
    }

    // Agent calls
    lines.push('# HELP orca_agent_calls_total Total agent calls');
    lines.push('# TYPE orca_agent_calls_total counter');
    for (const [role, metric] of this.metrics.agentCalls) {
      lines.push(`orca_agent_calls_total{agent="${role}"} ${metric.count}`);
    }

    // Queue depth
    lines.push('# HELP orca_queue_depth Current queue depth');
    lines.push('# TYPE orca_queue_depth gauge');
    lines.push(`orca_queue_depth ${this.metrics.queueDepth}`);

    // Total tokens and cost
    lines.push('# HELP orca_total_tokens Total tokens consumed');
    lines.push('# TYPE orca_total_tokens counter');
    lines.push(`orca_total_tokens ${this.metrics.totalTokens}`);

    lines.push('# HELP orca_total_cost_total Total cost in USD');
    lines.push('# TYPE orca_total_cost_total counter');
    lines.push(`orca_total_cost_total ${this.metrics.totalCost.toFixed(6)}`);

    // Cache metrics
    const totalCache = this.metrics.cacheHits + this.metrics.cacheMisses;
    const hitRate = totalCache > 0 ? (this.metrics.cacheHits / totalCache) : 0;
    lines.push('# HELP orca_cache_hit_rate Cache hit rate');
    lines.push('# TYPE orca_cache_hit_rate gauge');
    lines.push(`orca_cache_hit_rate ${hitRate.toFixed(4)}`);

    // DB queries
    lines.push('# HELP orca_db_queries_total Total database queries');
    lines.push('# TYPE orca_db_queries_total counter');
    lines.push(`orca_db_queries_total ${this.metrics.dbQueries.count}`);
    lines.push(`orca_db_query_errors_total ${this.metrics.dbQueries.errors}`);

    // Memory usage
    const memUsage = process.memoryUsage();
    lines.push('# HELP orca_memory_usage_bytes Memory usage in bytes');
    lines.push('# TYPE orca_memory_usage_bytes gauge');
    lines.push(`orca_memory_usage_bytes{type="rss"} ${memUsage.rss}`);
    lines.push(`orca_memory_usage_bytes{type="heapUsed"} ${memUsage.heapUsed}`);
    lines.push(`orca_memory_usage_bytes{type="heapTotal"} ${memUsage.heapTotal}`);

    // Active connections (simulated)
    lines.push('# HELP orca_active_connections Active connections');
    lines.push('# TYPE orca_active_connections gauge');
    lines.push(`orca_active_connections ${this.metrics.activeConnections}`);

    return lines.join('\n') + '\n';
  }

  /**
   * Reset counters (useful for testing)
   */
  reset() {
    this.metrics.httpRequests.clear();
    this.metrics.agentCalls.clear();
    this.metrics.queueDepth = 0;
    this.metrics.totalTokens = 0;
    this.metrics.totalCost = 0;
    this.metrics.dbQueries = { count: 0, errors: 0 };
    this.metrics.cacheHits = 0;
    this.metrics.cacheMisses = 0;
  }
}

// Singleton
let instance = null;
function getMetricsCollector() {
  if (!instance) {
    instance = new MetricsCollector();
  }
  return instance;
}

module.exports = {
  MetricsCollector,
  getMetricsCollector
};
