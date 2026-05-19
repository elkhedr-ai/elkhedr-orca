/**
 * Health Check Endpoints
 * /health - liveness check
 * /ready - readiness check (verifies dependencies)
 */

const os = require('os');
const { logger } = require('../utils/logger.js');

const startTime = Date.now();

async function healthRoutes(fastify, options) {
  // Liveness probe - always returns 200 if process is running
  fastify.get('/health', {
    schema: {
      description: 'Liveness probe - returns 200 if the service is running',
      tags: ['Health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            version: { type: 'string' },
            uptime: { type: 'number' },
            timestamp: { type: 'string' }
          }
        }
      }
    }
  }, async () => {
    return {
      status: 'ok',
      version: require('../../package.json').version,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      timestamp: new Date().toISOString()
    };
  });

  // Readiness probe - checks if dependencies are available
  fastify.get('/ready', {
    schema: {
      description: 'Readiness probe - returns 200 if the service is ready to accept requests',
      tags: ['Health'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            checks: { type: 'object' }
          }
        },
        503: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            checks: { type: 'object' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const checks = {};
    let ready = true;

    // Check database
    try {
      const { getDatabaseInstance } = require('../db');
      const db = await getDatabaseInstance();
      const adapter = db.getAdapter();
      await adapter.execute('SELECT 1');
      checks.database = { status: 'ok' };
    } catch (error) {
      checks.database = { status: 'error', error: error.message };
      ready = false;
    }

    // Check memory usage
    const memUsage = process.memoryUsage();
    const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    checks.memory = {
      status: heapUsedPercent > 90 ? 'warning' : 'ok',
      heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
      rssUsedMB: Math.round(memUsage.rss / 1024 / 1024)
    };

    // Check disk space (simplified)
    checks.disk = {
      status: 'ok',
      tmpDir: os.tmpdir()
    };

    // Check event loop lag (simplified)
    const loopStart = Date.now();
    await new Promise(resolve => setImmediate(resolve));
    const loopLag = Date.now() - loopStart;
    checks.eventLoop = {
      status: loopLag > 100 ? 'warning' : 'ok',
      lagMs: loopLag
    };

    if (!ready) {
      reply.code(503);
    }

    return {
      status: ready ? 'ready' : 'not_ready',
      checks
    };
  });
}

module.exports = healthRoutes;
