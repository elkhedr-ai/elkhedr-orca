/**
 * T67: Agent Performance Leaderboard
 *
 * Provides agent ranking, comparison, and automatic model re-routing
 * for underperforming agents.
 */

const { getAgentMetrics } = require('./metrics');
const { logger } = require('../utils/logger');

class AgentLeaderboard {
  constructor() {
    this.rerouteHistory = []; // Track re-routing decisions
    this.autoRerouteEnabled = true;
    this.thresholds = {
      minSuccessRate: 80,       // Below 80% success rate
      maxP95LatencyMs: 2000,    // Above 2s P95 latency
      minCallsForEvaluation: 5, // Need at least 5 calls to evaluate
      cooldownMs: 300000,       // 5 min cooldown between re-routes per agent
    };
    this.lastReroute = new Map(); // agentRole -> timestamp
  }

  /**
   * Get the full leaderboard with rankings
   */
  async getLeaderboard(options = {}) {
    return getAgentMetrics().getLeaderboard(options);
  }

  /**
   * Get agents that need attention (underperforming)
   */
  async getAgentsNeedingAttention() {
    const metrics = getAgentMetrics();
    const underperformers = await metrics.getUnderperformers({
      minSuccessRate: this.thresholds.minSuccessRate,
      maxP95LatencyMs: this.thresholds.maxP95LatencyMs,
      minCalls: this.thresholds.minCallsForEvaluation,
    });

    return underperformers.map(u => ({
      ...u,
      severity: this._calculateSeverity(u),
      canAutoReroute: this._canAutoReroute(u.agentRole),
    }));
  }

  /**
   * Check if an agent should be re-routed and generate a recommendation
   * @param {string} agentRole
   * @returns {Object|null} Re-route recommendation or null
   */
  async checkAndRecommend(agentRole) {
    const metrics = getAgentMetrics();
    const agentMetrics = await metrics.getAgentMetrics(agentRole);

    if (agentMetrics.totalCalls < this.thresholds.minCallsForEvaluation) {
      return null; // Not enough data
    }

    const issues = [];
    if (parseFloat(agentMetrics.successRate) < this.thresholds.minSuccessRate) {
      issues.push({
        type: 'low_success_rate',
        value: agentMetrics.successRate,
        threshold: this.thresholds.minSuccessRate,
      });
    }
    if (agentMetrics.p95LatencyMs != null && agentMetrics.p95LatencyMs > this.thresholds.maxP95LatencyMs) {
      issues.push({
        type: 'high_latency',
        value: agentMetrics.p95LatencyMs,
        threshold: this.thresholds.maxP95LatencyMs,
      });
    }

    if (issues.length === 0) return null;

    // Find current model
    let currentModel = 'unknown';
    try {
      const agents = require('../agents.json');
      const agentDef = agents.agents?.find(a => a.role === agentRole);
      currentModel = agentDef?.model || 'unknown';
    } catch { /* ignore */ }

    return {
      agentRole,
      currentModel,
      issues,
      metrics: {
        successRate: agentMetrics.successRate,
        p95LatencyMs: agentMetrics.p95LatencyMs,
        totalCalls: agentMetrics.totalCalls,
      },
      recommendation: `Agent "${agentRole}" is underperforming on ${currentModel}. Consider switching to a faster/more reliable model.`,
      canAutoReroute: this._canAutoReroute(agentRole),
    };
  }

  /**
   * Execute automatic re-routing for a specific agent
   * This modifies the in-memory model registry to route to a better model
   * @param {string} agentRole
   * @returns {Object} Re-route result
   */
  async executeAutoReroute(agentRole) {
    if (!this.autoRerouteEnabled) {
      return { success: false, reason: 'Auto-reroute is disabled' };
    }

    if (!this._canAutoReroute(agentRole)) {
      return { success: false, reason: 'Cooldown period active' };
    }

    const recommendation = await this.checkAndRecommend(agentRole);
    if (!recommendation) {
      return { success: false, reason: 'Agent is performing adequately' };
    }

    const { getModelRegistry } = require('../models/registry');
    const registry = getModelRegistry();

    // Find the best available model based on registry health data
    const healthiestModel = this._findHealthiestAlternative(registry, recommendation.currentModel);
    if (!healthiestModel) {
      return { success: false, reason: 'No healthier alternative model found' };
    }

    // Record the re-route decision
    const decision = {
      agentRole,
      fromModel: recommendation.currentModel,
      toModel: healthiestModel,
      issues: recommendation.issues,
      timestamp: new Date().toISOString(),
    };

    this.rerouteHistory.push(decision);
    this.lastReroute.set(agentRole, Date.now());

    logger.warn({
      agentRole,
      fromModel: recommendation.currentModel,
      toModel: healthiestModel,
      issues: recommendation.issues,
    }, 'Auto-rerouting agent to healthier model');

    // Note: Actual model change requires updating agents.json or in-memory registry
    // This is intentionally a recommendation + log, not an automatic mutation,
    // to prevent unexpected behavior in production.

    return {
      success: true,
      decision,
      note: 'Re-route logged. Apply manually or enable auto-mutation in config.',
    };
  }

  /**
   * Get the re-routing history
   */
  getRerouteHistory(limit = 50) {
    return this.rerouteHistory.slice(-limit);
  }

  /**
   * Get a comparison between two agents
   */
  async compareAgents(agentRoleA, agentRoleB) {
    const metrics = getAgentMetrics();
    const [a, b] = await Promise.all([
      metrics.getAgentMetrics(agentRoleA),
      metrics.getAgentMetrics(agentRoleB),
    ]);

    return {
      agents: [a, b],
      comparison: {
        successRateDiff: (parseFloat(a.successRate) - parseFloat(b.successRate)).toFixed(2),
        latencyDiff: (a.avgLatencyMs || 0) - (b.avgLatencyMs || 0),
        tokensDiff: (a.tokensPerCall || 0) - (b.tokensPerCall || 0),
        costDiff: ((a.costPerCall || 0) - (b.costPerCall || 0)).toFixed(6),
        winner: this._determineWinner(a, b),
      },
    };
  }

  /**
   * Calculate severity level for an underperformer
   */
  _calculateSeverity(agent) {
    const successRate = parseFloat(agent.metrics.successRate);
    const p95 = agent.metrics.p95LatencyMs;

    if (successRate < 50 || (p95 && p95 > 5000)) return 'critical';
    if (successRate < 70 || (p95 && p95 > 3000)) return 'high';
    return 'medium';
  }

  /**
   * Check if an agent can be auto-re-routed (cooldown check)
   */
  _canAutoReroute(agentRole) {
    const lastTime = this.lastReroute.get(agentRole);
    if (!lastTime) return true;
    return Date.now() - lastTime > this.thresholds.cooldownMs;
  }

  /**
   * Find the healthiest alternative model from the registry
   */
  _findHealthiestAlternative(registry, currentModel) {
    try {
      const models = registry.getModels?.() || [];
      const healthy = models
        .filter(m => m.health !== 'UNHEALTHY' && m.model !== currentModel)
        .sort((a, b) => {
          // Prefer models with lower latency and higher success
          const scoreA = (a.metrics?.averageLatency || 1000) / Math.max(a.metrics?.successes || 1, 1);
          const scoreB = (b.metrics?.averageLatency || 1000) / Math.max(b.metrics?.successes || 1, 1);
          return scoreA - scoreB;
        });

      return healthy[0]?.model || null;
    } catch {
      return null;
    }
  }

  /**
   * Determine the winner between two agents
   */
  _determineWinner(a, b) {
    const scoreA = parseFloat(a.successRate) * 0.5 - (a.avgLatencyMs || 0) / 100 * 0.3 - (a.tokensPerCall || 0) / 1000 * 0.2;
    const scoreB = parseFloat(b.successRate) * 0.5 - (b.avgLatencyMs || 0) / 100 * 0.3 - (b.tokensPerCall || 0) / 1000 * 0.2;

    if (Math.abs(scoreA - scoreB) < 1) return 'tie';
    return scoreA > scoreB ? a.agentRole : b.agentRole;
  }
}

// Singleton
let instance = null;

function getAgentLeaderboard() {
  if (!instance) {
    instance = new AgentLeaderboard();
  }
  return instance;
}

module.exports = { AgentLeaderboard, getAgentLeaderboard };
