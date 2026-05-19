/**
 * Usage Quotas & Billing
 * Track credits per user/team/workspace. Enforce limits with warnings.
 */

const { getDatabaseInstance } = require('../db');
const { logger } = require('../utils/logger.js');

const WARNING_THRESHOLD = 0.8; // 80%

function getQuotaDefaults() {
  try {
    const { getConfig } = require('../config/index.js');
    const cfg = getConfig();
    return {
      tokensLimit: parseInt(cfg.ORCA_QUOTA_DEFAULT_TOKENS_LIMIT, 10) || 1000000,
      operationsLimit: parseInt(cfg.ORCA_QUOTA_DEFAULT_OPS_LIMIT, 10) || 1000,
      costLimit: parseFloat(cfg.ORCA_QUOTA_DEFAULT_COST_LIMIT) || 10.0,
      resetPeriod: cfg.ORCA_QUOTA_RESET_PERIOD || 'monthly',
      enforcement: cfg.ORCA_QUOTA_ENFORCEMENT !== 'false'
    };
  } catch {
    return {
      tokensLimit: 1000000,
      operationsLimit: 1000,
      costLimit: 10.0,
      resetPeriod: 'monthly',
      enforcement: true
    };
  }
}

class QuotaManager {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    const db = await getDatabaseInstance();

    // Quotas table
    await db.getAdapter().execute(`
      CREATE TABLE IF NOT EXISTS quotas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        workspace_id INTEGER,
        quota_type TEXT NOT NULL DEFAULT 'user' CHECK (quota_type IN ('user', 'workspace', 'team')),
        tokens_limit INTEGER NOT NULL DEFAULT 1000,
        tokens_used INTEGER NOT NULL DEFAULT 0,
        operations_limit INTEGER NOT NULL DEFAULT 100,
        operations_used INTEGER NOT NULL DEFAULT 0,
        cost_limit REAL NOT NULL DEFAULT 10.0,
        cost_used REAL NOT NULL DEFAULT 0.0,
        reset_period TEXT NOT NULL DEFAULT 'monthly' CHECK (reset_period IN ('daily', 'weekly', 'monthly')),
        last_reset DATETIME DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      )
    `);

    // Usage log for tracking
    await db.getAdapter().execute(`
      CREATE TABLE IF NOT EXISTS usage_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        workspace_id INTEGER,
        operation_type TEXT NOT NULL,
        tokens INTEGER NOT NULL DEFAULT 0,
        cost REAL NOT NULL DEFAULT 0.0,
        model TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    this.initialized = true;
    logger.info('Quota manager initialized');
  }

  /**
   * Get or create quota for user
   */
  async getUserQuota(userId) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const rows = await db.getAdapter().query(
      "SELECT * FROM quotas WHERE user_id = ? AND quota_type = 'user'",
      [userId]
    );

    if (rows.length === 0) {
      // Create default quota from config
      const defaults = getQuotaDefaults();
      await db.getAdapter().execute(
        "INSERT INTO quotas (user_id, quota_type, tokens_limit, operations_limit, cost_limit, reset_period) VALUES (?, 'user', ?, ?, ?, ?)",
        [userId, defaults.tokensLimit, defaults.operationsLimit, defaults.costLimit, defaults.resetPeriod]
      );
      return this.getUserQuota(userId);
    }

    return this.formatQuota(rows[0]);
  }

  /**
   * Format quota row
   */
  formatQuota(row) {
    const tokensPercent = row.tokens_limit > 0 ? row.tokens_used / row.tokens_limit : 0;
    const opsPercent = row.operations_limit > 0 ? row.operations_used / row.operations_limit : 0;
    const costPercent = row.cost_limit > 0 ? row.cost_used / row.cost_limit : 0;

    return {
      id: row.id,
      userId: row.user_id,
      workspaceId: row.workspace_id,
      type: row.quota_type,
      limits: {
        tokens: row.tokens_limit,
        operations: row.operations_limit,
        cost: row.cost_limit
      },
      used: {
        tokens: row.tokens_used,
        operations: row.operations_used,
        cost: row.cost_used
      },
      remaining: {
        tokens: Math.max(0, row.tokens_limit - row.tokens_used),
        operations: Math.max(0, row.operations_limit - row.operations_used),
        cost: Math.max(0, row.cost_limit - row.cost_used)
      },
      percentages: {
        tokens: tokensPercent,
        operations: opsPercent,
        cost: costPercent
      },
      highestPercent: Math.max(tokensPercent, opsPercent, costPercent),
      status: tokensPercent >= 1 || opsPercent >= 1 || costPercent >= 1 ? 'exceeded' :
              tokensPercent >= WARNING_THRESHOLD || opsPercent >= WARNING_THRESHOLD || costPercent >= WARNING_THRESHOLD ? 'warning' : 'ok'
    };
  }

  /**
   * Track usage
   */
  async trackUsage(userId, options = {}) {
    await this.initialize();
    const { workspaceId, tokens = 0, cost = 0, operationType = 'agent_call', model } = options;
    const db = await getDatabaseInstance();

    // Log usage
    await db.getAdapter().execute(
      'INSERT INTO usage_logs (user_id, workspace_id, operation_type, tokens, cost, model) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, workspaceId || null, operationType, tokens, cost, model || null]
    );

    // Update quotas
    const quotas = await db.getAdapter().query(
      "SELECT id FROM quotas WHERE user_id = ? AND quota_type = 'user'",
      [userId]
    );

    if (quotas.length > 0) {
      await db.getAdapter().execute(
        `UPDATE quotas SET
          tokens_used = tokens_used + ?,
          operations_used = operations_used + 1,
          cost_used = cost_used + ?
        WHERE id = ?`,
        [tokens, cost, quotas[0].id]
      );
    }

    // Check quota status
    const quota = await this.getUserQuota(userId);
    return quota;
  }

  /**
   * Check if operation is allowed
   */
  async checkQuota(userId, options = {}) {
    const { requireTokens = 0, requireCost = 0, adminOverride = false } = options;

    // Admin override — explicit or via user context
    if (adminOverride) return { allowed: true, quota: null };

    // Auto-detect admin from auth context
    try {
      const { getUserContext } = require('../auth/context.js');
      const ctx = getUserContext();
      if (ctx && ctx.userRole === 'admin') {
        return { allowed: true, quota: null };
      }
    } catch { /* auth context not available */ }

    // Check if enforcement is disabled
    const defaults = getQuotaDefaults();
    if (!defaults.enforcement) {
      const quota = await this.getUserQuota(userId);
      return { allowed: true, quota };
    }

    const quota = await this.getUserQuota(userId);

    if (quota.status === 'exceeded') {
      return {
        allowed: false,
        quota,
        reason: 'Quota exceeded. Contact admin for additional credits.',
        limitReached: true
      };
    }

    if (quota.remaining.tokens < requireTokens) {
      return {
        allowed: false,
        quota,
        reason: `Insufficient token quota. Need ${requireTokens}, have ${quota.remaining.tokens}.`,
        limitReached: true
      };
    }

    if (quota.remaining.cost < requireCost) {
      return {
        allowed: false,
        quota,
        reason: `Insufficient cost quota. Need $${requireCost.toFixed(4)}, have $${quota.remaining.cost.toFixed(4)}.`,
        limitReached: true
      };
    }

    return { allowed: true, quota };
  }

  /**
   * Get warning if approaching limit
   */
  async getWarning(userId) {
    const quota = await this.getUserQuota(userId);
    if (quota.status === 'warning') {
      return {
        warning: true,
        message: `Warning: You have used ${(quota.highestPercent * 100).toFixed(0)}% of your quota.`,
        quota
      };
    }
    return { warning: false };
  }

  /**
   * Update quota (admin only)
   */
  async updateQuota(quotaId, updates) {
    const db = await getDatabaseInstance();
    const fields = [];
    const values = [];

    if (updates.tokensLimit !== undefined) { fields.push('tokens_limit = ?'); values.push(updates.tokensLimit); }
    if (updates.operationsLimit !== undefined) { fields.push('operations_limit = ?'); values.push(updates.operationsLimit); }
    if (updates.costLimit !== undefined) { fields.push('cost_limit = ?'); values.push(updates.costLimit); }

    if (fields.length === 0) throw new Error('No fields to update');

    values.push(quotaId);
    await db.getAdapter().execute(
      `UPDATE quotas SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    return { updated: true };
  }

  /**
   * Reset quota usage
   */
  async resetQuota(quotaId) {
    const db = await getDatabaseInstance();
    await db.getAdapter().execute(
      'UPDATE quotas SET tokens_used = 0, operations_used = 0, cost_used = 0.0, last_reset = CURRENT_TIMESTAMP WHERE id = ?',
      [quotaId]
    );
    return { reset: true };
  }

  /**
   * Get usage analytics
   */
  async getUsageStats(userId, days = 30) {
    const db = await getDatabaseInstance();
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const rows = await db.getAdapter().query(
      `SELECT
        DATE(created_at) as date,
        COUNT(*) as operations,
        SUM(tokens) as tokens,
        SUM(cost) as cost
      FROM usage_logs
      WHERE user_id = ? AND created_at > ?
      GROUP BY DATE(created_at)
      ORDER BY date DESC`,
      [userId, since]
    );

    return rows;
  }
}

// Singleton
let instance = null;
function getQuotaManager() {
  if (!instance) {
    instance = new QuotaManager();
  }
  return instance;
}

module.exports = {
  QuotaManager,
  getQuotaManager,
  getQuotaDefaults,
  WARNING_THRESHOLD
};
