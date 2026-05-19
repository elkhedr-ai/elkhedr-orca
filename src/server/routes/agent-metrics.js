/**
 * T67: Agent Performance Metrics Routes
 */

const { getAgentMetrics } = require('../../agents/metrics.js');
const { getAgentLeaderboard } = require('../../agents/leaderboard.js');

async function agentMetricsRoutes(fastify, options) {
  // Get metrics for all agents
  fastify.get('/agents/metrics', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get performance metrics for all agents',
      tags: ['Agent Metrics'],
      security: [{ bearerAuth: [] }],
      response: {
        200: {
          type: 'object',
          properties: {
            metrics: { type: 'array' }
          }
        }
      }
    }
  }, async () => {
    const metrics = getAgentMetrics();
    const allMetrics = await metrics.getAllAgentMetrics();
    return { metrics: allMetrics };
  });

  // Get metrics for a specific agent
  fastify.get('/agents/:id/metrics', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get performance metrics for a specific agent',
      tags: ['Agent Metrics'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const metrics = getAgentMetrics();
    const result = await metrics.getAgentMetrics(request.params.id);
    if (!result || result.totalCalls === 0) {
      reply.code(404);
      return { error: 'Agent not found or no metrics available' };
    }
    return result;
  });

  // Get leaderboard
  fastify.get('/agents/leaderboard', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get agent performance leaderboard',
      tags: ['Agent Metrics'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          sortBy: { type: 'string', enum: ['score', 'successRate', 'latency', 'calls', 'cost'], default: 'score' },
          limit: { type: 'integer', default: 20, minimum: 1, maximum: 100 }
        }
      }
    }
  }, async (request) => {
    const leaderboard = getAgentLeaderboard();
    const results = await leaderboard.getLeaderboard({
      sortBy: request.query.sortBy || 'score',
      limit: request.query.limit || 20,
    });
    return { leaderboard: results };
  });

  // Get underperforming agents
  fastify.get('/agents/attention', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get agents needing attention (underperforming)',
      tags: ['Agent Metrics'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    const leaderboard = getAgentLeaderboard();
    const agents = await leaderboard.getAgentsNeedingAttention();
    return { agents };
  });

  // Compare two agents
  fastify.get('/agents/compare', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Compare performance of two agents',
      tags: ['Agent Metrics'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        required: ['a', 'b'],
        properties: {
          a: { type: 'string' },
          b: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { a, b } = request.query;
    if (!a || !b) {
      reply.code(400);
      return { error: 'Both "a" and "b" query parameters are required' };
    }
    const leaderboard = getAgentLeaderboard();
    return leaderboard.compareAgents(a, b);
  });

  // Get re-route history
  fastify.get('/agents/reroute-history', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get auto-re-routing decision history',
      tags: ['Agent Metrics'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 50 }
        }
      }
    }
  }, async (request) => {
    const leaderboard = getAgentLeaderboard();
    return { history: leaderboard.getRerouteHistory(request.query.limit || 50) };
  });
}

module.exports = agentMetricsRoutes;
