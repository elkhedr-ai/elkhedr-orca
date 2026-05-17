const Database = require('better-sqlite3');
const path = require('path');

class DatabaseManager {
  constructor() {
    // Initialize database connection
    const dbPath = '/Users/ekf/Downloads/ELKHEDR_WORKSPACE/elkhedr-orca/data/orca.db';
    this.db = new Database(dbPath);
    
    // Enable foreign key constraints
    this.db.pragma('foreign_keys = ON');
    
    // Prepare statements for better performance
    this.prepareStatements();
  }
  
  prepareStatements() {
    // Analytics statements
    this.getAnalytics = this.db.prepare(`
      SELECT 
        COALESCE(SUM(c.tokens), 0) as totalTokens,
        COALESCE(SUM(c.cost), 0) as totalCost,
        COUNT(t.id) as totalOperations
      FROM tasks t
      LEFT JOIN costs c ON t.id = c.task_id
    `);
    
    this.getAgentUsage = this.db.prepare(`
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
    this.getSessions = this.db.prepare(`
      SELECT 
        id, created_at as timestamp, prompt, mode, agent, result, tokens, traceId
      FROM sessions
      ORDER BY created_at DESC
      LIMIT ?
    `);
    
    this.saveSession = this.db.prepare(`
      INSERT INTO sessions (prompt, mode, agent, result, tokens, traceId)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    this.clearSessions = this.db.prepare(`
      DELETE FROM sessions
    `);
    
    // Input history statements
    this.getInputHistory = this.db.prepare(`
      SELECT value FROM input_history ORDER BY id DESC LIMIT 100
    `);
    
    this.saveInputHistory = this.db.prepare(`
      INSERT INTO input_history (value) VALUES (?)
    `);
    
    this.clearInputHistory = this.db.prepare(`
      DELETE FROM input_history
    `);
    
    // Agent statements (for dynamic agent management)
    this.getAgents = this.db.prepare(`
      SELECT id, name, role, model, fallbackModel, department, created_at, updated_at
      FROM agents
      ORDER BY name
    `);
    
    // For compatibility with existing agents.json structure
    this.loadAgentsFromJson = async () => {
      const fs = require('fs');
      const agentsPath = path.join(__dirname, '..', 'agents.json');
      if (fs.existsSync(agentsPath)) {
        const data = JSON.parse(fs.readFileSync(agentsPath, 'utf8'));
        // Insert or update agents from JSON
        for (const agentData of data.agents) {
          this.db.prepare(`
            INSERT OR REPLACE INTO agents (name, role, model, fallbackModel, department, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `).run(
            agentData.name,
            agentData.role,
            agentData.model,
            agentData.fallbackModel,
            agentData.department || null
          );
        }
        return data.agents.length;
      }
      return 0;
    };
  }
  
  // Analytics methods
  getAnalyticsData() {
    const row = this.getAnalytics.get();
    return {
      totalOperations: row.totalOperations,
      totalTokens: row.totalTokens,
      totalCost: row.totalCost,
      agentUsage: {}
    };
  }
  
  getAgentUsageData() {
    const rows = this.getAgentUsage.all();
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
  
  updateAnalytics(taskId, tokens, cost) {
    // Insert cost record for task
    this.db.prepare(`
      INSERT INTO costs (task_id, tokens, cost)
      VALUES (?, ?, ?)
    `).run(taskId, tokens, cost);
  }
  
  // Session methods
  getSessionsData(limit = 50) {
    const rows = this.getSessions.all(limit);
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
  
  saveSessionData(sessionData) {
    const result = this.saveSession.run(
      sessionData.prompt,
      sessionData.mode,
      sessionData.agent,
      sessionData.result,
      sessionData.tokens,
      sessionData.traceId
    );
    return result.lastInsertRowid;
  }
  
  clearSessionsData() {
    return this.clearSessions.run().changes;
  }
  
  // Input history methods
  getInputHistoryData() {
    const rows = this.getInputHistory.all();
    return rows.map(row => row.value);
  }
  
  saveInputHistoryData(value) {
    this.saveInputHistory.run(value);
    
    // Keep only last 100 entries
    const count = this.db.prepare('SELECT COUNT(*) as count FROM input_history').get().count;
    if (count > 100) {
      this.db.prepare(`
        DELETE FROM input_history 
        WHERE id NOT IN (
          SELECT id FROM input_history ORDER BY id DESC LIMIT 100
        )
      `).run();
    }
  }
  
  clearInputHistoryData() {
    return this.clearInputHistory.run().changes;
  }
  
  // Agent methods
  getAgentsData() {
    const rows = this.getAgents.all();
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      role: row.role,
      model: row.model,
      fallbackModel: row.fallbackModel,
      department: row.department
    }));
  }
  
  // Close database connection
  close() {
    this.db.close();
  }
}

// Singleton instance
let instance = null;

function getDatabaseInstance() {
  if (!instance) {
    instance = new DatabaseManager();
  }
  return instance;
}

module.exports = { getDatabaseInstance };