/**
 * Tests for T56: Alerting System
 * Tests AlertManager, notification channels, and alert rules.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

// Mock logger
require.cache[require.resolve('../../src/utils/logger.js')] = {
  loaded: true,
  exports: { logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }
};

const { AlertManager } = require('../../src/alerts/rules.js');
const { LogChannel, WebhookChannel, ChannelRegistry } = require('../../src/alerts/channels.js');

describe('T56: AlertManager', () => {
  let manager;

  beforeEach(() => {
    manager = new AlertManager({ checkInterval: 999999 });
  });

  it('should add alert rules', () => {
    manager.addRule({
      id: 'test-rule',
      name: 'Test Rule',
      metric: 'test_metric',
      condition: '>',
      threshold: 100,
      severity: 'warning'
    });

    assert.strictEqual(manager.rules.size, 1);
    assert.ok(manager.rules.has('test-rule'));
  });

  it('should setup default rules', () => {
    manager.setupDefaultRules();
    assert.ok(manager.rules.size >= 5);
    assert.ok(manager.rules.has('high-error-rate'));
    assert.ok(manager.rules.has('high-latency'));
    assert.ok(manager.rules.has('cost-spike'));
    assert.ok(manager.rules.has('queue-backlog'));
    assert.ok(manager.rules.has('model-unhealthy'));
  });

  it('should check conditions correctly', () => {
    assert.strictEqual(manager.checkCondition(10, '>', 5), true);
    assert.strictEqual(manager.checkCondition(5, '>', 5), false);
    assert.strictEqual(manager.checkCondition(3, '<', 5), true);
    assert.strictEqual(manager.checkCondition(5, '>=', 5), true);
    assert.strictEqual(manager.checkCondition(5, '<=', 5), true);
    assert.strictEqual(manager.checkCondition(5, '==', 5), true);
    assert.strictEqual(manager.checkCondition(5, '==', 6), false);
  });

  it('should get metric values from collector', () => {
    const { MetricsCollector } = require('../../src/server/metrics.js');
    const collector = new MetricsCollector();
    collector.recordHttpRequest('/test', 'GET', 500, 100);
    collector.recordHttpRequest('/test', 'GET', 200, 100);

    // Need to mock getMetricsCollector
    require.cache[require.resolve('../../src/server/metrics.js')] = {
      loaded: true,
      exports: {
        MetricsCollector,
        getMetricsCollector: () => collector
      }
    };

    // Re-require to use the mock
    delete require.cache[require.resolve('../../src/alerts/rules.js')];
    const { AlertManager: FreshManager } = require('../../src/alerts/rules.js');
    const freshManager = new FreshManager({ checkInterval: 999999 });

    const errorRate = freshManager.getMetricValue('http_error_rate', collector);
    assert.strictEqual(errorRate, 0.5); // 1 error out of 2 requests
  });

  it('should fire alerts when conditions are met', () => {
    manager.addRule({
      id: 'immediate-alert',
      name: 'Immediate Alert',
      metric: 'test_value',
      condition: '>',
      threshold: 50,
      duration: 0,
      severity: 'critical',
      channels: ['log']
    });

    // Manually trigger
    const rule = manager.rules.get('immediate-alert');
    manager.fireAlert(rule, 100);

    assert.strictEqual(manager.history.length, 1);
    assert.strictEqual(manager.history[0].severity, 'critical');
    assert.strictEqual(manager.history[0].status, 'firing');
  });

  it('should respect cooldown period', () => {
    manager.addRule({
      id: 'cooldown-test',
      name: 'Cooldown Test',
      metric: 'test',
      condition: '>',
      threshold: 0,
      duration: 0,
      severity: 'warning',
      channels: ['log'],
      cooldown: 300
    });

    const rule = manager.rules.get('cooldown-test');
    manager.fireAlert(rule, 1);
    manager.fireAlert(rule, 2); // Should be suppressed by cooldown

    assert.strictEqual(manager.history.length, 1);
  });

  it('should resolve alerts', () => {
    manager.addRule({
      id: 'resolve-test',
      name: 'Resolve Test',
      metric: 'test',
      condition: '>',
      threshold: 0,
      duration: 0,
      severity: 'warning',
      channels: ['log']
    });

    const rule = manager.rules.get('resolve-test');
    manager.fireAlert(rule, 1);
    manager.resolveAlert(rule);

    const alert = manager.history.find(a => a.ruleId === 'resolve-test');
    assert.strictEqual(alert.status, 'resolved');
    assert.ok(alert.resolvedAt);
  });

  it('should filter history by severity', () => {
    manager.addRule({ id: 'warn', name: 'W', metric: 'x', condition: '>', threshold: 0, duration: 0, severity: 'warning', channels: ['log'] });
    manager.addRule({ id: 'crit', name: 'C', metric: 'x', condition: '>', threshold: 0, duration: 0, severity: 'critical', channels: ['log'] });

    manager.fireAlert(manager.rules.get('warn'), 1);
    manager.fireAlert(manager.rules.get('crit'), 1);

    const warnings = manager.getHistory({ severity: 'warning' });
    assert.strictEqual(warnings.length, 1);

    const criticals = manager.getHistory({ severity: 'critical' });
    assert.strictEqual(criticals.length, 1);
  });

  it('should get active alerts', () => {
    manager.addRule({ id: 'active-test', name: 'A', metric: 'x', condition: '>', threshold: 0, duration: 0, severity: 'warning', channels: ['log'] });
    manager.fireAlert(manager.rules.get('active-test'), 1);

    const active = manager.getActiveAlerts();
    assert.strictEqual(active.length, 1);
    assert.strictEqual(active[0].status, 'firing');
  });

  it('should limit history size', () => {
    const smallManager = new AlertManager({ checkInterval: 999999, maxHistory: 5 });
    smallManager.addRule({ id: 'test', name: 'T', metric: 'x', condition: '>', threshold: 0, duration: 0, severity: 'info', channels: ['log'] });

    for (let i = 0; i < 10; i++) {
      smallManager.fireAlert(smallManager.rules.get('test'), i);
    }

    assert.ok(smallManager.history.length <= 5);
  });
});

describe('T56: Notification Channels', () => {
  it('should create log channel', () => {
    const channel = new LogChannel();
    assert.strictEqual(channel.name, 'log');
    assert.strictEqual(channel.enabled, true);
  });

  it('should create webhook channel', () => {
    const channel = new WebhookChannel({ url: 'https://hooks.slack.com/test' });
    assert.strictEqual(channel.name, 'webhook');
    assert.strictEqual(channel.url, 'https://hooks.slack.com/test');
  });

  it('should fail webhook without URL', async () => {
    const channel = new WebhookChannel();
    const result = await channel.send({ severity: 'warning', message: 'test' });
    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('No webhook URL'));
  });

  it('should create channel registry', () => {
    const registry = new ChannelRegistry();
    assert.ok(registry.get('log'));
    assert.strictEqual(registry.list().length, 1);
  });

  it('should register custom channels', () => {
    const registry = new ChannelRegistry();
    registry.register(new WebhookChannel({ name: 'slack', url: 'https://hooks.slack.com/test' }));
    assert.ok(registry.get('slack'));
    assert.strictEqual(registry.list().length, 2);
  });

  it('should dispatch to multiple channels', async () => {
    const registry = new ChannelRegistry();
    const results = await registry.dispatch(
      { severity: 'warning', message: 'test' },
      ['log']
    );
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].success, true);
  });

  it('should handle missing channels gracefully', async () => {
    const registry = new ChannelRegistry();
    const results = await registry.dispatch(
      { severity: 'warning', message: 'test' },
      ['nonexistent']
    );
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].success, false);
  });
});
