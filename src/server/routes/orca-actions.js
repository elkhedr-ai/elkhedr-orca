/**
 * Orca bridge action approval contract.
 *
 * These routes expose request, approval, and result state for Studio/OS bridge
 * integrations. They do not execute actions directly.
 */

const { getActionApprovalStore, ActionContractError } = require('../../actions/approval-store.js');
const { logAudit } = require('../../audit/logger.js');

function actorFromRequest(request) {
  return {
    id: request.user?.id || 'anonymous',
    role: request.user?.role || (request.user?.apiKey ? 'api_key' : 'unknown'),
  };
}

function handleActionError(reply, error) {
  if (error instanceof ActionContractError) {
    reply.code(error.statusCode);
    return { error: error.name, message: error.message };
  }
  throw error;
}

async function auditActionTransition(action, transition, request, status = 'success') {
  await logAudit({
    eventType: 'orca_action',
    action: transition,
    status,
    userId: request.user?.id,
    userRole: request.user?.role,
    resourceType: 'orca.action',
    resourceId: action.id,
    metadata: {
      actionType: action.actionType,
      capabilityKey: action.capabilityKey,
      risk: action.risk,
      actionStatus: action.status,
      approvalRequired: action.approvalRequired,
    },
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'],
  });
}

async function orcaActionRoutes(fastify) {
  const store = getActionApprovalStore();

  fastify.get('/status', {
    schema: {
      description: 'Check Orca bridge status and action approval contract support.',
      tags: ['Orca'],
    },
  }, async () => {
    return {
      status: 'ok',
      app: 'orca',
      approvalContract: {
        actionsPath: '/api/orca/actions',
        requiresApprovalFor: ['high', 'critical', 'dangerous_capability'],
      },
    };
  });

  fastify.get('/actions', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'List Orca bridge action requests.',
      tags: ['Orca'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    return { actions: store.list({ status: request.query.status }) };
  });

  fastify.post('/actions', {
    preHandler: [fastify.requireAuth, fastify.requireScope('write')],
    schema: {
      description: 'Create an Orca action request. Dangerous actions remain pending approval.',
      tags: ['Orca'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['actionType', 'description'],
        properties: {
          actionType: { type: 'string' },
          capabilityKey: { type: 'string' },
          description: { type: 'string' },
          risk: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          params: { type: 'object' },
          sessionId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const action = store.create(request.body, { actor: actorFromRequest(request) });
      await auditActionTransition(action, 'action.requested', request);
      reply.code(201);
      return { action };
    } catch (error) {
      return handleActionError(reply, error);
    }
  });

  fastify.get('/actions/:actionId', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Read an Orca action request.',
      tags: ['Orca'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['actionId'],
        properties: { actionId: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    try {
      return { action: store.get(request.params.actionId) };
    } catch (error) {
      return handleActionError(reply, error);
    }
  });

  fastify.post('/actions/:actionId/approval', {
    preHandler: [fastify.requireAuth, fastify.requireScope('write')],
    schema: {
      description: 'Approve or reject a pending Orca action request.',
      tags: ['Orca'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['actionId'],
        properties: { actionId: { type: 'string' } },
      },
      body: {
        type: 'object',
        required: ['decision'],
        properties: {
          decision: { type: 'string', enum: ['approved', 'rejected'] },
          reason: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const action = store.decide(request.params.actionId, request.body, {
        actor: actorFromRequest(request),
      });
      await auditActionTransition(action, `action.${request.body.decision}`, request);
      return { action };
    } catch (error) {
      return handleActionError(reply, error);
    }
  });

  fastify.post('/actions/:actionId/result', {
    preHandler: [fastify.requireAuth, fastify.requireScope('write')],
    schema: {
      description: 'Attach a result to an approved Orca action request.',
      tags: ['Orca'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['actionId'],
        properties: { actionId: { type: 'string' } },
      },
      body: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['success', 'failure', 'canceled'] },
          summary: { type: 'string' },
          artifacts: {
            type: 'array',
            items: { type: 'object' },
          },
          metadata: { type: 'object' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const action = store.attachResult(request.params.actionId, request.body, {
        actor: actorFromRequest(request),
      });
      const auditStatus = action.result.status === 'failure' ? 'failure' : 'success';
      await auditActionTransition(action, 'action.result', request, auditStatus);
      return { action };
    } catch (error) {
      return handleActionError(reply, error);
    }
  });
}

module.exports = orcaActionRoutes;
