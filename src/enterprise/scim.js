/**
 * SCIM 2.0 User Provisioning
 * Enterprise user provisioning via SCIM protocol.
 */

const { logger } = require('../utils/logger.js');
const { getDatabaseInstance } = require('../db');

/**
 * SCIM resource schemas
 */
const SCHEMAS = {
  USER: 'urn:ietf:params:scim:schemas:core:2.0:User',
  GROUP: 'urn:ietf:params:scim:schemas:core:2.0:Group',
  LIST: 'urn:ietf:params:scim:api:messages:2.0:ListResponse',
  ERROR: 'urn:ietf:params:scim:api:messages:2.0:Error'
};

/**
 * Validate SCIM token for an organization
 */
async function validateSCIMToken(orgId, token) {
  const db = await getDatabaseInstance();
  const adapter = db.getAdapter();

  const rows = await adapter.execute(
    'SELECT scim_token FROM organizations WHERE id = ? AND scim_enabled = 1',
    [orgId]
  );

  const row = Array.isArray(rows) ? rows[0] : (rows.rows ? rows.rows[0] : null);
  if (!row) return false;

  // Constant-time comparison
  const expected = Buffer.from(row.scim_token || '', 'utf8');
  const provided = Buffer.from(token || '', 'utf8');

  if (expected.length !== provided.length) return false;

  const crypto = require('crypto');
  return crypto.timingSafeEqual(expected, provided);
}

/**
 * Format a user as a SCIM resource
 */
function formatSCIMUser(user, orgId) {
  return {
    schemas: [SCHEMAS.USER],
    id: String(user.id),
    externalId: user.external_id || String(user.id),
    userName: user.username || user.email,
    name: {
      formatted: user.name || user.email,
      givenName: user.first_name || '',
      familyName: user.last_name || ''
    },
    emails: [{ value: user.email, primary: true }],
    active: !!user.active,
    groups: user.groups || [],
    meta: {
      resourceType: 'User',
      created: user.created_at,
      lastModified: user.updated_at || user.created_at,
      location: `/scim/v2/Users/${user.id}`
    }
  };
}

/**
 * Format a list of SCIM resources
 */
function formatSCIMList(resources, total, startIndex, count) {
  return {
    schemas: [SCHEMAS.LIST],
    totalResults: total,
    startIndex: startIndex || 1,
    itemsPerPage: count || resources.length,
    Resources: resources
  };
}

/**
 * Format a SCIM error
 */
function formatSCIMError(status, detail) {
  return {
    schemas: [SCHEMAS.ERROR],
    scimType: status === 404 ? 'invalidFilter' : 'invalidValue',
    detail,
    status: String(status)
  };
}

/**
 * Parse SCIM filter expressions (simplified)
 * Supports: userName eq "value", active eq true/false
 */
function parseSCIMFilter(filter) {
  if (!filter) return null;

  const eqMatch = filter.match(/^(\w+)\s+eq\s+"([^"]+)"$/);
  if (eqMatch) {
    return { field: eqMatch[1], operator: 'eq', value: eqMatch[2] };
  }

  const boolMatch = filter.match(/^(\w+)\s+eq\s+(true|false)$/);
  if (boolMatch) {
    return { field: boolMatch[1], operator: 'eq', value: boolMatch[2] === 'true' };
  }

  return null;
}

/**
 * Apply SCIM filter to database query
 */
function applyFilter(adapter, orgId, filter, startIndex, count) {
  const parsed = parseSCIMFilter(filter);
  let whereClause = 'WHERE om.org_id = ?';
  const params = [orgId];

  if (parsed) {
    if (parsed.field === 'userName') {
      whereClause += ' AND (u.username = ? OR u.email = ?)';
      params.push(parsed.value, parsed.value);
    } else if (parsed.field === 'active') {
      whereClause += ' AND u.active = ?';
      params.push(parsed.value ? 1 : 0);
    }
  }

  const limit = count || 100;
  const offset = (startIndex || 1) - 1;

  return { whereClause, params, limit, offset };
}

/**
 * SCIM provisioning handler for creating users
 */
async function provisionUser(orgId, userData) {
  const db = await getDatabaseInstance();
  const adapter = db.getAdapter();

  const email = userData.emails?.[0]?.value || userData.userName;
  const username = userData.userName || email;
  const name = userData.name?.formatted || `${userData.name?.givenName || ''} ${userData.name?.familyName || ''}`.trim();

  // Check if user already exists
  const existing = await adapter.execute(
    `SELECT u.id FROM users u
     JOIN organization_members om ON u.id = om.user_id
     WHERE om.org_id = ? AND u.email = ?`,
    [orgId, email]
  );

  const existingRow = Array.isArray(existing) ? existing[0] : (existing.rows ? existing.rows[0] : null);

  if (existingRow) {
    // Update existing user
    await adapter.execute(
      `UPDATE users SET username = ?, name = ?, active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [username, name, userData.active !== false ? 1 : 0, existingRow.id]
    );
    return { id: existingRow.id, created: false };
  }

  // Create new user
  const result = await adapter.execute(
    `INSERT INTO users (username, email, name, active) VALUES (?, ?, ?, ?)`,
    [username, email, name, userData.active !== false ? 1 : 0]
  );

  const userId = result.lastInsertRowid || result.insertId;

  // Add to organization
  await adapter.execute(
    `INSERT INTO organization_members (org_id, user_id, role, joined_at)
     VALUES (?, ?, 'member', CURRENT_TIMESTAMP)`,
    [orgId, userId]
  );

  logger.info({ orgId, userId, email }, 'SCIM user provisioned');
  return { id: userId, created: true };
}

/**
 * SCIM provisioning handler for deactivating users
 */
async function deactivateUser(orgId, userId) {
  const db = await getDatabaseInstance();
  const adapter = db.getAdapter();

  await adapter.execute(
    `UPDATE users SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [userId]
  );

  await adapter.execute(
    `DELETE FROM organization_members WHERE org_id = ? AND user_id = ?`,
    [orgId, userId]
  );

  logger.info({ orgId, userId }, 'SCIM user deactivated');
  return true;
}

module.exports = {
  SCHEMAS,
  validateSCIMToken,
  formatSCIMUser,
  formatSCIMList,
  formatSCIMError,
  parseSCIMFilter,
  provisionUser,
  deactivateUser
};
