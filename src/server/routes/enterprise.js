/**
 * Enterprise Routes
 * Organization management, SSO, SCIM, and audit logs.
 */

const { getOrganizationManager } = require('../../enterprise/orgs.js');
const { validateSSOConfig, SSO_PROVIDERS } = require('../../enterprise/sso.js');
const { validateSCIMToken, formatSCIMUser, formatSCIMList, formatSCIMError, provisionUser, deactivateUser } = require('../../enterprise/scim.js');

async function enterpriseRoutes(fastify, options) {

  // ── Organizations ────────────────────────────────────────────────────────

  // List organizations for current user
  fastify.get('/organizations', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'List organizations for the current user',
      tags: ['Enterprise'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request) => {
    const manager = getOrganizationManager();
    const organizations = await manager.listOrganizations(request.user.id);
    return { organizations };
  });

  // Create an organization
  fastify.post('/organizations', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Create a new organization',
      tags: ['Enterprise'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          slug: { type: 'string' },
          domain: { type: 'string' },
          plan: { type: 'string', enum: ['basic', 'pro', 'enterprise'] },
          settings: { type: 'object' }
        }
      }
    }
  }, async (request, reply) => {
    const manager = getOrganizationManager();
    const org = await manager.createOrganization(request.user.id, request.body);
    reply.code(201);
    return { organization: org };
  });

  // Get an organization
  fastify.get('/organizations/:orgId', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get organization details',
      tags: ['Enterprise'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { orgId: { type: 'integer' } },
        required: ['orgId']
      }
    }
  }, async (request, reply) => {
    const manager = getOrganizationManager();
    const role = await manager.isMember(request.params.orgId, request.user.id);
    if (!role) {
      reply.code(403).send({ error: 'Forbidden', message: 'Not a member of this organization' });
      return;
    }
    const org = await manager.getOrganization(request.params.orgId);
    if (!org) {
      reply.code(404).send({ error: 'NotFound', message: 'Organization not found' });
      return;
    }
    return { organization: org };
  });

  // Update an organization
  fastify.patch('/organizations/:orgId', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Update an organization',
      tags: ['Enterprise'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { orgId: { type: 'integer' } },
        required: ['orgId']
      },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          domain: { type: 'string' },
          plan: { type: 'string' },
          dataRetentionDays: { type: 'integer' },
          customDomain: { type: 'string' },
          settings: { type: 'object' }
        }
      }
    }
  }, async (request, reply) => {
    const manager = getOrganizationManager();
    const role = await manager.isMember(request.params.orgId, request.user.id);
    if (!role || !['owner', 'admin'].includes(role)) {
      reply.code(403).send({ error: 'Forbidden', message: 'Admin access required' });
      return;
    }
    const org = await manager.updateOrganization(request.params.orgId, request.body);
    return { organization: org };
  });

  // Delete an organization
  fastify.delete('/organizations/:orgId', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Delete an organization',
      tags: ['Enterprise'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { orgId: { type: 'integer' } },
        required: ['orgId']
      }
    }
  }, async (request, reply) => {
    const manager = getOrganizationManager();
    const role = await manager.isMember(request.params.orgId, request.user.id);
    if (role !== 'owner') {
      reply.code(403).send({ error: 'Forbidden', message: 'Owner access required' });
      return;
    }
    const deleted = await manager.deleteOrganization(request.params.orgId);
    return { deleted };
  });

  // ── Members ──────────────────────────────────────────────────────────────

  // List members
  fastify.get('/organizations/:orgId/members', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'List organization members',
      tags: ['Enterprise'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { orgId: { type: 'integer' } },
        required: ['orgId']
      }
    }
  }, async (request, reply) => {
    const manager = getOrganizationManager();
    const role = await manager.isMember(request.params.orgId, request.user.id);
    if (!role) {
      reply.code(403).send({ error: 'Forbidden', message: 'Not a member' });
      return;
    }
    const members = await manager.listMembers(request.params.orgId);
    return { members };
  });

  // Add member
  fastify.post('/organizations/:orgId/members', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Add a member to an organization',
      tags: ['Enterprise'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { orgId: { type: 'integer' } },
        required: ['orgId']
      },
      body: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: { type: 'integer' },
          role: { type: 'string', enum: ['member', 'admin', 'owner'] }
        }
      }
    }
  }, async (request, reply) => {
    const manager = getOrganizationManager();
    const role = await manager.isMember(request.params.orgId, request.user.id);
    if (!role || !['owner', 'admin'].includes(role)) {
      reply.code(403).send({ error: 'Forbidden', message: 'Admin access required' });
      return;
    }
    const added = await manager.addMember(request.params.orgId, request.body.userId, request.body.role);
    return { added };
  });

  // Remove member
  fastify.delete('/organizations/:orgId/members/:userId', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Remove a member from an organization',
      tags: ['Enterprise'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: {
          orgId: { type: 'integer' },
          userId: { type: 'integer' }
        },
        required: ['orgId', 'userId']
      }
    }
  }, async (request, reply) => {
    const manager = getOrganizationManager();
    const role = await manager.isMember(request.params.orgId, request.user.id);
    if (!role || !['owner', 'admin'].includes(role)) {
      reply.code(403).send({ error: 'Forbidden', message: 'Admin access required' });
      return;
    }
    const removed = await manager.removeMember(request.params.orgId, request.params.userId);
    return { removed };
  });

  // ── SSO Configuration ────────────────────────────────────────────────────

  // Configure SSO
  fastify.put('/organizations/:orgId/sso', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Configure SSO for an organization',
      tags: ['Enterprise'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { orgId: { type: 'integer' } },
        required: ['orgId']
      },
      body: {
        type: 'object',
        required: ['provider'],
        properties: {
          enabled: { type: 'boolean' },
          provider: { type: 'string' },
          config: { type: 'object' }
        }
      }
    }
  }, async (request, reply) => {
    const manager = getOrganizationManager();
    const role = await manager.isMember(request.params.orgId, request.user.id);
    if (role !== 'owner') {
      reply.code(403).send({ error: 'Forbidden', message: 'Owner access required' });
      return;
    }

    const validation = validateSSOConfig(request.body.provider, request.body.config || {});
    if (!validation.valid) {
      reply.code(400).send({ error: 'ValidationError', message: validation.errors.join(', ') });
      return;
    }

    const org = await manager.configureSSO(request.params.orgId, request.body);
    return { organization: org };
  });

  // List SSO providers
  fastify.get('/enterprise/sso/providers', {
    schema: {
      description: 'List supported SSO providers',
      tags: ['Enterprise']
    }
  }, async () => {
    return {
      providers: Object.entries(SSO_PROVIDERS).map(([key, value]) => ({
        id: value,
        name: key.replace(/_/g, ' ')
      }))
    };
  });

  // ── SCIM Provisioning ────────────────────────────────────────────────────

  // SCIM Users endpoint
  fastify.get('/scim/v2/Users', {
    schema: {
      description: 'SCIM 2.0 Users endpoint',
      tags: ['SCIM'],
      headers: {
        type: 'object',
        properties: { authorization: { type: 'string' } }
      }
    }
  }, async (request, reply) => {
    // Extract org from path or header (simplified — production should validate per-org)
    const orgId = parseInt(request.headers['x-orca-org-id'] || '0', 10);
    const token = (request.headers.authorization || '').replace('Bearer ', '');

    if (!orgId || !await validateSCIMToken(orgId, token)) {
      reply.code(401).send(formatSCIMError(401, 'Invalid SCIM token'));
      return;
    }

    const db = require('../../db');
    const database = await db.getDatabaseInstance();
    const adapter = database.getAdapter();

    const startIndex = parseInt(request.query.startIndex || '1', 10);
    const count = parseInt(request.query.count || '100', 10);

    const rows = await adapter.execute(
      `SELECT u.* FROM users u
       JOIN organization_members om ON u.id = om.user_id
       WHERE om.org_id = ?
       ORDER BY u.id LIMIT ? OFFSET ?`,
      [orgId, count, startIndex - 1]
    );

    const users = Array.isArray(rows) ? rows : (rows.rows || []);
    return formatSCIMList(
      users.map(u => formatSCIMUser(u, orgId)),
      users.length,
      startIndex,
      count
    );
  });

  // SCIM create user
  fastify.post('/scim/v2/Users', {
    schema: {
      description: 'SCIM 2.0 create user',
      tags: ['SCIM']
    }
  }, async (request, reply) => {
    const orgId = parseInt(request.headers['x-orca-org-id'] || '0', 10);
    const token = (request.headers.authorization || '').replace('Bearer ', '');

    if (!orgId || !await validateSCIMToken(orgId, token)) {
      reply.code(401).send(formatSCIMError(401, 'Invalid SCIM token'));
      return;
    }

    try {
      const result = await provisionUser(orgId, request.body);
      const db = require('../../db');
      const database = await db.getDatabaseInstance();
      const adapter = database.getAdapter();
      const rows = await adapter.execute('SELECT * FROM users WHERE id = ?', [result.id]);
      const user = Array.isArray(rows) ? rows[0] : (rows.rows ? rows.rows[0] : null);

      reply.code(result.created ? 201 : 200);
      return formatSCIMUser(user, orgId);
    } catch (error) {
      reply.code(400).send(formatSCIMError(400, error.message));
    }
  });

  // SCIM deactivate user
  fastify.patch('/scim/v2/Users/:userId', {
    schema: {
      description: 'SCIM 2.0 update/deactivate user',
      tags: ['SCIM']
    }
  }, async (request, reply) => {
    const orgId = parseInt(request.headers['x-orca-org-id'] || '0', 10);
    const token = (request.headers.authorization || '').replace('Bearer ', '');

    if (!orgId || !await validateSCIMToken(orgId, token)) {
      reply.code(401).send(formatSCIMError(401, 'Invalid SCIM token'));
      return;
    }

    if (request.body.active === false) {
      await deactivateUser(orgId, parseInt(request.params.userId, 10));
    }

    return { id: request.params.userId, active: request.body.active !== false };
  });

  // ── Audit Logs ───────────────────────────────────────────────────────────

  // Get audit logs
  fastify.get('/organizations/:orgId/audit', {
    preHandler: [fastify.requireAuth],
    schema: {
      description: 'Get organization audit logs',
      tags: ['Enterprise'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { orgId: { type: 'integer' } },
        required: ['orgId']
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
          offset: { type: 'integer', minimum: 0, default: 0 }
        }
      }
    }
  }, async (request, reply) => {
    const manager = getOrganizationManager();
    const role = await manager.isMember(request.params.orgId, request.user.id);
    if (!role || !['owner', 'admin'].includes(role)) {
      reply.code(403).send({ error: 'Forbidden', message: 'Admin access required' });
      return;
    }
    const logs = await manager.getAuditLogs(request.params.orgId, {
      limit: request.query.limit,
      offset: request.query.offset
    });
    return { logs };
  });
}

module.exports = enterpriseRoutes;
