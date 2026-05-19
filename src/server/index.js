/**
 * Fastify API Server
 * REST API for Orca with OpenAPI documentation, rate limiting, and auth.
 */

const Fastify = require('fastify');
const { logger } = require('../utils/logger.js');
const { verifyAccessToken } = require('../auth/jwt.js');
const { validateApiKey, hasScope } = require('../auth/api-keys.js');
const { getUserContext } = require('../auth/context.js');
const { getSecurityHeaders } = require('../crypto/tls.js');

async function buildServer(options = {}) {
  const fastify = Fastify({
    logger: false, // Use our own logger
    trustProxy: true,
    ...options.fastifyOptions
  });

  // Register plugins
  await fastify.register(require('@fastify/cors'), {
    origin: process.env.ORCA_CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
  });

  await fastify.register(require('@fastify/helmet'), {
    contentSecurityPolicy: false
  });

  // Rate limiting
  await fastify.register(require('@fastify/rate-limit'), {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (req) => {
      return req.user?.id || req.headers['x-api-key'] || req.ip;
    }
  });

  // Swagger/OpenAPI documentation
  await fastify.register(require('@fastify/swagger'), {
    openapi: {
      info: {
        title: 'Orca API',
        description: 'Multi-Agent Orchestration System API',
        version: '1.1.0'
      },
      servers: [{ url: '/api/v1' }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT'
          },
          apiKeyAuth: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key'
          }
        }
      }
    }
  });

  await fastify.register(require('@fastify/swagger-ui'), {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false
    }
  });

  // Authentication hook
  fastify.addHook('onRequest', async (request, reply) => {
    // Try JWT first
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const decoded = verifyAccessToken(token);
      if (decoded) {
        request.user = { id: decoded.userId, role: decoded.role };
        return;
      }
    }

    // Try API key
    const apiKey = request.headers['x-api-key'];
    if (apiKey) {
      const keyData = await validateApiKey(apiKey);
      if (keyData) {
        request.user = { id: keyData.userId, apiKey: true, scopes: keyData.scopes };
        return;
      }
    }

    // Public routes don't need auth
    const publicRoutes = ['/api/v1/auth/login', '/api/v1/auth/register', '/health', '/docs', '/docs/*'];
    if (publicRoutes.some(route => request.url.startsWith(route.replace('*', '')))) {
      return;
    }
  });

  // Authorization helper
  fastify.decorate('requireAuth', async (request, reply) => {
    if (!request.user) {
      reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required' });
      return;
    }
  });

  fastify.decorate('requireScope', (scope) => {
    return async (request, reply) => {
      if (!request.user) {
        reply.code(401).send({ error: 'Unauthorized', message: 'Authentication required' });
        return;
      }
      if (request.user.scopes && !hasScope(request.user.scopes, scope)) {
        reply.code(403).send({ error: 'Forbidden', message: `Scope '${scope}' required` });
        return;
      }
    };
  });

  // Security headers
  fastify.addHook('onSend', async (request, reply, payload) => {
    const headers = getSecurityHeaders();
    for (const [key, value] of Object.entries(headers)) {
      reply.header(key, value);
    }
    return payload;
  });

  // Register routes
  fastify.register(require('./routes/health.js'), { prefix: '' });
  fastify.register(require('./routes/agents.js'), { prefix: '/api/v1' });
  fastify.register(require('./routes/sessions.js'), { prefix: '/api/v1' });
  fastify.register(require('./routes/analytics.js'), { prefix: '/api/v1' });
  fastify.register(require('./routes/users.js'), { prefix: '/api/v1' });
  fastify.register(require('./routes/skills.js'), { prefix: '/api/v1' });
  fastify.register(require('./routes/billing.js'), { prefix: '/api/v1' });

  // Error handler
  fastify.setErrorHandler((error, request, reply) => {
    logger.error({
      error: error.message,
      url: request.url,
      method: request.method
    }, 'API error');

    reply.code(error.statusCode || 500).send({
      error: error.name || 'InternalServerError',
      message: error.message || 'Internal server error',
      ...(process.env.NODE_ENV === 'development' ? { stack: error.stack } : {})
    });
  });

  // Not found handler
  fastify.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: 'NotFound',
      message: `Route ${request.method} ${request.url} not found`
    });
  });

  return fastify;
}

async function startServer(options = {}) {
  const port = options.port || parseInt(process.env.ORCA_PORT, 10) || 3000;
  const host = options.host || process.env.ORCA_HOST || '0.0.0.0';

  const fastify = await buildServer(options);

  try {
    await fastify.listen({ port, host });
    logger.info({ port, host }, 'API server started');

    // Initialize collaboration server (WebSocket) on same HTTP server
    if (options.collaboration !== false) {
      const { CollaborationServer } = require('./collab.js');
      const collabServer = new CollaborationServer(fastify.server);
      logger.info('Collaboration server initialized');
      fastify.collabServer = collabServer;
    }

    return fastify;
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to start API server');
    throw error;
  }
}

module.exports = {
  buildServer,
  startServer
};
