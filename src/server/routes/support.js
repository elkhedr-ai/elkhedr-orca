/**
 * Support Routes
 * Ticket management, SLA monitoring, and escalation.
 */

const { getSLAManager, SLA_TIERS, TICKET_STATUS, TICKET_PRIORITY } = require('../../support/sla.js');
const { getEscalationManager } = require('../../support/escalation.js');

async function supportRoutes(fastify, options) {

  // List tickets
  fastify.get('/support/tickets', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'List support tickets',
      tags: ['Support'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: Object.values(TICKET_STATUS) },
          priority: { type: 'string', enum: Object.values(TICKET_PRIORITY) },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 }
        }
      }
    }
  }, async (request) => {
    const manager = getSLAManager();
    const tickets = await manager.listTickets({
      userId: request.user.id,
      status: request.query.status,
      priority: request.query.priority,
      limit: request.query.limit
    });
    return { tickets };
  });

  // Create a ticket
  fastify.post('/support/tickets', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Create a support ticket',
      tags: ['Support'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['subject'],
        properties: {
          subject: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', enum: Object.values(TICKET_PRIORITY) },
          category: { type: 'string' },
          slaTier: { type: 'string', enum: ['basic', 'pro', 'enterprise'] },
          orgId: { type: 'integer' }
        }
      }
    }
  }, async (request, reply) => {
    const manager = getSLAManager();
    const ticket = await manager.createTicket(request.user.id, request.body);
    reply.code(201);
    return { ticket };
  });

  // Get a specific ticket
  fastify.get('/support/tickets/:ticketId', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get a support ticket',
      tags: ['Support'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { ticketId: { type: 'integer' } },
        required: ['ticketId']
      }
    }
  }, async (request, reply) => {
    const manager = getSLAManager();
    const ticket = await manager.getTicket(request.params.ticketId);
    if (!ticket) {
      reply.code(404).send({ error: 'NotFound', message: 'Ticket not found' });
      return;
    }
    return { ticket };
  });

  // Update a ticket
  fastify.patch('/support/tickets/:ticketId', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Update a support ticket',
      tags: ['Support'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { ticketId: { type: 'integer' } },
        required: ['ticketId']
      },
      body: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: Object.values(TICKET_STATUS) },
          priority: { type: 'string', enum: Object.values(TICKET_PRIORITY) },
          assignedTo: { type: 'string' },
          category: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const manager = getSLAManager();
    const ticket = await manager.updateTicket(request.params.ticketId, request.body);
    if (!ticket) {
      reply.code(404).send({ error: 'NotFound', message: 'Ticket not found' });
      return;
    }
    return { ticket };
  });

  // Add comment to ticket
  fastify.post('/support/tickets/:ticketId/comments', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Add a comment to a ticket',
      tags: ['Support'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { ticketId: { type: 'integer' } },
        required: ['ticketId']
      },
      body: {
        type: 'object',
        required: ['content'],
        properties: {
          content: { type: 'string' },
          isInternal: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const manager = getSLAManager();
    const comment = await manager.addComment(
      request.params.ticketId,
      request.user.id,
      request.body.content,
      request.body.isInternal
    );
    reply.code(201);
    return { comment };
  });

  // Get ticket comments
  fastify.get('/support/tickets/:ticketId/comments', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get comments for a ticket',
      tags: ['Support'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { ticketId: { type: 'integer' } },
        required: ['ticketId']
      }
    }
  }, async (request, reply) => {
    const manager = getSLAManager();
    const comments = await manager.getComments(request.params.ticketId);
    return { comments };
  });

  // Escalate a ticket
  fastify.post('/support/tickets/:ticketId/escalate', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Escalate a support ticket',
      tags: ['Support'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { ticketId: { type: 'integer' } },
        required: ['ticketId']
      },
      body: {
        type: 'object',
        required: ['reason'],
        properties: {
          reason: { type: 'string' },
          targetLevel: { type: 'integer', minimum: 1, maximum: 3 }
        }
      }
    }
  }, async (request, reply) => {
    const manager = getEscalationManager();
    const result = await manager.escalateTicket(
      request.params.ticketId,
      request.user.id,
      request.body.reason,
      request.body.targetLevel
    );
    if (!result.success) {
      reply.code(400).send({ error: 'BadRequest', message: result.error });
      return;
    }
    return result;
  });

  // Get escalation history
  fastify.get('/support/tickets/:ticketId/escalations', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get escalation history for a ticket',
      tags: ['Support'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { ticketId: { type: 'integer' } },
        required: ['ticketId']
      }
    }
  }, async (request) => {
    const manager = getEscalationManager();
    const history = await manager.getEscalationHistory(request.params.ticketId);
    return { escalations: history };
  });

  // Run SLA violation check
  fastify.post('/support/sla/check', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Run SLA violation check',
      tags: ['Support'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    const manager = getSLAManager();
    const result = await manager.checkSLAViolations();
    return result;
  });

  // Run escalation processing
  fastify.post('/support/escalations/process', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Process automatic escalations',
      tags: ['Support'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    const manager = getEscalationManager();
    const result = await manager.processEscalations();
    return result;
  });

  // Get support stats
  fastify.get('/support/stats', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get support ticket statistics',
      tags: ['Support'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          orgId: { type: 'integer' }
        }
      }
    }
  }, async (request) => {
    const manager = getSLAManager();
    const stats = await manager.getStats(request.query.orgId || 0);
    return { stats };
  });

  // List SLA tiers
  fastify.get('/support/sla/tiers', {
    schema: {
      description: 'List available SLA tiers',
      tags: ['Support']
    }
  }, async () => {
    return { tiers: Object.values(SLA_TIERS) };
  });
}

module.exports = supportRoutes;
