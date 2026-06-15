/**
 * Orca contract change request bridge routes.
 *
 * Exposes the lifecycle for proposing, reviewing, and completing contract
 * change requests. Contract changes are high-risk actions, so every request
 * is routed through the action approval store and requires explicit approval.
 */

const {
  ContractChangeRequestError,
  CONTRACT_TYPES,
  CHANGE_TYPES,
  APP_IDS,
  createContractChangeRequest,
  decideContractChangeRequest,
  completeContractChangeRequest,
  getContractChangeRequest,
  listContractChangeRequests,
} = require('../../contracts/change-request.js');
const { logAudit } = require('../../audit/logger.js');

function actorFromRequest(request) {
  return {
    id: request.user?.id || 'anonymous',
    role: request.user?.role || (request.user?.apiKey ? 'api_key' : 'unknown'),
  };
}

function handleContractError(reply, error) {
  if (error instanceof ContractChangeRequestError) {
    reply.code(error.statusCode);
    return { error: error.name, message: error.message };
  }
  throw error;
}

async function auditContractTransition(action, transition, request, status = 'success') {
  await logAudit({
    eventType: 'orca_contract_change',
    action: transition,
    status,
    userId: request.user?.id,
    userRole: request.user?.role,
    resourceType: 'orca.contract_change_request',
    resourceId: action.id,
    metadata: {
      contractType: action.params?.contractType,
      changeType: action.params?.changeType,
      target: action.params?.target,
      appId: action.params?.appId,
      actionStatus: action.status,
      approvalRequired: action.approvalRequired,
    },
    ipAddress: request.ip,
    userAgent: request.headers['user-agent'],
  });
}

async function orcaContractRoutes(fastify) {
  fastify.get('/contracts/change-requests', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'List Orca contract change requests.',
      tags: ['Orca Contracts'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string' },
        },
      },
    },
  }, async (request) => {
    return { requests: listContractChangeRequests({ status: request.query.status }) };
  });

  fastify.post('/contracts/change-requests', {
    preHandler: [fastify.requireAuth, fastify.requireScope('write')],
    schema: {
      description: 'Create a contract change request. Requires approval because contract changes are high-risk.',
      tags: ['Orca Contracts'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['contractType', 'changeType', 'target', 'description'],
        properties: {
          contractType: { type: 'string', enum: Array.from(CONTRACT_TYPES) },
          changeType: { type: 'string', enum: Array.from(CHANGE_TYPES) },
          target: { type: 'string' },
          description: { type: 'string' },
          proposedValue: {},
          appId: { type: 'string', enum: Array.from(APP_IDS) },
          reason: { type: 'string' },
          sessionId: { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const action = createContractChangeRequest(request.body, {
        actor: actorFromRequest(request),
        sessionId: request.body.sessionId,
      });
      await auditContractTransition(action, 'contract_change.requested', request);
      reply.code(201);
      return { request: action };
    } catch (error) {
      return handleContractError(reply, error);
    }
  });

  fastify.get('/contracts/change-requests/:requestId', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Read a contract change request.',
      tags: ['Orca Contracts'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['requestId'],
        properties: { requestId: { type: 'string' } },
      },
    },
  }, async (request, reply) => {
    try {
      return { request: getContractChangeRequest(request.params.requestId) };
    } catch (error) {
      return handleContractError(reply, error);
    }
  });

  fastify.post('/contracts/change-requests/:requestId/approval', {
    preHandler: [fastify.requireAuth, fastify.requireScope('write')],
    schema: {
      description: 'Approve or reject a pending contract change request.',
      tags: ['Orca Contracts'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['requestId'],
        properties: { requestId: { type: 'string' } },
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
      const action = decideContractChangeRequest(
        request.params.requestId,
        request.body,
        { actor: actorFromRequest(request) }
      );
      await auditContractTransition(action, `contract_change.${request.body.decision}`, request);
      return { request: action };
    } catch (error) {
      return handleContractError(reply, error);
    }
  });

  fastify.post('/contracts/change-requests/:requestId/result', {
    preHandler: [fastify.requireAuth, fastify.requireScope('write')],
    schema: {
      description: 'Attach a result to an approved contract change request.',
      tags: ['Orca Contracts'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        required: ['requestId'],
        properties: { requestId: { type: 'string' } },
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
      const action = completeContractChangeRequest(
        request.params.requestId,
        request.body,
        { actor: actorFromRequest(request) }
      );
      const auditStatus = action.result?.status === 'failure' ? 'failure' : 'success';
      await auditContractTransition(action, 'contract_change.result', request, auditStatus);
      return { request: action };
    } catch (error) {
      return handleContractError(reply, error);
    }
  });
}

module.exports = orcaContractRoutes;
