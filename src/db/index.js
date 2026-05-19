/**
 * Database Manager
 * Provides a unified interface for database operations
 * Supports both SQLite and PostgreSQL through adapters
 */

const path = require('path');
const { createFromEnv, parseConfig } = require('./adapters/factory.js');
const { initDatabase } = require('./init.js');
const { logger } = require('../utils/logger.js');
const cache = require('../cache');

const ANALYTICS_CACHE_TTL = 120; // 2 min

class DatabaseManager {
  constructor() {
    this.adapter = null;
    this.initialized = false;
    this.preparedStatements = {};
  }

  /**
   * Initialize database connection and schema
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      // Create adapter from environment configuration
      this.adapter = await createFromEnv();

      // Initialize database schema/migrations
      await initDatabase(this.adapter);

      // Prepare commonly used statements
      await this.prepareStatements();

      this.initialized = true;
      logger.info(`Database initialized (${this.adapter.getType()})`);
    } catch (error) {
      logger.error(`Database initialization failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Prepare commonly used statements for better performance
   */
  async prepareStatements() {
    // Analytics statements
    this.preparedStatements.getAnalytics = this.adapter.prepare(`
      SELECT
        COALESCE(SUM(c.tokens), 0) as totalTokens,
        COALESCE(SUM(c.cost), 0) as totalCost,
        COUNT(t.id) as totalOperations
      FROM tasks t
      LEFT JOIN costs c ON t.id = c.task_id
    `);

    this.preparedStatements.getAgentUsage = this.adapter.prepare(`
      SELECT
        t.agent_role as role,
        COUNT(t.id) as calls,
        COALESCE(SUM(c.tokens), 0) as tokens,
        COALESCE(SUM(c.cost), 0) as cost
      FROM tasks t
      LEFT JOIN costs c ON t.id = c.task_id
      GROUP BY t.agent_role
      ORDER BY cost DESC
    `);

    // Session statements
    this.preparedStatements.getSessions = this.adapter.prepare(`
      SELECT
        id, created_at as timestamp, prompt, mode, agent, result, tokens, traceId
      FROM sessions
      ORDER BY created_at DESC
      LIMIT ?
    `);

    this.preparedStatements.saveSession = this.adapter.prepare(`
      INSERT INTO sessions (prompt, mode, agent, result, tokens, traceId)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.preparedStatements.clearSessions = this.adapter.prepare(`
      DELETE FROM sessions
    `);

    // Input history statements
    this.preparedStatements.getInputHistory = this.adapter.prepare(`
      SELECT value FROM input_history ORDER BY id DESC LIMIT 100
    `);

    this.preparedStatements.saveInputHistory = this.adapter.prepare(`
      INSERT INTO input_history (value) VALUES (?)
    `);

    this.preparedStatements.clearInputHistory = this.adapter.prepare(`
      DELETE FROM input_history
    `);

    // Agent statements
    this.preparedStatements.getAgents = this.adapter.prepare(`
      SELECT id, name, role, model, fallbackModel, department, created_at, updated_at
      FROM agents
      ORDER BY name
    `);
  }

  /**
   * Load agents from JSON file into database
   */
   /**
    * Load agents from JSON file into database
    */
   async loadAgentsFromJson() {
     const fs = require('fs');
     const agentsPath = path.join(__dirname, '..', 'agents.json');

     if (!fs.existsSync(agentsPath)) {
       return 0;
     }

     const data = JSON.parse(fs.readFileSync(agentsPath, 'utf8'));

     // Use appropriate INSERT OR REPLACE syntax based on database type
     const upsertSql = this.adapter.getType() === 'sqlite'
       ? `INSERT OR REPLACE INTO agents (name, role, model, fallbackModel, department, updated_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
       : `INSERT INTO agents (name, role, model, "fallbackModel", department, updated_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT (name) DO UPDATE SET
            role = EXCLUDED.role,
            model = EXCLUDED.model,
            "fallbackModel" = EXCLUDED."fallbackModel",
            department = EXCLUDED.department,
            updated_at = CURRENT_TIMESTAMP`;

     for (const agentData of data.agents) {
       await this.adapter.execute(upsertSql, [
         agentData.name || agentData.role,
         agentData.role,
         agentData.model,
         agentData.fallbackModel,
         agentData.department || null
       ]);
     }

     return data.agents.length;
   }

  // ---- Conversation Memory Methods ----
  /**
   * Insert a conversation message into the DB.
   * @param {Object} params - {agentId, sessionId, userId, role, content}
   */
  async addConversationMessage({agentId, sessionId, userId = null, role, content}) {
    const sql = `INSERT INTO conversation_messages (agent_id, session_id, user_id, role, content)
                 VALUES (?, ?, ?, ?, ?);`;
    await this.adapter.execute(sql, [agentId, sessionId, userId, role, content]);
  }

  /**
   * Retrieve recent messages for an agent/session.
   * If userId is provided, filters by user_id for isolation.
   * @param {Object} params - {agentId, sessionId, userId, limit}
   */
  async getRecentMessages({agentId, sessionId, userId = null, limit = 20}) {
    let sql = `SELECT role, content, created_at FROM conversation_messages
               WHERE agent_id = ? AND session_id = ?`;
    const params = [agentId, sessionId];
    if (userId !== null) {
      sql += ' AND user_id = ?';
      params.push(userId);
    }
    sql += ' ORDER BY created_at ASC LIMIT ?;';
    params.push(limit);
    const rows = await this.adapter.all(sql, params);
    return rows;
  }

  // ==================== Analytics Methods ====================

  /**
   * Get analytics data filtered by user_id (if provided)
   * @param {number|null} userId - If null, returns global analytics (admin only)
   */
  async getAnalyticsData(userId = null) {
    const cacheKey = userId !== null ? ['user', userId] : ['global'];
    return cache.rememberQuery('analytics', cacheKey, async () => {
      let sql = `
        SELECT
          COALESCE(SUM(c.tokens), 0) as totalTokens,
          COALESCE(SUM(c.cost), 0) as totalCost,
          COUNT(t.id) as totalOperations
        FROM tasks t
        LEFT JOIN costs c ON t.id = c.task_id
      `;
      const params = [];
      if (userId !== null) {
        sql += ' WHERE t.user_id = ?';
        params.push(userId);
      }
      const row = await this.adapter.query(sql, params).then(rows => rows[0]);
      return {
        totalOperations: row.totalOperations || 0,
        totalTokens: row.totalTokens || 0,
        totalCost: row.totalCost || 0,
        agentUsage: {}
      };
    }, ANALYTICS_CACHE_TTL);
  }

  /**
   * Get agent usage data filtered by user_id (if provided)
   * @param {number|null} userId - If null, returns global usage (admin only)
   */
  async getAgentUsageData(userId = null) {
    const cacheKey = userId !== null ? ['agent-usage', userId] : ['agent-usage', 'global'];
    return cache.rememberQuery('analytics', cacheKey, async () => {
      let sql = `
        SELECT
          t.agent_role as role,
          COUNT(t.id) as calls,
          COALESCE(SUM(c.tokens), 0) as tokens,
          COALESCE(SUM(c.cost), 0) as cost
        FROM tasks t
        LEFT JOIN costs c ON t.id = c.task_id
      `;
      const params = [];
      if (userId !== null) {
        sql += ' WHERE t.user_id = ?';
        params.push(userId);
      }
      sql += ' GROUP BY t.agent_role ORDER BY cost DESC';
      const rows = await this.adapter.query(sql, params);
      const usage = {};
      for (const row of rows) {
        usage[row.role] = {
          calls: row.calls,
          tokens: row.tokens,
          cost: row.cost
        };
      }
      return usage;
    }, ANALYTICS_CACHE_TTL);
  }

  /**
   * Update analytics with task data
   */
  async updateAnalytics(taskId, tokens, cost) {
    await this.adapter.execute(
      `INSERT INTO costs (task_id, tokens, cost) VALUES (?, ?, ?)`,
      [taskId, tokens, cost]
    );

    // Also update aggregate tables
    await this.updateAnalyticsAggregates(tokens, cost);

    // Invalidate analytics caches
    await cache.delPattern('orca:analytics:*');
  }

  /**
   * Update analytics aggregate tables
   */
  async updateAnalyticsAggregates(tokens, cost) {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1-12

    // Calculate ISO week
    const week = this.getISOWeek(now);

    // Update daily aggregates
    await this.adapter.execute(`
      INSERT INTO analytics_daily (date, total_operations, total_tokens, total_cost, agent_usage)
      VALUES (?, 1, ?, ?, '{}')
      ON CONFLICT(date) DO UPDATE SET
        total_operations = total_operations + 1,
        total_tokens = total_tokens + ?,
        total_cost = total_cost + ?,
        updated_at = CURRENT_TIMESTAMP
    `, [dateStr, tokens, cost, tokens, cost]);

    // Update weekly aggregates
    await this.adapter.execute(`
      INSERT INTO analytics_weekly (year, week, total_operations, total_tokens, total_cost, agent_usage)
      VALUES (?, ?, 1, ?, ?, '{}')
      ON CONFLICT(year, week) DO UPDATE SET
        total_operations = total_operations + 1,
        total_tokens = total_tokens + ?,
        total_cost = total_cost + ?,
        updated_at = CURRENT_TIMESTAMP
    `, [year, week, tokens, cost, tokens, cost]);

    // Update monthly aggregates
    await this.adapter.execute(`
      INSERT INTO analytics_monthly (year, month, total_operations, total_tokens, total_cost, agent_usage)
      VALUES (?, ?, 1, ?, ?, '{}')
      ON CONFLICT(year, month) DO UPDATE SET
        total_operations = total_operations + 1,
        total_tokens = total_tokens + ?,
        total_cost = total_cost + ?,
        updated_at = CURRENT_TIMESTAMP
    `, [year, month, tokens, cost, tokens, cost]);
  }

  /**
   * Calculate ISO week number
   */
  getISOWeek(date) {
    const target = new Date(date.valueOf());
    const dayNr = (date.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const jan4 = new Date(target.getFullYear(), 0, 4);
    const dayDiff = (target - jan4) / 86400000;
    const weekNr = 1 + Math.ceil(dayDiff / 7);
    return weekNr;
  }

  /**
   * Get daily analytics
   */
  async getDailyAnalytics(limit = 30) {
    const rows = await this.adapter.query(`
      SELECT * FROM analytics_daily
      ORDER BY date DESC
      LIMIT ?
    `, [limit]);
    return rows;
  }

  /**
   * Get weekly analytics
   */
  async getWeeklyAnalytics(limit = 12) {
    const rows = await this.adapter.query(`
      SELECT * FROM analytics_weekly
      ORDER BY year DESC, week DESC
      LIMIT ?
    `, [limit]);
    return rows;
  }

  /**
   * Get monthly analytics
   */
  async getMonthlyAnalytics(limit = 12) {
    const rows = await this.adapter.query(`
      SELECT * FROM analytics_monthly
      ORDER BY year DESC, month DESC
      LIMIT ?
    `, [limit]);
    return rows;
  }

  // ==================== Session Methods ====================

  /**
   * Get session history filtered by user_id (if provided)
   * @param {number|null} userId - If null, returns all sessions (admin only)
   * @param {number} limit - Maximum number of sessions to return
   */
  async getSessionsData(userId = null, limit = 50) {
    let sql = `
      SELECT
        id, created_at as timestamp, prompt, mode, agent, result, tokens, traceId
      FROM sessions
    `;
    const params = [];
    if (userId !== null) {
      sql += ' WHERE user_id = ?';
      params.push(userId);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    const rows = await this.adapter.query(sql, params);
    return rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      prompt: row.prompt,
      mode: row.mode,
      agent: row.agent,
      result: row.result,
      tokens: row.tokens,
      traceId: row.traceId
    }));
  }

  /**
   * Save session data with optional user_id
   * @param {Object} sessionData
   * @param {number|null} userId
   */
  async saveSessionData(sessionData, userId = null) {
    const sql = `
      INSERT INTO sessions (user_id, prompt, mode, agent, result, tokens, traceId)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const result = await this.adapter.run(sql, [
      userId,
      sessionData.prompt,
      sessionData.mode,
      sessionData.agent,
      sessionData.result,
      sessionData.tokens,
      sessionData.traceId
    ]);
    return result.lastInsertRowid;
  }

  /**
   * Clear all sessions
   */
  async clearSessionsData() {
    const result = await this.preparedStatements.clearSessions.run();
    return result.changes;
  }

  // ==================== Input History Methods ====================

  /**
   * Get input history
   */
  async getInputHistoryData() {
    const rows = await this.preparedStatements.getInputHistory.all();
    return rows.map(row => row.value);
  }

  /**
   * Save input history entry
   */
  async saveInputHistoryData(value) {
    await this.preparedStatements.saveInputHistory.run(value);

    // Keep only last 100 entries
    const countResult = await this.adapter.query(
      'SELECT COUNT(*) as count FROM input_history'
    );
    const count = countResult[0].count;

    if (count > 100) {
      await this.adapter.execute(`
        DELETE FROM input_history
        WHERE id NOT IN (
          SELECT id FROM input_history ORDER BY id DESC LIMIT 100
        )
      `);
    }
  }

  /**
   * Clear input history
   */
  async clearInputHistoryData() {
    const result = await this.preparedStatements.clearInputHistory.run();
    return result.changes;
  }

  // ==================== Agent Methods ====================

  /**
   * Get all agents
   */
  async getAgentsData() {
    const rows = await this.preparedStatements.getAgents.all();
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      role: row.role,
      model: row.model,
      fallbackModel: row.fallbackModel,
      department: row.department
    }));
  }

  // ==================== Knowledge Base Methods ====================
  /**
   * Create a new knowledge entry.
   * @param {Object} params - {agentId, sessionId, userId, title, content, type}
   */
  async createKnowledgeEntry({agentId, sessionId = null, userId = null, title, content, type = 'markdown'}) {
    const sql = `INSERT INTO knowledge_entries (agent_id, session_id, user_id, title, content, content_type)
                 VALUES (?, ?, ?, ?, ?, ?);`;
    const result = await this.adapter.run(sql, [agentId, sessionId, userId, title, content, type]);
    return result.lastInsertRowid;
  }

  /**
   * Update an existing knowledge entry (adds a version).
   * Only updates if userId matches or is null (public entry).
   */
  async updateKnowledgeEntry(entryId, {content, userId = null}) {
    // Verify ownership if userId is provided
    if (userId !== null) {
      const entry = await this.getKnowledgeEntryById(entryId);
      if (entry && entry.user_id !== null && entry.user_id !== userId) {
        throw new Error(`Unauthorized: cannot update knowledge entry ${entryId}`);
      }
    }
    // Insert version snapshot
    await this.adapter.run(`INSERT INTO knowledge_versions (entry_id, content) VALUES (?, ?);`, [entryId, content]);
    // Update latest content & timestamp
    await this.adapter.run(`UPDATE knowledge_entries SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`, [content, entryId]);
  }

  /**
   * Simple search over title and content (LIKE fallback).
   * If userId is provided, filters by user_id for isolation.
   */
  async searchKnowledge(agentId, query, userId = null, limit = 10) {
    const pattern = `%${query}%`;
    let sql = `SELECT id, title, content_type, created_at FROM knowledge_entries
               WHERE agent_id = ? AND (title LIKE ? OR content LIKE ?)`;
    const params = [agentId, pattern, pattern];
    if (userId !== null) {
      sql += ' AND (user_id = ? OR user_id IS NULL)';
      params.push(userId);
    }
    sql += ' ORDER BY updated_at DESC LIMIT ?;';
    params.push(limit);
    const rows = await this.adapter.all(sql, params);
    return rows;
  }

  /**
   * Retrieve entry by ID (latest content).
   * If userId is provided, verifies ownership or public access.
   */
  async getKnowledgeEntryById(entryId, userId = null) {
    let sql = `SELECT * FROM knowledge_entries WHERE id = ?`;
    const params = [entryId];
    if (userId !== null) {
      sql += ' AND (user_id = ? OR user_id IS NULL)';
      params.push(userId);
    }
    sql += ';';
    const rows = await this.adapter.all(sql, params);
    return rows[0] || null;
  }

  // ==================== Session Stats Methods ====================
   /**
    * Get session stats by session ID.
    * If userId is provided, verifies ownership.
    */
   async getSessionStats(sessionId, userId = null) {
     let sql = `SELECT level, sandbox, currentAgent, user_id FROM session_stats WHERE session_id = ?`;
     const params = [sessionId];
     if (userId !== null) {
       sql += ' AND (user_id = ? OR user_id IS NULL)';
       params.push(userId);
     }
     sql += ';';
     const rows = await this.adapter.all(sql, params);
     return rows[0] || null;
   }

   /**
    * Create or update session stats.
    * If a row exists, update it; otherwise insert a new row.
    * userId is set on insert but not updated on conflict to preserve ownership.
    */
   async upsertSessionStats(sessionId, {level = 'Auto', sandbox = false, currentAgent = null, userId = null}) {
     const sql = `INSERT INTO session_stats (session_id, user_id, level, sandbox, currentAgent, updated_at)
                  VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                  ON CONFLICT(session_id) DO UPDATE SET
                    level = EXCLUDED.level,
                    sandbox = EXCLUDED.sandbox,
                    currentAgent = EXCLUDED.currentAgent,
                    updated_at = CURRENT_TIMESTAMP;`;
     await this.adapter.run(sql, [sessionId, userId, level, sandbox ? 1 : 0, currentAgent]);
   }

  // ==================== Utility Methods ====================

  /**
   * Get the underlying adapter
   */
  getAdapter() {
    return this.adapter;
  }

  /**
   * Get database type
   */
  getType() {
    return this.adapter ? this.adapter.getType() : null;
  }

  /**
   * Get connection pool stats (PostgreSQL only)
   */
  getPoolStats() {
    return this.adapter ? this.adapter.getPoolStats() : null;
  }

  /**
   * Check if database is connected
   */
  isConnected() {
    return this.adapter ? this.adapter.isConnected() : false;
  }

  /**
   * Close database connection
   */
  async close() {
    if (this.adapter) {
      await this.adapter.disconnect();
      this.adapter = null;
      this.initialized = false;
      this.preparedStatements = {};
    }
  }

  /**
   * Direct access to underlying database client (for advanced usage)
   * Use with caution - bypasses abstraction layer
   */
  get db() {
    if (!this.adapter) {
      throw new Error('Database not initialized');
    }
    return this.adapter.getClient();
  }
}

// Singleton instance
let instance = null;

/**
 * Get database instance (singleton)
 * Automatically initializes on first call
 */
function getDatabaseInstance() {
  if (!instance) {
    instance = new DatabaseManager();
  }
  return instance;
}

/**
 * Initialize database (call this at application startup)
 */
async function initializeDatabaseInstance() {
  const db = getDatabaseInstance();
  if (!db.initialized) {
    await db.initialize();
  }
  return db;
}

module.exports = {
  getDatabaseInstance,
  initializeDatabaseInstance,
  DatabaseManager
};

// Made with Bob
