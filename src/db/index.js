/**
 * Database Manager
 * Provides a unified interface for database operations
 * Supports both SQLite and PostgreSQL through adapters
 */

const path = require('path');
const { createFromEnv, parseConfig } = require('./adapters/factory.js');
const { initDatabase } = require('./init.js');
const { logger } = require('../utils/logger.js');

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
        agentData.name,
        agentData.role,
        agentData.model,
        agentData.fallbackModel,
        agentData.department || null
      ]);
    }

    return data.agents.length;
  }

  // ==================== Analytics Methods ====================

  /**
   * Get analytics data
   */
  async getAnalyticsData() {
    const row = await this.preparedStatements.getAnalytics.get();
    return {
      totalOperations: row.totalOperations || 0,
      totalTokens: row.totalTokens || 0,
      totalCost: row.totalCost || 0,
      agentUsage: {}
    };
  }

  /**
   * Get agent usage data
   */
  async getAgentUsageData() {
    const rows = await this.preparedStatements.getAgentUsage.all();
    const usage = {};
    for (const row of rows) {
      usage[row.role] = {
        calls: row.calls,
        tokens: row.tokens,
        cost: row.cost
      };
    }
    return usage;
  }

  /**
   * Update analytics with task data
   */
  async updateAnalytics(taskId, tokens, cost) {
    await this.adapter.execute(
      `INSERT INTO costs (task_id, tokens, cost) VALUES (?, ?, ?)`,
      [taskId, tokens, cost]
    );
  }

  // ==================== Session Methods ====================

  /**
   * Get session history
   */
  async getSessionsData(limit = 50) {
    const rows = await this.preparedStatements.getSessions.all(limit);
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
   * Save session data
   */
  async saveSessionData(sessionData) {
    const result = await this.preparedStatements.saveSession.run(
      sessionData.prompt,
      sessionData.mode,
      sessionData.agent,
      sessionData.result,
      sessionData.tokens,
      sessionData.traceId
    );
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
