/**
 * Webhook Routes
 * CRUD for webhook subscriptions and delivery history.
 */

const { getWebhookManager } = require('../../webhooks/index.js');

async function webhookRoutes(fastify, options) {
  // List webhooks for current user
  fastify.get('/webhooks', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'List webhooks for the current user',
      tags: ['Webhooks'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request) => {
    const manager = getWebhookManager();
    const webhooks = await manager.listWebhooks(request.user.id);
    return { webhooks };
  });

  // Create a webhook
  fastify.post('/webhooks', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Create a new webhook subscription',
      tags: ['Webhooks'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['url', 'events'],
        properties: {
          url: { type: 'string', format: 'uri' },
          events: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1
          },
          description: { type: 'string' },
          headers: { type: 'object' },
          maxRetries: { type: 'integer', minimum: 0, maximum: 10 }
        }
      }
    }
  }, async (request, reply) => {
    const manager = getWebhookManager();
    const webhook = await manager.createWebhook(request.user.id, request.body);
    reply.code(201);
    return { webhook };
  });

  // Get a specific webhook
  fastify.get('/webhooks/:webhookId', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get a webhook by ID',
      tags: ['Webhooks'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          webhookId: { type: 'integer' }
        },
        required: ['webhookId']
      }
    }
  }, async (request, reply) => {
    const manager = getWebhookManager();
    const webhook = await manager.getWebhook(request.params.webhookId, request.user.id);
    if (!webhook) {
      reply.code(404).send({ error: 'NotFound', message: 'Webhook not found' });
      return;
    }
    return { webhook };
  });

  // Update a webhook
  fastify.patch('/webhooks/:webhookId', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Update a webhook subscription',
      tags: ['Webhooks'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          webhookId: { type: 'integer' }
        },
        required: ['webhookId']
      },
      body: {
        type: 'object',
        properties: {
          url: { type: 'string', format: 'uri' },
          events: { type: 'array', items: { type: 'string' } },
          active: { type: 'boolean' },
          description: { type: 'string' },
          headers: { type: 'object' },
          maxRetries: { type: 'integer', minimum: 0, maximum: 10 }
        }
      }
    }
  }, async (request, reply) => {
    const manager = getWebhookManager();
    const webhook = await manager.updateWebhook(request.params.webhookId, request.user.id, request.body);
    if (!webhook) {
      reply.code(404).send({ error: 'NotFound', message: 'Webhook not found' });
      return;
    }
    return { webhook };
  });

  // Delete a webhook
  fastify.delete('/webhooks/:webhookId', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Delete a webhook subscription',
      tags: ['Webhooks'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          webhookId: { type: 'integer' }
        },
        required: ['webhookId']
      }
    }
  }, async (request, reply) => {
    const manager = getWebhookManager();
    const deleted = await manager.deleteWebhook(request.params.webhookId, request.user.id);
    if (!deleted) {
      reply.code(404).send({ error: 'NotFound', message: 'Webhook not found' });
      return;
    }
    return { deleted: true };
  });

  // Get delivery history for a webhook
  fastify.get('/webhooks/:webhookId/deliveries', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get delivery history for a webhook',
      tags: ['Webhooks'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          webhookId: { type: 'integer' }
        },
        required: ['webhookId']
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 }
        }
      }
    }
  }, async (request, reply) => {
    const manager = getWebhookManager();
    const deliveries = await manager.getDeliveries(
      request.params.webhookId,
      request.user.id,
      { limit: request.query.limit, offset: request.query.offset }
    );
    if (deliveries === null) {
      reply.code(404).send({ error: 'NotFound', message: 'Webhook not found' });
      return;
    }
    return { deliveries };
  });

  // Get webhook stats
  fastify.get('/webhooks/stats', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get webhook delivery statistics',
      tags: ['Webhooks'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request) => {
    const manager = getWebhookManager();
    const stats = await manager.getStats(request.user.id);
    return { stats };
  });
}

module.exports = webhookRoutes;
