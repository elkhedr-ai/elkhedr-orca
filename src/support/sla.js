/**
 * SLA & Support System
 * Service level agreements, priority queue, and escalation workflows.
 */

const { logger } = require('../utils/logger.js');
const { getDatabaseInstance } = require('../db');

const SLA_TIERS = {
  BASIC: {
    name: 'basic',
    responseTimeMinutes: 1440, // 24 hours
    resolutionTimeMinutes: 4320, // 72 hours
    uptimePercent: 99.0,
    supportHours: 'business'
  },
  PRO: {
    name: 'pro',
    responseTimeMinutes: 240, // 4 hours
    resolutionTimeMinutes: 1440, // 24 hours
    uptimePercent: 99.5,
    supportHours: 'extended'
  },
  ENTERPRISE: {
    name: 'enterprise',
    responseTimeMinutes: 60, // 1 hour
    resolutionTimeMinutes: 480, // 8 hours
    uptimePercent: 99.9,
    supportHours: '24x7'
  }
};

const TICKET_STATUS = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  WAITING: 'waiting',
  ESCALATED: 'escalated',
  RESOLVED: 'resolved',
  CLOSED: 'closed'
};

const TICKET_PRIORITY = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

class SLAManager {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id INTEGER,
        user_id INTEGER NOT NULL,
        subject TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        priority TEXT NOT NULL DEFAULT 'medium',
        category TEXT,
        assigned_to TEXT,
        sla_tier TEXT,
        response_due_at DATETIME,
        resolution_due_at DATETIME,
        first_response_at DATETIME,
        resolved_at DATETIME,
        escalated_at DATETIME,
        escalation_level INTEGER DEFAULT 0,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS support_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        is_internal INTEGER NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
      )
    `);

    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS sla_violations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        org_id INTEGER,
        violation_type TEXT NOT NULL,
        expected_minutes INTEGER,
        actual_minutes INTEGER,
        severity TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
      )
    `);

    await adapter.execute(`
      CREATE INDEX IF NOT EXISTS idx_tickets_org_id ON support_tickets(org_id)
    `);
    await adapter.execute(`
      CREATE INDEX IF NOT EXISTS idx_tickets_status ON support_tickets(status)
    `);
    await adapter.execute(`
      CREATE INDEX IF NOT EXISTS idx_tickets_priority ON support_tickets(priority)
    `);
    await adapter.execute(`
      CREATE INDEX IF NOT EXISTS idx_sla_violations_org_id ON sla_violations(org_id)
    `);

    this.initialized = true;
    logger.info('SLA manager initialized');
  }

  // ── Tickets ──────────────────────────────────────────────────────────────

  async createTicket(userId, config) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const tier = SLA_TIERS[(config.slaTier || 'basic').toUpperCase()] || SLA_TIERS.BASIC;
    const now = new Date();

    const responseDue = new Date(now.getTime() + tier.responseTimeMinutes * 60000);
    const resolutionDue = new Date(now.getTime() + tier.resolutionTimeMinutes * 60000);

    const result = await adapter.execute(
      `INSERT INTO support_tickets (org_id, user_id, subject, description, priority, category, sla_tier, response_due_at, resolution_due_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        config.orgId || null,
        userId,
        config.subject,
        config.description || null,
        config.priority || 'medium',
        config.category || null,
        tier.name,
        responseDue.toISOString(),
        resolutionDue.toISOString()
      ]
    );

    const ticketId = result.lastInsertRowid || result.insertId;
    logger.info({ ticketId, userId, priority: config.priority }, 'Support ticket created');

    return this.getTicket(ticketId);
  }

  async getTicket(ticketId) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const rows = await adapter.execute(
      'SELECT * FROM support_tickets WHERE id = ?',
      [ticketId]
    );

    const row = Array.isArray(rows) ? rows[0] : (rows.rows ? rows.rows[0] : null);
    if (!row) return null;

    return this._formatTicket(row);
  }

  async listTickets(options = {}) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    let sql = 'SELECT * FROM support_tickets WHERE 1=1';
    const params = [];

    if (options.orgId) { sql += ' AND org_id = ?'; params.push(options.orgId); }
    if (options.userId) { sql += ' AND user_id = ?'; params.push(options.userId); }
    if (options.status) { sql += ' AND status = ?'; params.push(options.status); }
    if (options.priority) { sql += ' AND priority = ?'; params.push(options.priority); }

    // Priority ordering: critical > high > medium > low
    sql += ` ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at DESC`;
    sql += ' LIMIT ?';
    params.push(options.limit || 50);

    const rows = await adapter.execute(sql, params);
    const tickets = Array.isArray(rows) ? rows : (rows.rows || []);
    return tickets.map(row => this._formatTicket(row));
  }

  async updateTicket(ticketId, updates) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const fields = [];
    const values = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);

      if (updates.status === TICKET_STATUS.RESOLVED) {
        fields.push('resolved_at = CURRENT_TIMESTAMP');
      }
      if (updates.status === TICKET_STATUS.IN_PROGRESS && !updates.assignedTo) {
        // Auto-set first response if not already set
        const ticket = await this.getTicket(ticketId);
        if (ticket && !ticket.firstResponseAt) {
          fields.push('first_response_at = CURRENT_TIMESTAMP');
        }
      }
    }
    if (updates.priority !== undefined) { fields.push('priority = ?'); values.push(updates.priority); }
    if (updates.assignedTo !== undefined) {
      fields.push('assigned_to = ?');
      values.push(updates.assignedTo);
      if (!updates.status) {
        fields.push('status = ?');
        values.push(TICKET_STATUS.IN_PROGRESS);
        fields.push('first_response_at = CURRENT_TIMESTAMP');
      }
    }
    if (updates.category !== undefined) { fields.push('category = ?'); values.push(updates.category); }

    if (fields.length === 0) return this.getTicket(ticketId);

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(ticketId);

    await adapter.execute(
      `UPDATE support_tickets SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    return this.getTicket(ticketId);
  }

  async addComment(ticketId, userId, content, isInternal = false) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const result = await adapter.execute(
      `INSERT INTO support_comments (ticket_id, user_id, content, is_internal) VALUES (?, ?, ?, ?)`,
      [ticketId, userId, content, isInternal ? 1 : 0]
    );

    // Auto-set first response if this is the first staff comment
    if (!isInternal) {
      const ticket = await this.getTicket(ticketId);
      if (ticket && !ticket.firstResponseAt) {
        await adapter.execute(
          'UPDATE support_tickets SET first_response_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [ticketId]
        );
      }
    }

    return { id: result.lastInsertRowid || result.insertId, ticketId, userId, content, isInternal };
  }

  async getComments(ticketId) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const rows = await adapter.execute(
      'SELECT * FROM support_comments WHERE ticket_id = ? ORDER BY created_at',
      [ticketId]
    );

    const comments = Array.isArray(rows) ? rows : (rows.rows || []);
    return comments.map(row => ({
      id: row.id,
      ticketId: row.ticket_id,
      userId: row.user_id,
      content: row.content,
      isInternal: !!row.is_internal,
      createdAt: row.created_at
    }));
  }

  // ── SLA Monitoring ───────────────────────────────────────────────────────

  async checkSLAViolations() {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const now = new Date().toISOString();

    // Find tickets with breached response time
    const responseBreaches = await adapter.execute(
      `SELECT * FROM support_tickets
       WHERE status IN ('open', 'escalated')
       AND response_due_at < ?
       AND first_response_at IS NULL`,
      [now]
    );

    const responseList = Array.isArray(responseBreaches) ? responseBreaches : (responseBreaches.rows || []);

    for (const ticket of responseList) {
      await adapter.execute(
        `INSERT INTO sla_violations (ticket_id, org_id, violation_type, expected_minutes, actual_minutes, severity)
         VALUES (?, ?, 'response_time', ?, ?, ?)`,
        [
          ticket.id,
          ticket.org_id,
          SLA_TIERS[(ticket.sla_tier || 'basic').toUpperCase()]?.responseTimeMinutes || 1440,
          Math.floor((Date.now() - new Date(ticket.created_at).getTime()) / 60000),
          ticket.priority === 'critical' ? 'critical' : 'high'
        ]
      );
    }

    // Find tickets with breached resolution time
    const resolutionBreaches = await adapter.execute(
      `SELECT * FROM support_tickets
       WHERE status IN ('open', 'in_progress', 'waiting', 'escalated')
       AND resolution_due_at < ?`,
      [now]
    );

    const resolutionList = Array.isArray(resolutionBreaches) ? resolutionBreaches : (resolutionBreaches.rows || []);

    for (const ticket of resolutionList) {
      await adapter.execute(
        `INSERT INTO sla_violations (ticket_id, org_id, violation_type, expected_minutes, actual_minutes, severity)
         VALUES (?, ?, 'resolution_time', ?, ?, ?)`,
        [
          ticket.id,
          ticket.org_id,
          SLA_TIERS[(ticket.sla_tier || 'basic').toUpperCase()]?.resolutionTimeMinutes || 4320,
          Math.floor((Date.now() - new Date(ticket.created_at).getTime()) / 60000),
          'high'
        ]
      );
    }

    return {
      responseBreaches: responseList.length,
      resolutionBreaches: resolutionList.length
    };
  }

  async getViolations(orgId, options = {}) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const limit = options.limit || 50;
    const rows = await adapter.execute(
      'SELECT * FROM sla_violations WHERE org_id = ? ORDER BY created_at DESC LIMIT ?',
      [orgId, limit]
    );

    const violations = Array.isArray(rows) ? rows : (rows.rows || []);
    return violations.map(row => ({
      id: row.id,
      ticketId: row.ticket_id,
      violationType: row.violation_type,
      expectedMinutes: row.expected_minutes,
      actualMinutes: row.actual_minutes,
      severity: row.severity,
      createdAt: row.created_at
    }));
  }

  // ── Stats ────────────────────────────────────────────────────────────────

  async getStats(orgId) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const statusCounts = await adapter.execute(
      `SELECT status, COUNT(*) as count FROM support_tickets WHERE org_id = ? GROUP BY status`,
      [orgId]
    );

    const priorityCounts = await adapter.execute(
      `SELECT priority, COUNT(*) as count FROM support_tickets WHERE org_id = ? GROUP BY priority`,
      [orgId]
    );

    const violationCount = await adapter.execute(
      `SELECT COUNT(*) as count FROM sla_violations WHERE org_id = ? AND created_at > datetime('now', '-30 days')`,
      [orgId]
    );

    const avgResponseTime = await adapter.execute(
      `SELECT AVG(CASE WHEN first_response_at IS NOT NULL
         THEN (julianday(first_response_at) - julianday(created_at)) * 24 * 60
         ELSE NULL END) as avg_minutes
       FROM support_tickets WHERE org_id = ? AND created_at > datetime('now', '-30 days')`,
      [orgId]
    );

    const byStatus = Array.isArray(statusCounts) ? statusCounts : (statusCounts.rows || []);
    const byPriority = Array.isArray(priorityCounts) ? priorityCounts : (priorityCounts.rows || []);
    const vCount = Array.isArray(violationCount) ? violationCount[0] : (violationCount.rows?.[0] || { count: 0 });
    const avgResp = Array.isArray(avgResponseTime) ? avgResponseTime[0] : (avgResponseTime.rows?.[0] || { avg_minutes: 0 });

    return {
      byStatus: Object.fromEntries(byStatus.map(r => [r.status, r.count])),
      byPriority: Object.fromEntries(byPriority.map(r => [r.priority, r.count])),
      violationsLast30Days: vCount.count,
      avgResponseTimeMinutes: Math.round(avgResp.avg_minutes || 0)
    };
  }

  _formatTicket(row) {
    return {
      id: row.id,
      orgId: row.org_id,
      userId: row.user_id,
      subject: row.subject,
      description: row.description,
      status: row.status,
      priority: row.priority,
      category: row.category,
      assignedTo: row.assigned_to,
      slaTier: row.sla_tier,
      responseDueAt: row.response_due_at,
      resolutionDueAt: row.resolution_due_at,
      firstResponseAt: row.first_response_at,
      resolvedAt: row.resolved_at,
      escalatedAt: row.escalated_at,
      escalationLevel: row.escalation_level,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

let instance = null;

function getSLAManager() {
  if (!instance) {
    instance = new SLAManager();
  }
  return instance;
}

function resetSLAManager() {
  instance = null;
}

module.exports = {
  SLAManager,
  getSLAManager,
  resetSLAManager,
  SLA_TIERS,
  TICKET_STATUS,
  TICKET_PRIORITY
};
