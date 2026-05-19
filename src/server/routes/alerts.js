/**
 * Alert Routes
 * Alert rules management, history, and channel configuration.
 */

const { AlertManager } = require('../../alerts/rules.js');
const { getChannelRegistry } = require('../../alerts/channels.js');

// Singleton alert manager
let alertManager = null;

function getAlertManager() {
  if (!alertManager) {
    alertManager = new AlertManager();
    alertManager.setupDefaultRules();
  }
  return alertManager;
}

async function alertRoutes(fastify, options) {
  // Get all alert rules
  fastify.get('/alerts/rules', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'List all alert rules',
      tags: ['Alerts'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    const manager = getAlertManager();
    const rules = [];
    for (const rule of manager.rules.values()) {
      rules.push({
        id: rule.id,
        name: rule.name,
        metric: rule.metric,
        condition: rule.condition,
        threshold: rule.threshold,
        severity: rule.severity,
        channels: rule.channels,
        cooldown: rule.cooldown,
        active: rule.active
      });
    }
    return { rules };
  });

  // Update an alert rule
  fastify.patch('/alerts/rules/:ruleId', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Update an alert rule',
      tags: ['Alerts'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { ruleId: { type: 'string' } },
        required: ['ruleId']
      },
      body: {
        type: 'object',
        properties: {
          threshold: { type: 'number' },
          severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
          channels: { type: 'array', items: { type: 'string' } },
          cooldown: { type: 'integer' }
        }
      }
    }
  }, async (request, reply) => {
    const manager = getAlertManager();
    const rule = manager.rules.get(request.params.ruleId);
    if (!rule) {
      reply.code(404).send({ error: 'NotFound', message: 'Alert rule not found' });
      return;
    }

    const updates = request.body;
    if (updates.threshold !== undefined) rule.threshold = updates.threshold;
    if (updates.severity !== undefined) rule.severity = updates.severity;
    if (updates.channels !== undefined) rule.channels = updates.channels;
    if (updates.cooldown !== undefined) rule.cooldown = updates.cooldown;

    return { rule };
  });

  // Get alert history
  fastify.get('/alerts/history', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get alert history',
      tags: ['Alerts'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
          status: { type: 'string', enum: ['firing', 'resolved'] },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 }
        }
      }
    }
  }, async (request) => {
    const manager = getAlertManager();
    const alerts = manager.getHistory({
      severity: request.query.severity,
      status: request.query.status,
      limit: request.query.limit
    });
    return { alerts };
  });

  // Get active (firing) alerts
  fastify.get('/alerts/active', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get active (firing) alerts',
      tags: ['Alerts'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    const manager = getAlertManager();
    return { alerts: manager.getActiveAlerts() };
  });

  // Manually trigger evaluation
  fastify.post('/alerts/evaluate', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Manually trigger alert evaluation',
      tags: ['Alerts'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    const manager = getAlertManager();
    manager.evaluate();
    return { evaluated: true };
  });

  // List notification channels
  fastify.get('/alerts/channels', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'List alert notification channels',
      tags: ['Alerts'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    const registry = getChannelRegistry();
    return { channels: registry.list() };
  });

  // Register a webhook channel
  fastify.post('/alerts/channels', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Register a notification channel',
      tags: ['Alerts'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name', 'type'],
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: ['webhook', 'email', 'pagerduty'] },
          url: { type: 'string' },
          to: { type: 'array', items: { type: 'string' } },
          routingKey: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const registry = getChannelRegistry();
    const { WebhookChannel, EmailChannel, PagerDutyChannel } = require('../../alerts/channels.js');

    let channel;
    switch (request.body.type) {
      case 'webhook':
        channel = new WebhookChannel({ name: request.body.name, url: request.body.url });
        break;
      case 'email':
        channel = new EmailChannel({ name: request.body.name, to: request.body.to });
        break;
      case 'pagerduty':
        channel = new PagerDutyChannel({ name: request.body.name, routingKey: request.body.routingKey });
        break;
      default:
        reply.code(400).send({ error: 'BadRequest', message: 'Unknown channel type' });
        return;
    }

    registry.register(channel);
    reply.code(201);
    return { channel: { name: channel.name, enabled: channel.enabled } };
  });
}

module.exports = alertRoutes;
