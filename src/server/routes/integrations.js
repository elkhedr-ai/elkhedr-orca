/**
 * Integration Routes
 * CRUD for third-party integration connections and actions.
 */

const { getIntegrationManager } = require('../../integrations/index.js');

async function integrationRoutes(fastify, options) {
  // List available providers
  fastify.get('/integrations/providers', {
    schema: {
      description: 'List supported integration providers',
      tags: ['Integrations']
    }
  }, async () => {
    const manager = getIntegrationManager();
    return { providers: manager.listProviders() };
  });

  // List user's integrations
  fastify.get('/integrations', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'List user integrations',
      tags: ['Integrations'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request) => {
    const manager = getIntegrationManager();
    const integrations = await manager.listIntegrations(request.user.id);
    return { integrations };
  });

  // Register an integration
  fastify.post('/integrations', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Register a new integration',
      tags: ['Integrations'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['provider', 'credentials'],
        properties: {
          provider: { type: 'string', enum: ['slack', 'discord', 'github', 'jira', 'notion'] },
          name: { type: 'string' },
          credentials: { type: 'object' },
          config: { type: 'object' }
        }
      }
    }
  }, async (request, reply) => {
    const manager = getIntegrationManager();
    try {
      const integration = await manager.registerIntegration(request.user.id, request.body);
      reply.code(201);
      return { integration };
    } catch (error) {
      reply.code(400);
      return { error: 'BadRequest', message: error.message };
    }
  });

  // Get a specific integration
  fastify.get('/integrations/:integrationId', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get an integration by ID',
      tags: ['Integrations'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { integrationId: { type: 'integer' } },
        required: ['integrationId']
      }
    }
  }, async (request, reply) => {
    const manager = getIntegrationManager();
    const integration = await manager.getIntegration(request.params.integrationId, request.user.id);
    if (!integration) {
      reply.code(404).send({ error: 'NotFound', message: 'Integration not found' });
      return;
    }
    return { integration };
  });

  // Update an integration
  fastify.patch('/integrations/:integrationId', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Update an integration',
      tags: ['Integrations'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { integrationId: { type: 'integer' } },
        required: ['integrationId']
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          credentials: { type: 'object' },
          config: { type: 'object' },
          active: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const manager = getIntegrationManager();
    const integration = await manager.updateIntegration(
      request.params.integrationId,
      request.user.id,
      request.body
    );
    if (!integration) {
      reply.code(404).send({ error: 'NotFound', message: 'Integration not found' });
      return;
    }
    return { integration };
  });

  // Delete an integration
  fastify.delete('/integrations/:integrationId', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Delete an integration',
      tags: ['Integrations'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { integrationId: { type: 'integer' } },
        required: ['integrationId']
      }
    }
  }, async (request, reply) => {
    const manager = getIntegrationManager();
    const deleted = await manager.deleteIntegration(request.params.integrationId, request.user.id);
    if (!deleted) {
      reply.code(404).send({ error: 'NotFound', message: 'Integration not found' });
      return;
    }
    return { deleted: true };
  });

  // Test an integration connection
  fastify.post('/integrations/:integrationId/test', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Test an integration connection',
      tags: ['Integrations'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { integrationId: { type: 'integer' } },
        required: ['integrationId']
      }
    }
  }, async (request, reply) => {
    const manager = getIntegrationManager();
    const result = await manager.testIntegration(request.params.integrationId, request.user.id);
    if (!result.success && result.error === 'Integration not found') {
      reply.code(404).send({ error: 'NotFound', message: result.error });
      return;
    }
    return result;
  });

  // Execute an action on an integration
  fastify.post('/integrations/:integrationId/actions', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Execute an action on an integration',
      tags: ['Integrations'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { integrationId: { type: 'integer' } },
        required: ['integrationId']
      },
      body: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['sendMessage', 'createIssue', 'updateIssue', 'listTargets'] },
          params: { type: 'object' }
        }
      }
    }
  }, async (request, reply) => {
    const manager = getIntegrationManager();
    const result = await manager.executeAction(
      request.params.integrationId,
      request.user.id,
      request.body.action,
      request.body.params || {}
    );
    if (!result.success && result.error === 'Integration not found') {
      reply.code(404).send({ error: 'NotFound', message: result.error });
      return;
    }
    return result;
  });

  // Get integration logs
  fastify.get('/integrations/:integrationId/logs', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get integration action logs',
      tags: ['Integrations'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { integrationId: { type: 'integer' } },
        required: ['integrationId']
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 }
        }
      }
    }
  }, async (request, reply) => {
    const manager = getIntegrationManager();
    const logs = await manager.getLogs(
      request.params.integrationId,
      request.user.id,
      { limit: request.query.limit }
    );
    if (logs === null) {
      reply.code(404).send({ error: 'NotFound', message: 'Integration not found' });
      return;
    }
    return { logs };
  });
}

module.exports = integrationRoutes;
