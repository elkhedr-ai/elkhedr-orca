/**
 * Alerting System
 * Configurable alerts for system metrics with notification channels.
 */

const { logger } = require('../utils/logger.js');
const { getMetricsCollector } = require('../server/metrics.js');

class AlertManager {
  constructor(options = {}) {
    this.rules = new Map();
    this.history = [];
    this.channels = {
      log: this.sendLogAlert.bind(this),
      ...(options.channels || {})
    };
    this.checkInterval = options.checkInterval || 60000; // 60s
    this.maxHistory = options.maxHistory || 1000;
  }

  /**
   * Define alert rules
   */
  addRule(rule) {
    this.rules.set(rule.id, {
      id: rule.id,
      name: rule.name,
      metric: rule.metric,
      condition: rule.condition, // '>', '<', '=='
      threshold: rule.threshold,
      duration: rule.duration || 0, // sustained for N seconds
      severity: rule.severity || 'warning', // warning, critical
      channels: rule.channels || ['log'],
      cooldown: rule.cooldown || 300, // seconds between alerts
      lastFired: null,
      active: false
    });
    logger.info({ ruleId: rule.id }, 'Alert rule added');
  }

  /**
   * Default rules
   */
  setupDefaultRules() {
    this.addRule({
      id: 'high-error-rate',
      name: 'High Error Rate',
      metric: 'http_error_rate',
      condition: '>',
      threshold: 0.1, // 10%
      duration: 60,
      severity: 'critical',
      channels: ['log']
    });

    this.addRule({
      id: 'high-latency',
      name: 'High API Latency',
      metric: 'avg_latency',
      condition: '>',
      threshold: 5000, // 5s
      duration: 120,
      severity: 'warning',
      channels: ['log']
    });

    this.addRule({
      id: 'cost-spike',
      name: 'Cost Spike',
      metric: 'hourly_cost',
      condition: '>',
      threshold: 5.0, // $5/hour
      duration: 0,
      severity: 'warning',
      channels: ['log']
    });

    this.addRule({
      id: 'queue-backlog',
      name: 'Queue Backlog',
      metric: 'queue_depth',
      condition: '>',
      threshold: 100,
      duration: 300,
      severity: 'critical',
      channels: ['log']
    });

    this.addRule({
      id: 'model-unhealthy',
      name: 'Model Unhealthy',
      metric: 'unhealthy_models',
      condition: '>',
      threshold: 0,
      duration: 60,
      severity: 'warning',
      channels: ['log']
    });

    this.addRule({
      id: 'low-cache-hit',
      name: 'Low Cache Hit Rate',
      metric: 'cache_hit_rate',
      condition: '<',
      threshold: 0.5, // 50%
      duration: 300,
      severity: 'warning',
      channels: ['log']
    });
  }

  /**
   * Evaluate all rules
   */
  evaluate() {
    const metrics = getMetricsCollector();
    const now = Date.now();

    for (const rule of this.rules.values()) {
      const value = this.getMetricValue(rule.metric, metrics);
      const triggered = this.checkCondition(value, rule.condition, rule.threshold);

      if (triggered) {
        if (!rule.active) {
          // First time triggering
          rule.active = true;
          rule.triggeredAt = now;
        } else if (rule.duration > 0 && (now - rule.triggeredAt) / 1000 >= rule.duration) {
          // Sustained for required duration
          this.fireAlert(rule, value);
        } else if (rule.duration === 0) {
          // Immediate alert
          this.fireAlert(rule, value);
        }
      } else {
        if (rule.active) {
          // Rule resolved
          rule.active = false;
          this.resolveAlert(rule);
        }
      }
    }
  }

  /**
   * Get metric value
   */
  getMetricValue(metric, metricsCollector) {
    switch (metric) {
      case 'http_error_rate': {
        let total = 0;
        let errors = 0;
        for (const m of metricsCollector.metrics.httpRequests.values()) {
          total += m.count;
          errors += m.errors;
        }
        return total > 0 ? errors / total : 0;
      }
      case 'avg_latency': {
        let totalLatency = 0;
        let totalCount = 0;
        for (const m of metricsCollector.metrics.httpRequests.values()) {
          totalLatency += m.latency_sum;
          totalCount += m.count;
        }
        return totalCount > 0 ? totalLatency / totalCount : 0;
      }
      case 'hourly_cost':
        return metricsCollector.metrics.totalCost; // Simplified
      case 'queue_depth':
        return metricsCollector.metrics.queueDepth;
      case 'unhealthy_models': {
        const { getModelRegistry } = require('../models/registry.js');
        return getModelRegistry().getStats().unhealthy;
      }
      case 'cache_hit_rate': {
        const total = metricsCollector.metrics.cacheHits + metricsCollector.metrics.cacheMisses;
        return total > 0 ? metricsCollector.metrics.cacheHits / total : 0;
      }
      default:
        return 0;
    }
  }

  /**
   * Check condition
   */
  checkCondition(value, condition, threshold) {
    switch (condition) {
      case '>': return value > threshold;
      case '<': return value < threshold;
      case '>=': return value >= threshold;
      case '<=': return value <= threshold;
      case '==': return value === threshold;
      default: return false;
    }
  }

  /**
   * Fire an alert
   */
  fireAlert(rule, value) {
    const now = Date.now();

    // Check cooldown
    if (rule.lastFired && (now - rule.lastFired) / 1000 < rule.cooldown) {
      return;
    }

    rule.lastFired = now;

    const alert = {
      id: `${rule.id}-${now}`,
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      value,
      threshold: rule.threshold,
      timestamp: new Date().toISOString(),
      status: 'firing'
    };

    this.history.push(alert);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // Send to channels
    for (const channel of rule.channels) {
      if (this.channels[channel]) {
        this.channels[channel](alert);
      }
    }

    logger.warn({
      rule: rule.name,
      severity: rule.severity,
      value,
      threshold: rule.threshold
    }, 'Alert fired');
  }

  /**
   * Resolve an alert
   */
  resolveAlert(rule) {
    // Find the most recent firing alert for this rule
    const alert = [...this.history].reverse().find(a => a.ruleId === rule.id && a.status === 'firing');
    if (alert) {
      alert.status = 'resolved';
      alert.resolvedAt = new Date().toISOString();

      logger.info({ rule: rule.name }, 'Alert resolved');
    }
  }

  /**
   * Log channel
   */
  sendLogAlert(alert) {
    const fn = alert.severity === 'critical' ? logger.error : logger.warn;
    fn({ alert }, `ALERT: ${alert.ruleName}`);
  }

  /**
   * Get alert history
   */
  getHistory(options = {}) {
    let alerts = [...this.history];
    if (options.severity) {
      alerts = alerts.filter(a => a.severity === options.severity);
    }
    if (options.status) {
      alerts = alerts.filter(a => a.status === options.status);
    }
    if (options.limit) {
      alerts = alerts.slice(-options.limit);
    }
    return alerts.reverse();
  }

  /**
   * Get active alerts
   */
  getActiveAlerts() {
    return this.history.filter(a => a.status === 'firing');
  }

  /**
   * Start monitoring
   */
  start() {
    this.evaluate();
    this._interval = setInterval(() => this.evaluate(), this.checkInterval);
    logger.info({ interval: this.checkInterval }, 'Alert manager started');
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }
}

module.exports = {
  AlertManager
};
