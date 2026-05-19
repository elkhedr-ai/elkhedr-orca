/**
 * Agent Routes
 */

const { getDatabaseInstance } = require('../../db');
const { requirePermission } = require('../../auth/rbac.js');

async function agentRoutes(fastify, options) {
  // Get all agents
  fastify.get('/agents', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'List all agents',
      tags: ['Agents'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          department: { type: 'string' },
          limit: { type: 'integer', default: 50 },
          offset: { type: 'integer', default: 0 }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            agents: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'integer' },
                  name: { type: 'string' },
                  role: { type: 'string' },
                  model: { type: 'string' },
                  department: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const db = await getDatabaseInstance();
    const { department, limit = 50, offset = 0 } = request.query;

    let sql = 'SELECT id, name, role, model, department FROM agents';
    const params = [];

    if (department) {
      sql += ' WHERE department = ?';
      params.push(department);
    }

    sql += ' ORDER BY name LIMIT ? OFFSET ?';
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const rows = await db.getAdapter().query(sql, params);

    return { agents: rows };
  });

  // Get agent by ID
  fastify.get('/agents/:id', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get agent details',
      tags: ['Agents'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          id: { type: 'integer' }
        }
      }
    }
  }, async (request, reply) => {
    const db = await getDatabaseInstance();
    const rows = await db.getAdapter().query(
      'SELECT id, name, role, model, fallbackModel, department FROM agents WHERE id = ?',
      [request.params.id]
    );

    if (rows.length === 0) {
      reply.code(404);
      return { error: 'Agent not found' };
    }

    return { agent: rows[0] };
  });

  // Create agent (admin/manager only)
  fastify.post('/agents', {
    preHandler: [
      fastify.requireAuth,
      async (request, reply) => requirePermission(request.user.role, 'agent', 'create')(request, reply)
    ],
    schema: {
      description: 'Create a new agent',
      tags: ['Agents'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name', 'role', 'model'],
        properties: {
          name: { type: 'string' },
          role: { type: 'string' },
          model: { type: 'string' },
          fallbackModel: { type: 'string' },
          department: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const db = await getDatabaseInstance();
    const { name, role, model, fallbackModel, department } = request.body;

    const result = await db.getAdapter().execute(
      'INSERT INTO agents (name, role, model, fallbackModel, department) VALUES (?, ?, ?, ?, ?)',
      [name, role, model, fallbackModel || model, department || null]
    );

    reply.code(201);
    return {
      agent: {
        id: result.lastInsertRowid,
        name,
        role,
        model,
        fallbackModel: fallbackModel || model,
        department
      }
    };
  });
}

module.exports = agentRoutes;
