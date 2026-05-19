/**
 * Analytics Routes
 */

const { getDatabaseInstance } = require('../../db');

async function analyticsRoutes(fastify, options) {
  // Get analytics summary
  fastify.get('/analytics', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get analytics summary',
      tags: ['Analytics'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request, reply) => {
    const db = await getDatabaseInstance();
    const userId = request.user.role === 'admin' && request.query.all === 'true'
      ? null
      : request.user.id;

    const analytics = await db.getAnalyticsData(userId);
    const agentUsage = await db.getAgentUsageData(userId);

    return {
      analytics: {
        ...analytics,
        agentUsage
      }
    };
  });

  // Get daily analytics
  fastify.get('/analytics/daily', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get daily analytics',
      tags: ['Analytics'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 30 }
        }
      }
    }
  }, async (request, reply) => {
    const db = await getDatabaseInstance();
    const { limit = 30 } = request.query;
    const rows = await db.getDailyAnalytics(parseInt(limit, 10));
    return { daily: rows };
  });

  // Get weekly analytics
  fastify.get('/analytics/weekly', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get weekly analytics',
      tags: ['Analytics'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 12 }
        }
      }
    }
  }, async (request, reply) => {
    const db = await getDatabaseInstance();
    const { limit = 12 } = request.query;
    const rows = await db.getWeeklyAnalytics(parseInt(limit, 10));
    return { weekly: rows };
  });

  // Get monthly analytics
  fastify.get('/analytics/monthly', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get monthly analytics',
      tags: ['Analytics'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 12 }
        }
      }
    }
  }, async (request, reply) => {
    const db = await getDatabaseInstance();
    const { limit = 12 } = request.query;
    const rows = await db.getMonthlyAnalytics(parseInt(limit, 10));
    return { monthly: rows };
  });
}

module.exports = analyticsRoutes;
