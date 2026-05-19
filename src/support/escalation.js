/**
 * Escalation Workflows
 * Automatic escalation based on SLA violations and priority.
 */

const { logger } = require('../utils/logger.js');
const { getDatabaseInstance } = require('../db');
const { SLA_TIERS, TICKET_STATUS, TICKET_PRIORITY } = require('./sla.js');

const ESCALATION_RULES = {
  // Critical: escalate after 50% of response time
  critical: {
    responseThresholdPercent: 50,
    resolutionThresholdPercent: 50,
    maxLevel: 3,
    autoAssign: true
  },
  // High: escalate after 75% of response time
  high: {
    responseThresholdPercent: 75,
    resolutionThresholdPercent: 75,
    maxLevel: 2,
    autoAssign: true
  },
  // Medium: escalate after 90% of response time
  medium: {
    responseThresholdPercent: 90,
    resolutionThresholdPercent: 90,
    maxLevel: 1,
    autoAssign: false
  },
  // Low: no auto-escalation
  low: {
    responseThresholdPercent: 100,
    resolutionThresholdPercent: 100,
    maxLevel: 0,
    autoAssign: false
  }
};

const ESCALATION_TARGETS = {
  // Level 1: Team lead
  1: { role: 'support_lead', notify: true },
  // Level 2: Manager
  2: { role: 'support_manager', notify: true },
  // Level 3: Director/VP
  3: { role: 'support_director', notify: true }
};

class EscalationManager {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS escalation_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER NOT NULL,
        from_level INTEGER NOT NULL DEFAULT 0,
        to_level INTEGER NOT NULL,
        reason TEXT NOT NULL,
        escalated_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
      )
    `);

    this.initialized = true;
    logger.info('Escalation manager initialized');
  }

  /**
   * Check and process escalations for open tickets
   */
  async processEscalations() {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const now = new Date();

    // Get all open/in-progress tickets that haven't been fully escalated
    const tickets = await adapter.execute(
      `SELECT * FROM support_tickets
       WHERE status IN ('open', 'in_progress', 'waiting')
       AND escalation_level < 3`,
      []
    );

    const ticketList = Array.isArray(tickets) ? tickets : (tickets.rows || []);
    let escalatedCount = 0;

    for (const ticket of ticketList) {
      const rule = ESCALATION_RULES[ticket.priority] || ESCALATION_RULES.medium;
      const tier = SLA_TIERS[(ticket.sla_tier || 'basic').toUpperCase()] || SLA_TIERS.BASIC;

      const created = new Date(ticket.created_at);
      const elapsedMinutes = (now.getTime() - created.getTime()) / 60000;

      let shouldEscalate = false;
      let reason = '';

      // Check response time threshold
      if (!ticket.first_response_at) {
        const responseThreshold = tier.responseTimeMinutes * (rule.responseThresholdPercent / 100);
        if (elapsedMinutes > responseThreshold && ticket.escalation_level < rule.maxLevel) {
          shouldEscalate = true;
          reason = `No first response after ${Math.round(elapsedMinutes)} minutes (threshold: ${Math.round(responseThreshold)} minutes)`;
        }
      }

      // Check resolution time threshold
      if (!ticket.resolved_at) {
        const resolutionThreshold = tier.resolutionTimeMinutes * (rule.resolutionThresholdPercent / 100);
        if (elapsedMinutes > resolutionThreshold && ticket.escalation_level < rule.maxLevel) {
          shouldEscalate = true;
          reason = `Not resolved after ${Math.round(elapsedMinutes)} minutes (threshold: ${Math.round(resolutionThreshold)} minutes)`;
        }
      }

      if (shouldEscalate) {
        const newLevel = Math.min(ticket.escalation_level + 1, rule.maxLevel);

        // Update ticket
        await adapter.execute(
          `UPDATE support_tickets
           SET escalation_level = ?, status = 'escalated', escalated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [newLevel, ticket.id]
        );

        // Record escalation
        await adapter.execute(
          `INSERT INTO escalation_history (ticket_id, from_level, to_level, reason, escalated_by)
           VALUES (?, ?, ?, ?, 'system')`,
          [ticket.id, ticket.escalation_level, newLevel, reason]
        );

        logger.info({
          ticketId: ticket.id,
          fromLevel: ticket.escalation_level,
          toLevel: newLevel,
          reason
        }, 'Ticket escalated');

        escalatedCount++;
      }
    }

    return { escalatedCount, checkedCount: ticketList.length };
  }

  /**
   * Manual escalation by a user
   */
  async escalateTicket(ticketId, userId, reason, targetLevel) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const ticket = await adapter.execute(
      'SELECT * FROM support_tickets WHERE id = ?',
      [ticketId]
    );

    const ticketRow = Array.isArray(ticket) ? ticket[0] : (ticket.rows ? ticket.rows[0] : null);
    if (!ticketRow) return { success: false, error: 'Ticket not found' };

    const rule = ESCALATION_RULES[ticketRow.priority] || ESCALATION_RULES.medium;
    const newLevel = targetLevel || Math.min(ticketRow.escalation_level + 1, rule.maxLevel);

    if (newLevel <= ticketRow.escalation_level) {
      return { success: false, error: 'Cannot de-escalate or already at this level' };
    }

    await adapter.execute(
      `UPDATE support_tickets
       SET escalation_level = ?, status = 'escalated', escalated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newLevel, ticketId]
    );

    await adapter.execute(
      `INSERT INTO escalation_history (ticket_id, from_level, to_level, reason, escalated_by)
       VALUES (?, ?, ?, ?, ?)`,
      [ticketId, ticketRow.escalation_level, newLevel, reason, String(userId)]
    );

    logger.info({ ticketId, fromLevel: ticketRow.escalation_level, toLevel: newLevel, userId }, 'Ticket manually escalated');

    return { success: true, newLevel };
  }

  /**
   * Get escalation history for a ticket
   */
  async getEscalationHistory(ticketId) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const rows = await adapter.execute(
      'SELECT * FROM escalation_history WHERE ticket_id = ? ORDER BY created_at',
      [ticketId]
    );

    const history = Array.isArray(rows) ? rows : (rows.rows || []);
    return history.map(row => ({
      id: row.id,
      ticketId: row.ticket_id,
      fromLevel: row.from_level,
      toLevel: row.to_level,
      reason: row.reason,
      escalatedBy: row.escalated_by,
      createdAt: row.created_at
    }));
  }
}

let instance = null;

function getEscalationManager() {
  if (!instance) {
    instance = new EscalationManager();
  }
  return instance;
}

function resetEscalationManager() {
  instance = null;
}

module.exports = {
  EscalationManager,
  getEscalationManager,
  resetEscalationManager,
  ESCALATION_RULES,
  ESCALATION_TARGETS
};
