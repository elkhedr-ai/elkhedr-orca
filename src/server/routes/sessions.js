/**
 * Session Routes
 */

const { getDatabaseInstance } = require('../../db');
const { requirePermission } = require('../../auth/rbac.js');

async function sessionRoutes(fastify, options) {
  // List sessions
  fastify.get('/sessions', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'List user sessions',
      tags: ['Sessions'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 50 },
          offset: { type: 'integer', default: 0 }
        }
      }
    }
  }, async (request, reply) => {
    const db = await getDatabaseInstance();
    const userId = request.user.id;
    const { limit = 50, offset = 0 } = request.query;

    const rows = await db.getAdapter().query(
      `SELECT id, prompt, mode, agent, result, tokens, created_at, traceId
       FROM sessions
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, parseInt(limit, 10), parseInt(offset, 10)]
    );

    return { sessions: rows };
  });

  // Create session
  fastify.post('/sessions', {
    preHandler: [fastify.requireAuth, fastify.requireScope('write')],
    schema: {
      description: 'Create a new session',
      tags: ['Sessions'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['prompt', 'mode', 'agent', 'result'],
        properties: {
          prompt: { type: 'string' },
          mode: { type: 'string' },
          agent: { type: 'string' },
          result: { type: 'string' },
          tokens: { type: 'integer' }
        }
      }
    }
  }, async (request, reply) => {
    const db = await getDatabaseInstance();
    const { prompt, mode, agent, result, tokens = 0 } = request.body;

    const insertResult = await db.getAdapter().execute(
      'INSERT INTO sessions (user_id, prompt, mode, agent, result, tokens) VALUES (?, ?, ?, ?, ?, ?)',
      [request.user.id, prompt, mode, agent, result, tokens]
    );

    reply.code(201);
    return {
      session: {
        id: insertResult.lastInsertRowid,
        prompt,
        mode,
        agent,
        result,
        tokens
      }
    };
  });

  // Get session by ID
  fastify.get('/sessions/:id', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get session details',
      tags: ['Sessions'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request, reply) => {
    const db = await getDatabaseInstance();
    const rows = await db.getAdapter().query(
      'SELECT * FROM sessions WHERE id = ? AND user_id = ?',
      [request.params.id, request.user.id]
    );

    if (rows.length === 0) {
      reply.code(404);
      return { error: 'Session not found' };
    }

    return { session: rows[0] };
  });

  // Delete session
  fastify.delete('/sessions/:id', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Delete a session',
      tags: ['Sessions'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request, reply) => {
    const db = await getDatabaseInstance();
    const result = await db.getAdapter().execute(
      'DELETE FROM sessions WHERE id = ? AND user_id = ?',
      [request.params.id, request.user.id]
    );

    if (result.changes === 0) {
      reply.code(404);
      return { error: 'Session not found' };
    }

    return { deleted: true };
  });
}

module.exports = sessionRoutes;
