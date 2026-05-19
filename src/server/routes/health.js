/**
 * Health Routes
 */

async function healthRoutes(fastify, options) {
  fastify.get('/health', {
    schema: {
      description: 'Health check endpoint',
      tags: ['Health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            uptime: { type: 'number' },
            timestamp: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    };
  });

  fastify.get('/ready', {
    schema: {
      description: 'Readiness check',
      tags: ['Health'],
      response: {
        200: {
          type: 'object',
          properties: {
            ready: { type: 'boolean' }
          }
        }
      }
    }
  }, async (request, reply) => {
    // Check database connectivity
    try {
      const { getDatabaseInstance } = require('../../db');
      const db = getDatabaseInstance();
      if (db.isConnected()) {
        return { ready: true };
      }
    } catch {
      // Not ready
    }
    reply.code(503).send({ ready: false });
  });
}

module.exports = healthRoutes;
