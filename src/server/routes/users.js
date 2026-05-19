/**
 * User Routes
 */

const {
  registerUser,
  loginUser,
  logoutUser,
  getUserById,
  updateUserRole
} = require('../../auth/index.js');
const { requirePermission } = require('../../auth/rbac.js');

async function userRoutes(fastify, options) {
  // Register
  fastify.post('/auth/register', {
    schema: {
      description: 'Register new user',
      tags: ['Auth'],
      body: {
        type: 'object',
        required: ['username', 'email', 'password'],
        properties: {
          username: { type: 'string' },
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
          role: { type: 'string', enum: ['user', 'manager', 'admin', 'guest'] }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { username, email, password, role } = request.body;
      const result = await registerUser(username, email, password, role);
      reply.code(201);
      return result;
    } catch (error) {
      reply.code(400);
      return { error: error.message };
    }
  });

  // Login
  fastify.post('/auth/login', {
    schema: {
      description: 'Login user',
      tags: ['Auth'],
      body: {
        type: 'object',
        required: ['usernameOrEmail', 'password'],
        properties: {
          usernameOrEmail: { type: 'string' },
          password: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const { usernameOrEmail, password } = request.body;
      const result = await loginUser(usernameOrEmail, password);
      return result;
    } catch (error) {
      reply.code(401);
      return { error: error.message };
    }
  });

  // Logout
  fastify.post('/auth/logout', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Logout user',
      tags: ['Auth'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request, reply) => {
    await logoutUser(request.user.id);
    return { message: 'Logged out successfully' };
  });

  // Get current user
  fastify.get('/users/me', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get current user profile',
      tags: ['Users'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request, reply) => {
    const user = await getUserById(request.user.id);
    return { user };
  });

  // Update user role (admin only)
  fastify.patch('/users/:id/role', {
    preHandler: [
      fastify.requireAuth,
      async (request, reply) => requirePermission(request.user.role, 'user', 'manage')(request, reply)
    ],
    schema: {
      description: 'Update user role (admin only)',
      tags: ['Users'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['role'],
        properties: {
          role: { type: 'string', enum: ['admin', 'manager', 'user', 'guest'] }
        }
      }
    }
  }, async (request, reply) => {
    try {
      await updateUserRole(request.params.id, request.body.role);
      return { message: 'Role updated' };
    } catch (error) {
      reply.code(400);
      return { error: error.message };
    }
  });
}

module.exports = userRoutes;
