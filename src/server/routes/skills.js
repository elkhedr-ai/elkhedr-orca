/**
 * Skill Routes
 */

const { getDatabaseInstance } = require('../../db');
const { requirePermission } = require('../../auth/rbac.js');

async function skillRoutes(fastify, options) {
  // List skills
  fastify.get('/skills', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'List all skills',
      tags: ['Skills'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request, reply) => {
    const db = await getDatabaseInstance();
    const rows = await db.getAdapter().query(
      'SELECT id, name, version, description, permissions, created_at FROM skills ORDER BY name'
    );

    return {
      skills: rows.map(s => ({
        ...s,
        permissions: s.permissions ? JSON.parse(s.permissions) : []
      }))
    };
  });

  // Get skill by ID
  fastify.get('/skills/:id', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get skill details',
      tags: ['Skills'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request, reply) => {
    const db = await getDatabaseInstance();
    const rows = await db.getAdapter().query(
      'SELECT * FROM skills WHERE id = ?',
      [request.params.id]
    );

    if (rows.length === 0) {
      reply.code(404);
      return { error: 'Skill not found' };
    }

    return {
      skill: {
        ...rows[0],
        permissions: rows[0].permissions ? JSON.parse(rows[0].permissions) : []
      }
    };
  });

  // Create skill (admin only)
  fastify.post('/skills', {
    preHandler: [
      fastify.requireAuth,
      async (request, reply) => requirePermission(request.user.role, 'skill', 'create')(request, reply)
    ],
    schema: {
      description: 'Register a new skill',
      tags: ['Skills'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name', 'version'],
        properties: {
          name: { type: 'string' },
          version: { type: 'string' },
          description: { type: 'string' },
          permissions: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const db = await getDatabaseInstance();
    const { name, version, description, permissions = [] } = request.body;

    try {
      const result = await db.getAdapter().execute(
        'INSERT INTO skills (name, version, description, permissions) VALUES (?, ?, ?, ?)',
        [name, version, description || null, JSON.stringify(permissions)]
      );

      reply.code(201);
      return {
        skill: {
          id: result.lastInsertRowid,
          name,
          version,
          description,
          permissions
        }
      };
    } catch (error) {
      if (error.message.includes('UNIQUE constraint failed')) {
        reply.code(409);
        return { error: 'Skill with this name already exists' };
      }
      throw error;
    }
  });

  // Delete skill (admin only)
  fastify.delete('/skills/:id', {
    preHandler: [
      fastify.requireAuth,
      async (request, reply) => requirePermission(request.user.role, 'skill', 'delete')(request, reply)
    ],
    schema: {
      description: 'Delete a skill',
      tags: ['Skills'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request, reply) => {
    const db = await getDatabaseInstance();
    const result = await db.getAdapter().execute(
      'DELETE FROM skills WHERE id = ?',
      [request.params.id]
    );

    if (result.changes === 0) {
      reply.code(404);
      return { error: 'Skill not found' };
    }

    return { deleted: true };
  });
}

module.exports = skillRoutes;
