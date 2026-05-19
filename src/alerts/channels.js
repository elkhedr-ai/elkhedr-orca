/**
 * Alert Notification Channels
 * Dispatch alerts via log, webhook (Slack/Discord), email, and PagerDuty.
 */

const { logger } = require('../utils/logger.js');

/**
 * Base channel class
 */
class AlertChannel {
  constructor(config = {}) {
    this.name = config.name || 'unknown';
    this.enabled = config.enabled !== false;
  }

  async send(alert) {
    throw new Error(`${this.name}.send() not implemented`);
  }
}

/**
 * Log channel - writes to application logger
 */
class LogChannel extends AlertChannel {
  constructor() {
    super({ name: 'log' });
  }

  async send(alert) {
    const fn = alert.severity === 'critical' ? logger.error : logger.warn;
    fn({
      alertId: alert.id,
      ruleId: alert.ruleId,
      severity: alert.severity,
      value: alert.value,
      threshold: alert.threshold
    }, `ALERT: ${alert.ruleName || alert.message}`);
    return { success: true, channel: 'log' };
  }
}

/**
 * Webhook channel - sends to Slack/Discord/generic webhook
 */
class WebhookChannel extends AlertChannel {
  constructor(config = {}) {
    super({ name: config.name || 'webhook' });
    this.url = config.url;
    this.headers = config.headers || {};
  }

  async send(alert) {
    if (!this.url) {
      return { success: false, channel: this.name, error: 'No webhook URL configured' };
    }

    const severityEmoji = {
      info: ':information_source:',
      warning: ':warning:',
      critical: ':rotating_light:'
    };

    const payload = {
      text: `${severityEmoji[alert.severity] || ':bell:'} *Alert: ${alert.ruleName || alert.metric}*\n${alert.message || `${alert.metric} = ${alert.value} (threshold: ${alert.threshold})`}\nSeverity: ${alert.severity}\nTime: ${alert.timestamp || new Date().toISOString()}`
    };

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.headers },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000)
      });

      return {
        success: response.ok,
        channel: this.name,
        statusCode: response.status
      };
    } catch (error) {
      return {
        success: false,
        channel: this.name,
        error: error.message
      };
    }
  }
}

/**
 * Email channel - sends via SMTP (simplified)
 */
class EmailChannel extends AlertChannel {
  constructor(config = {}) {
    super({ name: 'email' });
    this.smtpUrl = config.smtpUrl || config.SMTP_URL;
    this.from = config.from || 'alerts@orca.elkhedr.com';
    this.to = config.to || [];
  }

  async send(alert) {
    if (!this.to.length) {
      return { success: false, channel: 'email', error: 'No recipients configured' };
    }

    // In production, use nodemailer or similar
    // For now, log the email that would be sent
    logger.info({
      to: this.to,
      subject: `[${alert.severity.toUpperCase()}] Orca Alert: ${alert.ruleName || alert.metric}`,
      body: alert.message || `${alert.metric} = ${alert.value} (threshold: ${alert.threshold})`
    }, 'Email alert (not sent - SMTP not configured)');

    return { success: true, channel: 'email', simulated: true };
  }
}

/**
 * PagerDuty channel - sends via Events API v2
 */
class PagerDutyChannel extends AlertChannel {
  constructor(config = {}) {
    super({ name: 'pagerduty' });
    this.routingKey = config.routingKey || config.PAGERDUTY_ROUTING_KEY;
    this.apiUrl = 'https://events.pagerduty.com/v2/enqueue';
  }

  async send(alert) {
    if (!this.routingKey) {
      return { success: false, channel: 'pagerduty', error: 'No routing key configured' };
    }

    const payload = {
      routing_key: this.routingKey,
      event_action: alert.status === 'resolved' ? 'resolve' : 'trigger',
      dedup_key: alert.ruleId || alert.id,
      payload: {
        summary: alert.message || `${alert.metric} = ${alert.value}`,
        severity: alert.severity === 'critical' ? 'critical' : alert.severity === 'warning' ? 'warning' : 'info',
        source: 'orca-system',
        component: alert.metric,
        custom_details: {
          value: alert.value,
          threshold: alert.threshold,
          rule: alert.ruleName
        }
      }
    };

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000)
      });

      return {
        success: response.ok,
        channel: 'pagerduty',
        statusCode: response.status
      };
    } catch (error) {
      return {
        success: false,
        channel: 'pagerduty',
        error: error.message
      };
    }
  }
}

/**
 * Channel registry - manages available notification channels
 */
class ChannelRegistry {
  constructor() {
    this.channels = new Map();
    // Register built-in channels
    this.register(new LogChannel());
  }

  register(channel) {
    this.channels.set(channel.name, channel);
    logger.info({ channel: channel.name }, 'Alert channel registered');
  }

  get(name) {
    return this.channels.get(name);
  }

  list() {
    return Array.from(this.channels.values()).map(ch => ({
      name: ch.name,
      enabled: ch.enabled
    }));
  }

  async dispatch(alert, channelNames) {
    const results = [];
    const names = channelNames || ['log'];

    for (const name of names) {
      const channel = this.channels.get(name);
      if (!channel) {
        results.push({ success: false, channel: name, error: 'Channel not found' });
        continue;
      }
      if (!channel.enabled) {
        results.push({ success: false, channel: name, error: 'Channel disabled' });
        continue;
      }

      try {
        const result = await channel.send(alert);
        results.push(result);
      } catch (error) {
        results.push({ success: false, channel: name, error: error.message });
      }
    }

    return results;
  }
}

let instance = null;

function getChannelRegistry() {
  if (!instance) {
    instance = new ChannelRegistry();
  }
  return instance;
}

function resetChannelRegistry() {
  instance = null;
}

module.exports = {
  AlertChannel,
  LogChannel,
  WebhookChannel,
  EmailChannel,
  PagerDutyChannel,
  ChannelRegistry,
  getChannelRegistry,
  resetChannelRegistry
};
