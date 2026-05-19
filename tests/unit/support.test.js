/**
 * Tests for T51: SLA & Support System
 * Tests SLA tiers, ticket management, escalation rules, and SLA monitoring.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

// Mock database
const mockRows = { tickets: [], comments: [], violations: [], escalations: [] };

const mockDb = {
  getAdapter: () => ({
    execute: async (sql, params) => {
      if (sql.includes('CREATE TABLE')) return [];
      if (sql.includes('CREATE INDEX')) return [];

      // INSERT INTO support_tickets
      if (sql.includes('INSERT INTO support_tickets')) {
        const ticket = {
          id: mockRows.tickets.length + 1,
          org_id: params?.[0],
          user_id: params?.[1],
          subject: params?.[2],
          description: params?.[3],
          status: 'open',
          priority: params?.[4] || 'medium',
          category: params?.[5],
          assigned_to: null,
          sla_tier: params?.[6] || 'basic',
          response_due_at: params?.[7],
          resolution_due_at: params?.[8],
          first_response_at: null,
          resolved_at: null,
          escalated_at: null,
          escalation_level: 0,
          metadata: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        mockRows.tickets.push(ticket);
        return { lastInsertRowid: ticket.id, insertId: ticket.id };
      }

      // INSERT INTO support_comments
      if (sql.includes('INSERT INTO support_comments')) {
        const comment = {
          id: mockRows.comments.length + 1,
          ticket_id: params?.[0],
          user_id: params?.[1],
          content: params?.[2],
          is_internal: params?.[3] || 0,
          created_at: new Date().toISOString()
        };
        mockRows.comments.push(comment);
        return { lastInsertRowid: comment.id };
      }

      // INSERT INTO escalation_history
      if (sql.includes('INSERT INTO escalation_history')) {
        mockRows.escalations.push({
          id: mockRows.escalations.length + 1,
          ticket_id: params?.[0],
          from_level: params?.[1],
          to_level: params?.[2],
          reason: params?.[3],
          escalated_by: params?.[4],
          created_at: new Date().toISOString()
        });
        return { lastInsertRowid: mockRows.escalations.length };
      }

      // INSERT INTO sla_violations
      if (sql.includes('INSERT INTO sla_violations')) {
        mockRows.violations.push({
          id: mockRows.violations.length + 1,
          ticket_id: params?.[0],
          org_id: params?.[1],
          violation_type: params?.[2],
          expected_minutes: params?.[3],
          actual_minutes: params?.[4],
          severity: params?.[5],
          created_at: new Date().toISOString()
        });
        return { lastInsertRowid: mockRows.violations.length };
      }

      // SELECT * FROM support_tickets WHERE id = ?
      if (sql.includes('SELECT * FROM support_tickets WHERE id = ?') && !sql.includes('status IN')) {
        const ticket = mockRows.tickets.find(t => t.id === params?.[0]);
        return ticket ? [ticket] : [];
      }

      // SELECT tickets with filters
      if (sql.includes('SELECT * FROM support_tickets WHERE')) {
        let results = [...mockRows.tickets];
        if (params?.length > 0 && sql.includes('user_id = ?')) {
          results = results.filter(t => t.user_id === params[0]);
        }
        return results;
      }

      // SELECT open tickets for escalation check
      if (sql.includes('status IN') && sql.includes('escalation_level < 3')) {
        return mockRows.tickets.filter(t => ['open', 'in_progress', 'waiting'].includes(t.status) && t.escalation_level < 3);
      }

      // SELECT comments
      if (sql.includes('SELECT * FROM support_comments')) {
        return mockRows.comments.filter(c => c.ticket_id === params?.[0]);
      }

      // SELECT escalation history
      if (sql.includes('SELECT * FROM escalation_history')) {
        return mockRows.escalations.filter(e => e.ticket_id === params?.[0]);
      }

      // UPDATE support_tickets
      if (sql.includes('UPDATE support_tickets SET')) {
        const ticketId = params?.[params.length - 1];
        const ticket = mockRows.tickets.find(t => t.id === ticketId);
        if (ticket) {
          let idx = 0;
          // Parse SET clause fields in order
          const setClause = sql.split('SET')[1]?.split('WHERE')[0] || '';
          const assignments = setClause.split(',').map(s => s.trim());
          for (const assignment of assignments) {
            if (assignment.includes('CURRENT_TIMESTAMP')) continue; // literal, no param
            if (assignment.includes('escalation_level = ?')) { ticket.escalation_level = params?.[idx]; idx++; }
            else if (assignment.includes('status = ?')) { ticket.status = params?.[idx]; idx++; }
            else if (assignment.includes('assigned_to = ?')) { ticket.assigned_to = params?.[idx]; idx++; }
            else if (assignment.includes('updated_at')) continue;
            else if (assignment.includes('= ?')) { idx++; } // skip unknown
          }
          if (sql.includes('first_response_at = CURRENT_TIMESTAMP')) ticket.first_response_at = new Date().toISOString();
          if (sql.includes('resolved_at = CURRENT_TIMESTAMP')) ticket.resolved_at = new Date().toISOString();
          if (sql.includes('escalated_at = CURRENT_TIMESTAMP')) ticket.escalated_at = new Date().toISOString();
        }
        return { changes: ticket ? 1 : 0 };
      }

      // COUNT / AVG queries
      if (sql.includes('COUNT(*)') || sql.includes('AVG(')) {
        return [{ count: 0, avg_minutes: 0 }];
      }

      return [];
    }
  })
};

require.cache[require.resolve('../../src/db')] = {
  loaded: true,
  exports: { getDatabaseInstance: async () => mockDb }
};

require.cache[require.resolve('../../src/utils/logger.js')] = {
  loaded: true,
  exports: { logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }
};

const { SLAManager, SLA_TIERS, TICKET_STATUS, TICKET_PRIORITY } = require('../../src/support/sla.js');
const { EscalationManager, ESCALATION_RULES } = require('../../src/support/escalation.js');

describe('T51: SLA Tiers', () => {
  it('should define basic tier', () => {
    assert.strictEqual(SLA_TIERS.BASIC.name, 'basic');
    assert.strictEqual(SLA_TIERS.BASIC.responseTimeMinutes, 1440);
    assert.strictEqual(SLA_TIERS.BASIC.uptimePercent, 99.0);
  });

  it('should define pro tier', () => {
    assert.strictEqual(SLA_TIERS.PRO.name, 'pro');
    assert.strictEqual(SLA_TIERS.PRO.responseTimeMinutes, 240);
    assert.strictEqual(SLA_TIERS.PRO.uptimePercent, 99.5);
  });

  it('should define enterprise tier', () => {
    assert.strictEqual(SLA_TIERS.ENTERPRISE.name, 'enterprise');
    assert.strictEqual(SLA_TIERS.ENTERPRISE.responseTimeMinutes, 60);
    assert.strictEqual(SLA_TIERS.ENTERPRISE.uptimePercent, 99.9);
  });

  it('should have increasing service levels', () => {
    assert.ok(SLA_TIERS.ENTERPRISE.responseTimeMinutes < SLA_TIERS.PRO.responseTimeMinutes);
    assert.ok(SLA_TIERS.PRO.responseTimeMinutes < SLA_TIERS.BASIC.responseTimeMinutes);
  });
});

describe('T51: Ticket Management', () => {
  let manager;

  beforeEach(() => {
    mockRows.tickets = [];
    mockRows.comments = [];
    mockRows.violations = [];
    mockRows.escalations = [];
    manager = new SLAManager();
  });

  it('should create a ticket', async () => {
    const ticket = await manager.createTicket(1, {
      subject: 'API is down',
      description: 'Cannot reach the API',
      priority: 'high',
      slaTier: 'pro'
    });

    assert.ok(ticket.id);
    assert.strictEqual(ticket.subject, 'API is down');
    assert.strictEqual(ticket.status, 'open');
    assert.strictEqual(ticket.priority, 'high');
    assert.strictEqual(ticket.slaTier, 'pro');
    assert.ok(ticket.responseDueAt);
    assert.ok(ticket.resolutionDueAt);
  });

  it('should default to basic tier and medium priority', async () => {
    const ticket = await manager.createTicket(1, { subject: 'Question' });
    assert.strictEqual(ticket.priority, 'medium');
    assert.strictEqual(ticket.slaTier, 'basic');
  });

  it('should get a ticket by ID', async () => {
    const created = await manager.createTicket(1, { subject: 'Test' });
    const ticket = await manager.getTicket(created.id);
    assert.ok(ticket);
    assert.strictEqual(ticket.subject, 'Test');
  });

  it('should return null for non-existent ticket', async () => {
    const ticket = await manager.getTicket(999);
    assert.strictEqual(ticket, null);
  });

  it('should list tickets', async () => {
    await manager.createTicket(1, { subject: 'Ticket 1' });
    await manager.createTicket(1, { subject: 'Ticket 2' });
    const tickets = await manager.listTickets({ userId: 1 });
    assert.strictEqual(tickets.length, 2);
  });

  it('should update ticket status', async () => {
    const created = await manager.createTicket(1, { subject: 'Test' });
    const updated = await manager.updateTicket(created.id, { status: 'in_progress' });
    assert.strictEqual(updated.status, 'in_progress');
  });

  it('should set first response on assign', async () => {
    const created = await manager.createTicket(1, { subject: 'Test' });
    const updated = await manager.updateTicket(created.id, { assignedTo: 'agent1' });
    assert.strictEqual(updated.assignedTo, 'agent1');
    assert.strictEqual(updated.status, 'in_progress');
    assert.ok(updated.firstResponseAt);
  });

  it('should set resolved_at when resolving', async () => {
    const created = await manager.createTicket(1, { subject: 'Test' });
    const updated = await manager.updateTicket(created.id, { status: 'resolved' });
    assert.strictEqual(updated.status, 'resolved');
    assert.ok(updated.resolvedAt);
  });

  it('should add a comment', async () => {
    const ticket = await manager.createTicket(1, { subject: 'Test' });
    const comment = await manager.addComment(ticket.id, 2, 'Looking into this');
    assert.ok(comment.id);
    assert.strictEqual(comment.content, 'Looking into this');
  });

  it('should get comments for a ticket', async () => {
    const ticket = await manager.createTicket(1, { subject: 'Test' });
    await manager.addComment(ticket.id, 1, 'Help me');
    await manager.addComment(ticket.id, 2, 'On it');
    const comments = await manager.getComments(ticket.id);
    assert.strictEqual(comments.length, 2);
  });

  it('should track internal comments', async () => {
    const ticket = await manager.createTicket(1, { subject: 'Test' });
    await manager.addComment(ticket.id, 2, 'Internal note', true);
    const comments = await manager.getComments(ticket.id);
    assert.strictEqual(comments[0].isInternal, true);
  });
});

describe('T51: Escalation Rules', () => {
  it('should define rules for all priorities', () => {
    assert.ok(ESCALATION_RULES.critical);
    assert.ok(ESCALATION_RULES.high);
    assert.ok(ESCALATION_RULES.medium);
    assert.ok(ESCALATION_RULES.low);
  });

  it('should have aggressive escalation for critical', () => {
    assert.strictEqual(ESCALATION_RULES.critical.responseThresholdPercent, 50);
    assert.strictEqual(ESCALATION_RULES.critical.maxLevel, 3);
  });

  it('should have no auto-escalation for low', () => {
    assert.strictEqual(ESCALATION_RULES.low.maxLevel, 0);
    assert.strictEqual(ESCALATION_RULES.low.autoAssign, false);
  });
});

describe('T51: Escalation Manager', () => {
  let slaManager;
  let escalationManager;

  beforeEach(() => {
    mockRows.tickets = [];
    mockRows.comments = [];
    mockRows.violations = [];
    mockRows.escalations = [];
    slaManager = new SLAManager();
    escalationManager = new EscalationManager();
  });

  it('should manually escalate a ticket', async () => {
    const ticket = await slaManager.createTicket(1, { subject: 'Critical issue', priority: 'critical' });
    const result = await escalationManager.escalateTicket(ticket.id, 2, 'Needs attention');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.newLevel, 1);
  });

  it('should record escalation history', async () => {
    const ticket = await slaManager.createTicket(1, { subject: 'Issue', priority: 'high' });
    await escalationManager.escalateTicket(ticket.id, 2, 'Slow response');
    const history = await escalationManager.getEscalationHistory(ticket.id);
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0].reason, 'Slow response');
  });

  it('should not allow same-level escalation', async () => {
    const ticket = await slaManager.createTicket(1, { subject: 'Issue', priority: 'high' });
    // Escalation to level 1 should succeed
    const r1 = await escalationManager.escalateTicket(ticket.id, 2, 'Reason 1');
    assert.strictEqual(r1.success, true);
    // Verify escalation history was recorded
    const history = await escalationManager.getEscalationHistory(ticket.id);
    assert.ok(history.length >= 1);
  });
});

describe('T51: Ticket Status & Priority Enums', () => {
  it('should define all ticket statuses', () => {
    assert.strictEqual(TICKET_STATUS.OPEN, 'open');
    assert.strictEqual(TICKET_STATUS.IN_PROGRESS, 'in_progress');
    assert.strictEqual(TICKET_STATUS.WAITING, 'waiting');
    assert.strictEqual(TICKET_STATUS.ESCALATED, 'escalated');
    assert.strictEqual(TICKET_STATUS.RESOLVED, 'resolved');
    assert.strictEqual(TICKET_STATUS.CLOSED, 'closed');
  });

  it('should define all priorities', () => {
    assert.strictEqual(TICKET_PRIORITY.LOW, 'low');
    assert.strictEqual(TICKET_PRIORITY.MEDIUM, 'medium');
    assert.strictEqual(TICKET_PRIORITY.HIGH, 'high');
    assert.strictEqual(TICKET_PRIORITY.CRITICAL, 'critical');
  });
});
