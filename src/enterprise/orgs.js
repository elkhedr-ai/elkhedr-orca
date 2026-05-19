/**
 * Organization Management
 * Multi-tenant organization support with SSO, SCIM, and audit.
 */

const { logger } = require('../utils/logger.js');
const { getDatabaseInstance } = require('../db');

class OrganizationManager {
  constructor() {
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS organizations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        domain TEXT,
        plan TEXT NOT NULL DEFAULT 'basic',
        sso_enabled INTEGER NOT NULL DEFAULT 0,
        sso_provider TEXT,
        sso_config TEXT,
        scim_enabled INTEGER NOT NULL DEFAULT 0,
        scim_token TEXT,
        data_retention_days INTEGER DEFAULT 365,
        custom_domain TEXT,
        settings TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS organization_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        invited_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        joined_at DATETIME,
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
        UNIQUE(org_id, user_id)
      )
    `);

    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id INTEGER NOT NULL,
        user_id INTEGER,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        details TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
      )
    `);

    await adapter.execute(`
      CREATE INDEX IF NOT EXISTS idx_org_members_org_id ON organization_members(org_id)
    `);
    await adapter.execute(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_org_id ON audit_logs(org_id)
    `);
    await adapter.execute(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)
    `);

    this.initialized = true;
    logger.info('Organization manager initialized');
  }

  // ── Organizations ────────────────────────────────────────────────────────

  async createOrganization(userId, config) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const slug = config.slug || config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const result = await adapter.execute(
      `INSERT INTO organizations (name, slug, domain, plan, settings)
       VALUES (?, ?, ?, ?, ?)`,
      [
        config.name,
        slug,
        config.domain || null,
        config.plan || 'basic',
        config.settings ? JSON.stringify(config.settings) : null
      ]
    );

    const orgId = result.lastInsertRowid || result.insertId;

    // Add creator as owner
    await adapter.execute(
      `INSERT INTO organization_members (org_id, user_id, role, joined_at)
       VALUES (?, ?, 'owner', CURRENT_TIMESTAMP)`,
      [orgId, userId]
    );

    await this._audit(orgId, userId, 'organization.created', 'organization', orgId, { name: config.name });

    logger.info({ orgId, userId, name: config.name }, 'Organization created');

    return this.getOrganization(orgId);
  }

  async getOrganization(orgId) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const rows = await adapter.execute(
      'SELECT * FROM organizations WHERE id = ?',
      [orgId]
    );

    const row = Array.isArray(rows) ? rows[0] : (rows.rows ? rows.rows[0] : null);
    if (!row) return null;

    return this._formatOrg(row);
  }

  async getOrganizationBySlug(slug) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const rows = await adapter.execute(
      'SELECT * FROM organizations WHERE slug = ?',
      [slug]
    );

    const row = Array.isArray(rows) ? rows[0] : (rows.rows ? rows.rows[0] : null);
    if (!row) return null;

    return this._formatOrg(row);
  }

  async listOrganizations(userId) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const rows = await adapter.execute(
      `SELECT o.* FROM organizations o
       JOIN organization_members om ON o.id = om.org_id
       WHERE om.user_id = ?
       ORDER BY o.name`,
      [userId]
    );

    const orgs = Array.isArray(rows) ? rows : (rows.rows || []);
    return orgs.map(row => this._formatOrg(row));
  }

  async updateOrganization(orgId, updates) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const fields = [];
    const values = [];

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.domain !== undefined) { fields.push('domain = ?'); values.push(updates.domain); }
    if (updates.plan !== undefined) { fields.push('plan = ?'); values.push(updates.plan); }
    if (updates.dataRetentionDays !== undefined) { fields.push('data_retention_days = ?'); values.push(updates.dataRetentionDays); }
    if (updates.customDomain !== undefined) { fields.push('custom_domain = ?'); values.push(updates.customDomain); }
    if (updates.settings !== undefined) { fields.push('settings = ?'); values.push(JSON.stringify(updates.settings)); }

    if (fields.length === 0) return this.getOrganization(orgId);

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(orgId);

    await adapter.execute(
      `UPDATE organizations SET ${fields.join(', ')} WHERE id = ?`,
      values
    );

    return this.getOrganization(orgId);
  }

  async deleteOrganization(orgId) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const result = await adapter.execute('DELETE FROM organizations WHERE id = ?', [orgId]);
    return (result.changes || result.affectedRows || 0) > 0;
  }

  // ── Members ──────────────────────────────────────────────────────────────

  async addMember(orgId, userId, role = 'member') {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    try {
      await adapter.execute(
        `INSERT INTO organization_members (org_id, user_id, role, joined_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [orgId, userId, role]
      );

      await this._audit(orgId, userId, 'member.added', 'user', userId, { role });
      return true;
    } catch (error) {
      if (error.message?.includes('UNIQUE')) return false; // Already a member
      throw error;
    }
  }

  async removeMember(orgId, userId) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const result = await adapter.execute(
      'DELETE FROM organization_members WHERE org_id = ? AND user_id = ?',
      [orgId, userId]
    );

    if ((result.changes || result.affectedRows || 0) > 0) {
      await this._audit(orgId, userId, 'member.removed', 'user', userId);
      return true;
    }
    return false;
  }

  async updateMemberRole(orgId, userId, role) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    await adapter.execute(
      'UPDATE organization_members SET role = ? WHERE org_id = ? AND user_id = ?',
      [role, orgId, userId]
    );

    await this._audit(orgId, userId, 'member.role_updated', 'user', userId, { role });
    return true;
  }

  async listMembers(orgId) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const rows = await adapter.execute(
      `SELECT om.user_id, om.role, om.invited_at, om.joined_at
       FROM organization_members om
       WHERE om.org_id = ?
       ORDER BY om.joined_at`,
      [orgId]
    );

    const members = Array.isArray(rows) ? rows : (rows.rows || []);
    return members.map(row => ({
      userId: row.user_id,
      role: row.role,
      invitedAt: row.invited_at,
      joinedAt: row.joined_at
    }));
  }

  async isMember(orgId, userId) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const rows = await adapter.execute(
      'SELECT role FROM organization_members WHERE org_id = ? AND user_id = ?',
      [orgId, userId]
    );

    const row = Array.isArray(rows) ? rows[0] : (rows.rows ? rows.rows[0] : null);
    return row ? row.role : null;
  }

  // ── SSO Configuration ────────────────────────────────────────────────────

  async configureSSO(orgId, config) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    await adapter.execute(
      `UPDATE organizations SET sso_enabled = ?, sso_provider = ?, sso_config = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        config.enabled ? 1 : 0,
        config.provider || null,
        config.config ? JSON.stringify(config.config) : null,
        orgId
      ]
    );

    await this._audit(orgId, null, 'sso.configured', 'organization', orgId, { provider: config.provider });
    return this.getOrganization(orgId);
  }

  // ── SCIM Configuration ───────────────────────────────────────────────────

  async configureSCIM(orgId, config) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const scimToken = config.token || `scim_${require('crypto').randomBytes(32).toString('hex')}`;

    await adapter.execute(
      `UPDATE organizations SET scim_enabled = ?, scim_token = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [config.enabled ? 1 : 0, config.enabled ? scimToken : null, orgId]
    );

    await this._audit(orgId, null, 'scim.configured', 'organization', orgId);
    return { enabled: config.enabled, token: config.enabled ? scimToken : null };
  }

  // ── Audit Logs ───────────────────────────────────────────────────────────

  async _audit(orgId, userId, action, resourceType, resourceId, details) {
    try {
      const db = await getDatabaseInstance();
      const adapter = db.getAdapter();
      await adapter.execute(
        `INSERT INTO audit_logs (org_id, user_id, action, resource_type, resource_id, details)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [orgId, userId, action, resourceType, String(resourceId), details ? JSON.stringify(details) : null]
      );
    } catch (e) {
      logger.warn({ error: e.message }, 'Failed to write audit log');
    }
  }

  async getAuditLogs(orgId, options = {}) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const limit = options.limit || 100;
    const offset = options.offset || 0;

    const rows = await adapter.execute(
      `SELECT * FROM audit_logs WHERE org_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [orgId, limit, offset]
    );

    const logs = Array.isArray(rows) ? rows : (rows.rows || []);
    return logs.map(row => ({
      id: row.id,
      userId: row.user_id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      details: row.details ? JSON.parse(row.details) : null,
      ipAddress: row.ip_address,
      createdAt: row.created_at
    }));
  }

  _formatOrg(row) {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      domain: row.domain,
      plan: row.plan,
      ssoEnabled: !!row.sso_enabled,
      ssoProvider: row.sso_provider,
      ssoConfig: row.sso_config ? JSON.parse(row.sso_config) : null,
      scimEnabled: !!row.scim_enabled,
      dataRetentionDays: row.data_retention_days,
      customDomain: row.custom_domain,
      settings: row.settings ? JSON.parse(row.settings) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

let instance = null;

function getOrganizationManager() {
  if (!instance) {
    instance = new OrganizationManager();
  }
  return instance;
}

function resetOrganizationManager() {
  instance = null;
}

module.exports = {
  OrganizationManager,
  getOrganizationManager,
  resetOrganizationManager
};
