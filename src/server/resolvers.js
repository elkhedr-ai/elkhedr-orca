/**
 * GraphQL Resolvers
 * Implements all Query, Mutation, and Subscription operations
 */

const { PubSub } = require('graphql-subscriptions');
const { getDatabaseInstance } = require('../db');
const {
  registerUser,
  loginUser,
  logoutUser,
  getUserById
} = require('../auth/index.js');
const {
  createApiKey,
  getUserApiKeys,
  revokeApiKey
} = require('../auth/api-keys.js');
const { verifyAccessToken } = require('../auth/jwt.js');
const { validateApiKey } = require('../auth/api-keys.js');

// Event pub/sub for subscriptions
const pubsub = new PubSub();

// Helper to get current user from context
async function getCurrentUser(context) {
  if (context.user) return context.user;

  const authHeader = context.req?.headers?.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const decoded = verifyAccessToken(token);
    if (decoded) {
      const user = await getUserById(decoded.userId);
      if (user) {
        context.user = user;
        return user;
      }
    }
  }

  const apiKey = context.req?.headers['x-api-key'];
  if (apiKey) {
    const keyData = await validateApiKey(apiKey);
    if (keyData) {
      const user = await getUserById(keyData.userId);
      if (user) {
        context.user = { ...user, scopes: keyData.scopes };
        return context.user;
      }
    }
  }

  return null;
}

// Require authentication
function requireAuth(user) {
  if (!user) {
    throw new Error('Authentication required');
  }
}

const resolvers = {
  Query: {
    // Health
    health: () => ({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    }),

    // Agents
    agents: async (_, { department, limit = 50, offset = 0 }, context) => {
      requireAuth(await getCurrentUser(context));
      const db = await getDatabaseInstance();
      let sql = 'SELECT id, name, role, model, fallbackModel, department, created_at as createdAt, updated_at as updatedAt FROM agents';
      const params = [];

      if (department) {
        sql += ' WHERE department = ?';
        params.push(department);
      }

      sql += ' ORDER BY name LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const rows = await db.getAdapter().query(sql, params);
      return rows;
    },

    agent: async (_, { id }, context) => {
      requireAuth(await getCurrentUser(context));
      const db = await getDatabaseInstance();
      const rows = await db.getAdapter().query(
        'SELECT id, name, role, model, fallbackModel, department, created_at as createdAt, updated_at as updatedAt FROM agents WHERE id = ?',
        [id]
      );
      return rows[0] || null;
    },

    // Sessions
    sessions: async (_, { limit = 50, offset = 0 }, context) => {
      const user = await getCurrentUser(context);
      requireAuth(user);
      const db = await getDatabaseInstance();
      const rows = await db.getAdapter().query(
        `SELECT id, prompt, mode, agent, result, tokens, traceId, created_at as createdAt, user_id as userId
         FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [user.id, limit, offset]
      );
      return rows;
    },

    session: async (_, { id }, context) => {
      const user = await getCurrentUser(context);
      requireAuth(user);
      const db = await getDatabaseInstance();
      const rows = await db.getAdapter().query(
        'SELECT id, prompt, mode, agent, result, tokens, traceId, created_at as createdAt, user_id as userId FROM sessions WHERE id = ? AND user_id = ?',
        [id, user.id]
      );
      return rows[0] || null;
    },

    // Analytics
    analytics: async (_, __, context) => {
      const user = await getCurrentUser(context);
      requireAuth(user);
      const db = await getDatabaseInstance();
      const data = await db.getAnalyticsData(user.id);
      const usage = await db.getAgentUsageData(user.id);
      return {
        totalOperations: data.totalOperations,
        totalTokens: data.totalTokens,
        totalCost: data.totalCost,
        agentUsage: Object.entries(usage).map(([role, stats]) => ({
          role,
          calls: stats.calls,
          tokens: stats.tokens,
          cost: stats.cost
        }))
      };
    },

    analyticsDaily: async (_, { limit = 30 }, context) => {
      requireAuth(await getCurrentUser(context));
      const db = await getDatabaseInstance();
      return db.getDailyAnalytics(limit);
    },

    analyticsWeekly: async (_, { limit = 12 }, context) => {
      requireAuth(await getCurrentUser(context));
      const db = await getDatabaseInstance();
      return db.getWeeklyAnalytics(limit);
    },

    analyticsMonthly: async (_, { limit = 12 }, context) => {
      requireAuth(await getCurrentUser(context));
      const db = await getDatabaseInstance();
      return db.getMonthlyAnalytics(limit);
    },

    // Users
    me: async (_, __, context) => {
      return getCurrentUser(context);
    },

    user: async (_, { id }, context) => {
      requireAuth(await getCurrentUser(context));
      return getUserById(id);
    },

    // Skills
    skills: async (_, __, context) => {
      requireAuth(await getCurrentUser(context));
      const db = await getDatabaseInstance();
      const rows = await db.getAdapter().query(
        'SELECT id, name, version, description, permissions, created_at as createdAt FROM skills ORDER BY name'
      );
      return rows.map(s => ({
        ...s,
        permissions: s.permissions ? JSON.parse(s.permissions) : []
      }));
    },

    skill: async (_, { id }, context) => {
      requireAuth(await getCurrentUser(context));
      const db = await getDatabaseInstance();
      const rows = await db.getAdapter().query(
        'SELECT id, name, version, description, permissions, created_at as createdAt FROM skills WHERE id = ?',
        [id]
      );
      if (rows.length === 0) return null;
      return {
        ...rows[0],
        permissions: rows[0].permissions ? JSON.parse(rows[0].permissions) : []
      };
    },

    // Workspaces
    workspaces: async (_, __, context) => {
      const user = await getCurrentUser(context);
      requireAuth(user);
      const db = await getDatabaseInstance();
      const rows = await db.getAdapter().query(
        `SELECT w.id, w.name, w.slug, w.description, w.owner_id as ownerId, w.billing_plan as billingPlan, w.created_at as createdAt
         FROM workspaces w
         INNER JOIN workspace_members wm ON w.id = wm.workspace_id
         WHERE wm.user_id = ?`,
        [user.id]
      );
      return rows;
    },

    workspace: async (_, { id }, context) => {
      const user = await getCurrentUser(context);
      requireAuth(user);
      const db = await getDatabaseInstance();
      const rows = await db.getAdapter().query(
        `SELECT w.id, w.name, w.slug, w.description, w.owner_id as ownerId, w.billing_plan as billingPlan, w.created_at as createdAt
         FROM workspaces w
         INNER JOIN workspace_members wm ON w.id = wm.workspace_id
         WHERE w.id = ? AND wm.user_id = ?`,
        [id, user.id]
      );
      return rows[0] || null;
    },

    // Costs
    costs: async (_, { limit = 100 }, context) => {
      requireAuth(await getCurrentUser(context));
      const db = await getDatabaseInstance();
      return db.getAdapter().query(
        'SELECT id, task_id as taskId, tokens, cost, created_at as createdAt FROM costs ORDER BY created_at DESC LIMIT ?',
        [limit]
      );
    },

    // Audit Logs
    auditLogs: async (_, { limit = 50, eventType }, context) => {
      requireAuth(await getCurrentUser(context));
      const db = await getDatabaseInstance();
      let sql = 'SELECT id, event_type as eventType, user_id as userId, action, status, resource_type as resourceType, resource_id as resourceId, metadata, created_at as createdAt FROM audit_logs';
      const params = [];

      if (eventType) {
        sql += ' WHERE event_type = ?';
        params.push(eventType);
      }

      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);

      return db.getAdapter().query(sql, params);
    }
  },

  Mutation: {
    // Auth
    register: async (_, { input }) => {
      const { username, email, password, role } = input;
      const result = await registerUser(username, email, password, role);
      return {
        user: result.user,
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken
      };
    },

    login: async (_, { input }) => {
      const { usernameOrEmail, password } = input;
      const result = await loginUser(usernameOrEmail, password);
      return {
        user: result.user,
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken
      };
    },

    logout: async (_, __, context) => {
      const user = await getCurrentUser(context);
      if (user) {
        await logoutUser(user.id);
      }
      return true;
    },

    // Sessions
    createSession: async (_, { input }, context) => {
      const user = await getCurrentUser(context);
      requireAuth(user);
      const db = await getDatabaseInstance();
      const { prompt, mode, agent, result, tokens = 0 } = input;

      const result2 = await db.getAdapter().execute(
        'INSERT INTO sessions (user_id, prompt, mode, agent, result, tokens) VALUES (?, ?, ?, ?, ?, ?)',
        [user.id, prompt, mode, agent, result, tokens]
      );

      const session = {
        id: result2.lastInsertRowid,
        prompt,
        mode,
        agent,
        result,
        tokens,
        userId: user.id,
        createdAt: new Date().toISOString()
      };

      // Publish subscription event
      pubsub.publish('SESSION_CREATED', { sessionCreated: session });

      return session;
    },

    deleteSession: async (_, { id }, context) => {
      const user = await getCurrentUser(context);
      requireAuth(user);
      const db = await getDatabaseInstance();
      await db.getAdapter().execute(
        'DELETE FROM sessions WHERE id = ? AND user_id = ?',
        [id, user.id]
      );
      return true;
    },

    // Agents
    createAgent: async (_, { input }, context) => {
      requireAuth(await getCurrentUser(context));
      const db = await getDatabaseInstance();
      const { name, role, model, fallbackModel, department } = input;

      const result = await db.getAdapter().execute(
        'INSERT INTO agents (name, role, model, fallbackModel, department) VALUES (?, ?, ?, ?, ?)',
        [name, role, model, fallbackModel || model, department || null]
      );

      return {
        id: result.lastInsertRowid,
        name,
        role,
        model,
        fallbackModel: fallbackModel || model,
        department,
        createdAt: new Date().toISOString()
      };
    },

    // API Keys
    createApiKey: async (_, { input }, context) => {
      const user = await getCurrentUser(context);
      requireAuth(user);
      const { name, scopes, expiresInDays } = input;
      const result = await createApiKey(user.id, name, scopes, expiresInDays);

      return {
        id: result.keyData.id,
        prefix: result.keyData.prefix,
        name: result.keyData.name,
        scopes: result.keyData.scopes,
        expiresAt: result.keyData.expiresAt,
        createdAt: result.keyData.createdAt
      };
    },

    revokeApiKey: async (_, { id }, context) => {
      const user = await getCurrentUser(context);
      requireAuth(user);
      await revokeApiKey(id, user.id);
      return true;
    },

    // Workspaces
    createWorkspace: async (_, { input }, context) => {
      const user = await getCurrentUser(context);
      requireAuth(user);
      const db = await getDatabaseInstance();
      const { name, slug, description } = input;

      const result = await db.getAdapter().execute(
        'INSERT INTO workspaces (name, slug, description, owner_id) VALUES (?, ?, ?, ?)',
        [name, slug, description || null, user.id]
      );

      // Add creator as owner member
      await db.getAdapter().execute(
        'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)',
        [result.lastInsertRowid, user.id, 'owner']
      );

      return {
        id: result.lastInsertRowid,
        name,
        slug,
        description,
        ownerId: user.id,
        createdAt: new Date().toISOString()
      };
    },

    inviteWorkspaceMember: async (_, { workspaceId, email, role }, context) => {
      const user = await getCurrentUser(context);
      requireAuth(user);
      const db = await getDatabaseInstance();

      // Verify user is workspace member
      const members = await db.getAdapter().query(
        'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
        [workspaceId, user.id]
      );

      if (members.length === 0) {
        throw new Error('Not a member of this workspace');
      }

      // Generate invite token
      const crypto = require('crypto');
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

      await db.getAdapter().execute(
        'INSERT INTO workspace_invites (workspace_id, email, token, role, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
        [workspaceId, email, token, role, user.id, expiresAt.toISOString()]
      );

      return true;
    }
  },

  Subscription: {
    eventCreated: {
      subscribe: () => pubsub.asyncIterator(['EVENT_CREATED'])
    },
    agentActivity: {
      subscribe: () => pubsub.asyncIterator(['AGENT_ACTIVITY'])
    },
    costUpdated: {
      subscribe: () => pubsub.asyncIterator(['COST_UPDATED'])
    },
    sessionCreated: {
      subscribe: () => pubsub.asyncIterator(['SESSION_CREATED'])
    }
  }
};

module.exports = {
  resolvers,
  pubsub
};
