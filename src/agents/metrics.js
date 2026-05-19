/**
 * T67: Agent Performance Metrics
 *
 * Tracks per-agent success rate, latency, token efficiency, and cost.
 * Reads from the tasks table and agent_metrics aggregate table.
 */

const { getDatabaseInstance } = require('../db');
const { logger } = require('../utils/logger');

class AgentMetrics {
  constructor() {
    this.cache = new Map(); // role -> cached metrics
    this.cacheTTL = 60000; // 1 minute
    this.lastCacheClear = Date.now();
  }

  /**
   * Get the database instance
   */
  async _getDb() {
    return getDatabaseInstance();
  }

  /**
   * Clear stale cache entries
   */
  _clearStaleCache() {
    if (Date.now() - this.lastCacheClear > this.cacheTTL) {
      this.cache.clear();
      this.lastCacheClear = Date.now();
    }
  }

  /**
   * Get performance metrics for a specific agent
   * @param {string} agentRole
   * @returns {Object} Agent performance metrics
   */
  async getAgentMetrics(agentRole) {
    this._clearStaleCache();
    if (this.cache.has(agentRole)) {
      return this.cache.get(agentRole);
    }

    const db = await this._getDb();
    const adapter = db.getAdapter();

    // Get aggregate data from agent_metrics table
    let aggregate;
    try {
      const rows = await adapter.all(
        `SELECT * FROM agent_metrics WHERE agent_role = ?`,
        [agentRole]
      );
      aggregate = rows[0] || null;
    } catch {
      // Table may not exist yet
      aggregate = null;
    }

    // Get recent task data for percentile calculations
    let recentTasks = [];
    try {
      recentTasks = await adapter.all(
        `SELECT latency_ms, success, tokens, cost, model_used, error_type, created_at
         FROM tasks
         WHERE agent_role = ? AND latency_ms IS NOT NULL
         ORDER BY created_at DESC
         LIMIT 1000`,
        [agentRole]
      );
    } catch {
      // New columns may not exist yet
    }

    // Calculate percentiles from recent tasks
    const latencies = recentTasks
      .map(t => t.latency_ms)
      .filter(l => l != null)
      .sort((a, b) => a - b);

    const successCount = recentTasks.filter(t => t.success !== false).length;
    const failCount = recentTasks.filter(t => t.success === false).length;
    const totalRecent = recentTasks.length;

    const metrics = {
      agentRole,
      totalCalls: aggregate?.total_calls || totalRecent,
      successfulCalls: aggregate?.successful_calls || successCount,
      failedCalls: aggregate?.failed_calls || failCount,
      successRate: totalRecent > 0
        ? (successCount / totalRecent * 100).toFixed(2)
        : aggregate
          ? ((aggregate.successful_calls / Math.max(aggregate.total_calls, 1)) * 100).toFixed(2)
          : '0.00',
      totalTokens: aggregate?.total_tokens || recentTasks.reduce((sum, t) => sum + (t.tokens || 0), 0),
      totalCost: aggregate?.total_cost || recentTasks.reduce((sum, t) => sum + (t.cost || 0), 0),
      avgLatencyMs: latencies.length > 0
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : aggregate?.total_calls > 0
          ? Math.round(aggregate.total_latency_ms / aggregate.total_calls)
          : null,
      p50LatencyMs: this._percentile(latencies, 50),
      p90LatencyMs: this._percentile(latencies, 90),
      p95LatencyMs: this._percentile(latencies, 95),
      p99LatencyMs: this._percentile(latencies, 99),
      minLatencyMs: aggregate?.min_latency_ms ?? (latencies.length > 0 ? latencies[0] : null),
      maxLatencyMs: aggregate?.max_latency_ms ?? (latencies.length > 0 ? latencies[latencies.length - 1] : null),
      tokensPerCall: totalRecent > 0
        ? Math.round(recentTasks.reduce((sum, t) => sum + (t.tokens || 0), 0) / totalRecent)
        : null,
      costPerCall: totalRecent > 0
        ? (recentTasks.reduce((sum, t) => sum + (t.cost || 0), 0) / totalRecent).toFixed(6)
        : null,
      lastCallAt: aggregate?.last_call_at || (recentTasks[0]?.created_at || null),
      recentErrorTypes: this._topErrorTypes(recentTasks),
      modelsUsed: this._modelBreakdown(recentTasks),
    };

    this.cache.set(agentRole, metrics);
    return metrics;
  }

  /**
   * Get metrics for all agents
   * @returns {Object[]} Array of agent metrics sorted by total calls
   */
  async getAllAgentMetrics() {
    const db = await this._getDb();
    const adapter = db.getAdapter();

    let roles = [];
    try {
      const rows = await adapter.all(
        `SELECT DISTINCT agent_role FROM tasks ORDER BY agent_role`
      );
      roles = rows.map(r => r.agent_role);
    } catch {
      return [];
    }

    const metrics = await Promise.all(roles.map(r => this.getAgentMetrics(r)));
    return metrics.sort((a, b) => (b.totalCalls || 0) - (a.totalCalls || 0));
  }

  /**
   * Get leaderboard of agents ranked by a composite score
   * @param {Object} options - { sortBy, limit }
   * @returns {Object[]} Ranked agents
   */
  async getLeaderboard({ sortBy = 'score', limit = 20 } = {}) {
    const allMetrics = await this.getAllAgentMetrics();

    // Filter to agents with at least 5 calls for meaningful stats
    const qualified = allMetrics.filter(m => m.totalCalls >= 5);

    // Calculate composite score: weighted blend of success rate, latency, efficiency
    const scored = qualified.map(m => {
      const successScore = parseFloat(m.successRate) || 0;
      const latencyScore = m.p95LatencyMs != null
        ? Math.max(0, 100 - (m.p95LatencyMs / 10)) // 1000ms = 0 score
        : 50;
      const efficiencyScore = m.tokensPerCall != null
        ? Math.max(0, 100 - (m.tokensPerCall / 100)) // 10000 tokens = 0 score
        : 50;

      return {
        ...m,
        score: (successScore * 0.5) + (latencyScore * 0.3) + (efficiencyScore * 0.2),
        successScore: successScore.toFixed(1),
        latencyScore: latencyScore.toFixed(1),
        efficiencyScore: efficiencyScore.toFixed(1),
      };
    });

    // Sort by chosen criteria
    const sortFns = {
      score: (a, b) => b.score - a.score,
      successRate: (a, b) => parseFloat(b.successRate) - parseFloat(a.successRate),
      latency: (a, b) => (a.p95LatencyMs || Infinity) - (b.p95LatencyMs || Infinity),
      calls: (a, b) => b.totalCalls - a.totalCalls,
      cost: (a, b) => a.totalCost - b.totalCost,
    };

    scored.sort(sortFns[sortBy] || sortFns.score);
    return scored.slice(0, limit);
  }

  /**
   * Identify underperforming agents that should be re-routed
   * @param {Object} thresholds
   * @returns {Object[]} Agents below thresholds with suggested replacements
   */
  async getUnderperformers({
    minSuccessRate = 80,
    maxP95LatencyMs = 2000,
    minCalls = 5,
  } = {}) {
    const allMetrics = await this.getAllAgentMetrics();
    const { getModelRegistry } = require('../models/registry');
    const registry = getModelRegistry();

    return allMetrics
      .filter(m => m.totalCalls >= minCalls)
      .filter(m => {
        const lowSuccess = parseFloat(m.successRate) < minSuccessRate;
        const highLatency = m.p95LatencyMs != null && m.p95LatencyMs > maxP95LatencyMs;
        return lowSuccess || highLatency;
      })
      .map(m => {
        const issues = [];
        if (parseFloat(m.successRate) < minSuccessRate) {
          issues.push(`Low success rate: ${m.successRate}%`);
        }
        if (m.p95LatencyMs != null && m.p95LatencyMs > maxP95LatencyMs) {
          issues.push(`High P95 latency: ${m.p95LatencyMs}ms`);
        }

        // Find the agent's current model and suggest alternatives
        const agents = require('../agents.json');
        const agentDef = agents.agents?.find(a => a.role === m.agentRole);
        const currentModel = agentDef?.model || 'unknown';

        return {
          agentRole: m.agentRole,
          currentModel,
          issues,
          metrics: {
            successRate: m.successRate,
            p95LatencyMs: m.p95LatencyMs,
            totalCalls: m.totalCalls,
            avgLatencyMs: m.avgLatencyMs,
          },
          suggestion: `Consider switching ${m.agentRole} from ${currentModel} to a faster/more reliable model`,
        };
      });
  }

  /**
   * Record a single agent call metric (for real-time tracking)
   * Called from core.js after each API call
   */
  async recordCall(agentRole, { tokens = 0, cost = 0, latencyMs = 0, success = true, modelUsed = null, errorType = null } = {}) {
    try {
      const db = await this._getDb();
      const adapter = db.getAdapter();

      // Upsert into agent_metrics aggregate table
      await adapter.execute(
        `INSERT INTO agent_metrics (agent_role, total_calls, successful_calls, failed_calls, total_tokens, total_cost, total_latency_ms, min_latency_ms, max_latency_ms, last_call_at, updated_at)
         VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(agent_role) DO UPDATE SET
           total_calls = total_calls + 1,
           successful_calls = successful_calls + ?,
           failed_calls = failed_calls + ?,
           total_tokens = total_tokens + ?,
           total_cost = total_cost + ?,
           total_latency_ms = total_latency_ms + ?,
           min_latency_ms = CASE WHEN ? < min_latency_ms OR min_latency_ms IS NULL THEN ? ELSE min_latency_ms END,
           max_latency_ms = CASE WHEN ? > max_latency_ms OR max_latency_ms IS NULL THEN ? ELSE max_latency_ms END,
           last_call_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP`,
        [
          agentRole,
          success ? 1 : 0,
          success ? 0 : 1,
          tokens,
          cost,
          latencyMs,
          latencyMs,
          latencyMs,
          // ON CONFLICT params
          success ? 1 : 0,
          success ? 0 : 1,
          tokens,
          cost,
          latencyMs,
          latencyMs, latencyMs,
          latencyMs, latencyMs,
        ]
      );

      // Invalidate cache for this agent
      this.cache.delete(agentRole);
    } catch (err) {
      logger.warn({ error: err.message, agentRole }, 'Failed to record agent metrics');
    }
  }

  /**
   * Calculate a percentile from a sorted array
   */
  _percentile(sorted, p) {
    if (sorted.length === 0) return null;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  /**
   * Get top error types from recent tasks
   */
  _topErrorTypes(tasks) {
    const counts = {};
    for (const t of tasks) {
      if (t.error_type) {
        counts[t.error_type] = (counts[t.error_type] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([type, count]) => ({ type, count }));
  }

  /**
   * Get model usage breakdown
   */
  _modelBreakdown(tasks) {
    const counts = {};
    for (const t of tasks) {
      if (t.model_used) {
        counts[t.model_used] = (counts[t.model_used] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([model, count]) => ({ model, count }));
  }
}

// Singleton
let instance = null;

function getAgentMetrics() {
  if (!instance) {
    instance = new AgentMetrics();
  }
  return instance;
}

module.exports = { AgentMetrics, getAgentMetrics };
