/**
 * Audit Logging System
 * Immutable append-only audit log with tamper-evident hash chain
 */

const crypto = require('crypto');
const { getDatabaseInstance } = require('../db');
const { getUserContext } = require('../auth/context');

// In-memory cache of the last hash for performance
let lastAuditHash = null;
let lastAuditId = null;

/**
 * Get the last audit log entry hash
 * @returns {Promise<{id: number, hash: string}|null>}
 */
async function getLastAuditEntry() {
  const db = await getDatabaseInstance();
  const rows = await db.getAdapter().query(
    'SELECT id, current_hash FROM audit_logs ORDER BY id DESC LIMIT 1'
  );

  if (rows.length === 0) return null;
  return { id: rows[0].id, hash: rows[0].current_hash };
}

/**
 * Calculate hash for audit entry
 * @param {Object} entry - Audit entry data
 * @param {string} previousHash - Previous entry's hash
 * @returns {string} SHA-256 hash
 */
function calculateHash(entry, previousHash) {
  const data = JSON.stringify({
    eventType: entry.eventType,
    userId: entry.userId,
    userRole: entry.userRole,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    action: entry.action,
    status: entry.status,
    metadata: entry.metadata,
    previousHash,
    timestamp: entry.timestamp || new Date().toISOString()
  });

  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Log an audit event
 * @param {Object} entry - Audit event data
 * @param {string} entry.eventType - Event category: 'auth', 'data', 'system', 'api_key', 'workspace'
 * @param {string} entry.action - Specific action performed
 * @param {string} entry.status - 'success' or 'failure'
 * @param {number} [entry.userId] - User who performed the action
 * @param {string} [entry.userRole] - User's role at time of action
 * @param {string} [entry.resourceType] - Type of resource affected
 * @param {string} [entry.resourceId] - ID of resource affected
 * @param {Object} [entry.metadata] - Additional contextual data
 * @param {string} [entry.ipAddress] - Client IP address
 * @param {string} [entry.userAgent] - Client user agent
 * @returns {Promise<Object>} Logged audit entry
 */
async function logAudit(entry) {
  const db = await getDatabaseInstance();

  // Get the last audit entry for hash chain
  const lastEntry = await getLastAuditEntry();
  const previousHash = lastEntry ? lastEntry.hash : 'genesis';

  // Build entry data
  const auditData = {
    eventType: entry.eventType,
    userId: entry.userId || getUserContext().userId || null,
    userRole: entry.userRole || getUserContext().userRole || null,
    resourceType: entry.resourceType || null,
    resourceId: entry.resourceId || null,
    action: entry.action,
    status: entry.status || 'success',
    ipAddress: entry.ipAddress || null,
    userAgent: entry.userAgent || null,
    metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
    timestamp: new Date().toISOString()
  };

  // Calculate hash
  const currentHash = calculateHash(auditData, previousHash);

  // Insert audit log
  const result = await db.getAdapter().execute(
    `INSERT INTO audit_logs
     (event_type, user_id, user_role, resource_type, resource_id, action, status,
      ip_address, user_agent, metadata, previous_hash, current_hash, hash_timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      auditData.eventType,
      auditData.userId,
      auditData.userRole,
      auditData.resourceType,
      auditData.resourceId,
      auditData.action,
      auditData.status,
      auditData.ipAddress,
      auditData.userAgent,
      auditData.metadata,
      previousHash,
      currentHash,
      auditData.timestamp
    ]
  );

  // Update cache
  lastAuditHash = currentHash;
  lastAuditId = result.lastInsertRowid;

  return {
    id: result.lastInsertRowid,
    ...auditData,
    previousHash,
    currentHash
  };
}

/**
 * Log authentication event
 * @param {string} action - 'login', 'logout', 'register', 'failed_login', 'password_reset', 'token_refresh'
 * @param {string} status - 'success' or 'failure'
 * @param {Object} options - Additional options
 */
async function logAuthEvent(action, status = 'success', options = {}) {
  return logAudit({
    eventType: 'auth',
    action,
    status,
    userId: options.userId,
    userRole: options.userRole,
    resourceType: 'user',
    resourceId: options.userId ? String(options.userId) : null,
    metadata: {
      method: options.method || 'email',
      reason: options.reason || null,
      provider: options.provider || null
    },
    ipAddress: options.ipAddress,
    userAgent: options.userAgent
  });
}

/**
 * Log data access event
 * @param {string} action - 'view', 'create', 'update', 'delete'
 * @param {string} resourceType - Type of resource
 * @param {string} resourceId - Resource ID
 * @param {string} status - 'success' or 'failure'
 * @param {Object} options
 */
async function logDataEvent(action, resourceType, resourceId, status = 'success', options = {}) {
  return logAudit({
    eventType: 'data',
    action,
    resourceType,
    resourceId,
    status,
    userId: options.userId,
    userRole: options.userRole,
    metadata: options.metadata || {}
  });
}

/**
 * Log API key event
 * @param {string} action - 'create', 'revoke', 'delete', 'validate'
 * @param {string} status - 'success' or 'failure'
 * @param {Object} options
 */
async function logApiKeyEvent(action, status = 'success', options = {}) {
  return logAudit({
    eventType: 'api_key',
    action,
    status,
    userId: options.userId,
    resourceType: 'api_key',
    resourceId: options.keyId || null,
    metadata: {
      keyPrefix: options.keyPrefix || null,
      scopes: options.scopes || null
    }
  });
}

/**
 * Log workspace event
 * @param {string} action - 'create', 'update', 'delete', 'member_add', 'member_remove'
 * @param {string} status - 'success' or 'failure'
 * @param {Object} options
 */
async function logWorkspaceEvent(action, status = 'success', options = {}) {
  return logAudit({
    eventType: 'workspace',
    action,
    status,
    userId: options.userId,
    resourceType: 'workspace',
    resourceId: options.workspaceId ? String(options.workspaceId) : null,
    metadata: {
      workspaceName: options.workspaceName || null,
      targetUserId: options.targetUserId || null,
      memberRole: options.memberRole || null
    }
  });
}

/**
 * Log system event
 * @param {string} action - 'config_change', 'backup', 'shutdown', 'startup'
 * @param {string} status - 'success' or 'failure'
 * @param {Object} options
 */
async function logSystemEvent(action, status = 'success', options = {}) {
  return logAudit({
    eventType: 'system',
    action,
    status,
    userId: options.userId,
    resourceType: 'system',
    metadata: options.metadata || {}
  });
}

/**
 * Verify audit log integrity
 * Checks hash chain from genesis to most recent entry
 * @returns {Promise<Object>} { valid: boolean, lastValidId: number|null, errors: string[] }
 */
async function verifyAuditLog() {
  const db = await getDatabaseInstance();
  const entries = await db.getAdapter().query(
    'SELECT * FROM audit_logs ORDER BY id ASC'
  );

  if (entries.length === 0) {
    return { valid: true, lastValidId: null, errors: [] };
  }

  const errors = [];
  let previousHash = 'genesis';

  for (const entry of entries) {
    const auditData = {
      eventType: entry.event_type,
      userId: entry.user_id,
      userRole: entry.user_role,
      resourceType: entry.resource_type,
      resourceId: entry.resource_id,
      action: entry.action,
      status: entry.status,
      metadata: entry.metadata ? JSON.stringify(JSON.parse(entry.metadata)) : null,
      timestamp: entry.hash_timestamp || entry.created_at
    };

    const expectedHash = calculateHash(auditData, previousHash);

    if (entry.previous_hash !== previousHash) {
      errors.push(`Entry ${entry.id}: Previous hash mismatch`);
    }

    if (entry.current_hash !== expectedHash) {
      errors.push(`Entry ${entry.id}: Hash mismatch (tampered?)`);
    }

    previousHash = entry.current_hash;
  }

  return {
    valid: errors.length === 0,
    lastValidId: errors.length > 0 ? null : entries[entries.length - 1].id,
    errors
  };
}

/**
 * Get audit logs with filtering
 * @param {Object} filters - { eventType?, userId?, resourceType?, action?, status?, startDate?, endDate?, limit? }
 * @returns {Promise<Array>}
 */
async function getAuditLogs(filters = {}) {
  const db = await getDatabaseInstance();

  let sql = 'SELECT * FROM audit_logs WHERE 1=1';
  const params = [];

  if (filters.eventType) {
    sql += ' AND event_type = ?';
    params.push(filters.eventType);
  }
  if (filters.userId) {
    sql += ' AND user_id = ?';
    params.push(filters.userId);
  }
  if (filters.resourceType) {
    sql += ' AND resource_type = ?';
    params.push(filters.resourceType);
  }
  if (filters.action) {
    sql += ' AND action = ?';
    params.push(filters.action);
  }
  if (filters.status) {
    sql += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters.startDate) {
    sql += ' AND created_at >= ?';
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    sql += ' AND created_at <= ?';
    params.push(filters.endDate);
  }

  sql += ' ORDER BY id DESC';

  const limit = filters.limit || 100;
  sql += ' LIMIT ?';
  params.push(limit);

  const rows = await db.getAdapter().query(sql, params);

  return rows.map(row => ({
    id: row.id,
    eventType: row.event_type,
    userId: row.user_id,
    userRole: row.user_role,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    action: row.action,
    status: row.status,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    previousHash: row.previous_hash,
    currentHash: row.current_hash,
    createdAt: row.created_at
  }));
}

/**
 * Export audit logs for admin review
 * @param {Object} filters
 * @returns {Promise<string>} JSON string of audit logs
 */
async function exportAuditLogs(filters = {}) {
  const logs = await getAuditLogs({ ...filters, limit: 10000 });

  const exportData = {
    exportedAt: new Date().toISOString(),
    totalEntries: logs.length,
    logs
  };

  return JSON.stringify(exportData, null, 2);
}

/**
 * Get audit statistics
 * @param {Object} filters - { startDate?, endDate? }
 * @returns {Promise<Object>}
 */
async function getAuditStats(filters = {}) {
  const db = await getDatabaseInstance();

  let sql = 'SELECT COUNT(*) as total';
  const params = [];

  if (filters.startDate) {
    sql += ' AND created_at >= ?';
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    sql += ' AND created_at <= ?';
    params.push(filters.endDate);
  }

  const totalResult = await db.getAdapter().query(sql + ' FROM audit_logs', params);

  const byType = await db.getAdapter().query(
    `SELECT event_type, COUNT(*) as count FROM audit_logs
     ${filters.startDate ? 'WHERE created_at >= ?' : ''}
     ${filters.endDate ? (filters.startDate ? 'AND' : 'WHERE') + ' created_at <= ?' : ''}
     GROUP BY event_type`,
    params
  );

  const byStatus = await db.getAdapter().query(
    `SELECT status, COUNT(*) as count FROM audit_logs
     ${filters.startDate ? 'WHERE created_at >= ?' : ''}
     ${filters.endDate ? (filters.startDate ? 'AND' : 'WHERE') + ' created_at <= ?' : ''}
     GROUP BY status`,
    params
  );

  return {
    total: totalResult[0].total,
    byType: Object.fromEntries(byType.map(r => [r.event_type, r.count])),
    byStatus: Object.fromEntries(byStatus.map(r => [r.status, r.count]))
  };
}

module.exports = {
  logAudit,
  logAuthEvent,
  logDataEvent,
  logApiKeyEvent,
  logWorkspaceEvent,
  logSystemEvent,
  verifyAuditLog,
  getAuditLogs,
  exportAuditLogs,
  getAuditStats,
  calculateHash
};
