/**
 * Billing & Quota Routes
 */

const { getQuotaManager } = require('../../billing/quotas.js');

async function billingRoutes(fastify, options) {
  // Get current user's quota
  fastify.get('/billing/quotas/me', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get current user quota and usage',
      tags: ['Billing'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request) => {
    const quotaManager = getQuotaManager();
    const quota = await quotaManager.getUserQuota(request.user.id);
    const warning = await quotaManager.getWarning(request.user.id);
    return { quota, warning };
  });

  // Get any user's quota (admin only)
  fastify.get('/billing/quotas/:userId', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get quota for a specific user (admin only)',
      tags: ['Billing'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          userId: { type: 'integer' }
        },
        required: ['userId']
      }
    }
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      reply.code(403).send({ error: 'Forbidden', message: 'Admin access required' });
      return;
    }
    const quotaManager = getQuotaManager();
    const quota = await quotaManager.getUserQuota(request.params.userId);
    return { quota };
  });

  // Update quota limits (admin only)
  fastify.patch('/billing/quotas/:userId', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Update quota limits for a user (admin only)',
      tags: ['Billing'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          userId: { type: 'integer' }
        },
        required: ['userId']
      },
      body: {
        type: 'object',
        properties: {
          tokensLimit: { type: 'integer' },
          operationsLimit: { type: 'integer' },
          costLimit: { type: 'number' }
        }
      }
    }
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      reply.code(403).send({ error: 'Forbidden', message: 'Admin access required' });
      return;
    }
    const quotaManager = getQuotaManager();
    const quota = await quotaManager.getUserQuota(request.params.userId);
    const result = await quotaManager.updateQuota(quota.id, request.body);
    return result;
  });

  // Reset quota usage (admin only)
  fastify.post('/billing/quotas/:userId/reset', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Reset usage counters for a user (admin only)',
      tags: ['Billing'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          userId: { type: 'integer' }
        },
        required: ['userId']
      }
    }
  }, async (request, reply) => {
    if (request.user.role !== 'admin') {
      reply.code(403).send({ error: 'Forbidden', message: 'Admin access required' });
      return;
    }
    const quotaManager = getQuotaManager();
    const quota = await quotaManager.getUserQuota(request.params.userId);
    const result = await quotaManager.resetQuota(quota.id);
    return result;
  });

  // Get current user's usage history
  fastify.get('/billing/usage/me', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get usage history for current user',
      tags: ['Billing'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          days: { type: 'integer', default: 30 }
        }
      }
    }
  }, async (request) => {
    const quotaManager = getQuotaManager();
    const days = parseInt(request.query.days, 10) || 30;
    const usage = await quotaManager.getUsageStats(request.user.id, days);
    return { usage, days };
  });
}

module.exports = billingRoutes;
