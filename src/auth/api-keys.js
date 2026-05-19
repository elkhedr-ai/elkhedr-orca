/**
 * API Key Management System
 * Generate, validate, and revoke API keys for programmatic access
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDatabaseInstance } = require('../db');

const KEY_PREFIX = 'orca_live_';
const KEY_LENGTH = 48; // Total length minus prefix
const SALT_ROUNDS = 10;

/**
 * Generate a new API key
 * @returns {string} Raw API key (only shown once)
 */
function generateRawKey() {
  const randomBytes = crypto.randomBytes(KEY_LENGTH).toString('base64')
    .replace(/[+/=]/g, '') // Remove non-alphanumeric chars
    .substring(0, KEY_LENGTH);
  return `${KEY_PREFIX}${randomBytes}`;
}

/**
 * Hash an API key for storage
 * @param {string} rawKey
 * @returns {Promise<string>}
 */
async function hashKey(rawKey) {
  return bcrypt.hash(rawKey, SALT_ROUNDS);
}

/**
 * Verify an API key against a hash
 * @param {string} rawKey
 * @param {string} keyHash
 * @returns {Promise<boolean>}
 */
async function verifyKey(rawKey, keyHash) {
  return bcrypt.compare(rawKey, keyHash);
}

/**
 * Create a new API key for a user
 * @param {number} userId
 * @param {string} name - Human-readable name for the key
 * @param {string[]} scopes - ['read', 'write', 'admin']
 * @param {number|null} expiresInDays - Days until expiration (null = no expiry)
 * @returns {Promise<Object>} { rawKey, keyData }
 */
async function createApiKey(userId, name, scopes = ['read'], expiresInDays = null) {
  // Validate scopes
  const validScopes = ['read', 'write', 'admin'];
  const invalidScopes = scopes.filter(s => !validScopes.includes(s));
  if (invalidScopes.length > 0) {
    throw new Error(`Invalid scopes: ${invalidScopes.join(', ')}. Valid: ${validScopes.join(', ')}`);
  }

  // Generate key
  const rawKey = generateRawKey();
  const keyHash = await hashKey(rawKey);
  const keyPrefix = rawKey.substring(0, KEY_PREFIX.length + 8); // Show prefix + first 8 chars

  // Calculate expiration
  let expiresAt = null;
  if (expiresInDays) {
    expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);
  }

  const db = await getDatabaseInstance();
  const result = await db.getAdapter().execute(
    `INSERT INTO api_keys (user_id, key_hash, key_prefix, name, scopes, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, keyHash, keyPrefix, name || null, JSON.stringify(scopes), expiresAt ? expiresAt.toISOString() : null]
  );

  return {
    rawKey, // Only returned once - must be shown to user
    keyData: {
      id: result.lastInsertRowid,
      userId,
      prefix: keyPrefix,
      name: name || null,
      scopes,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      createdAt: new Date().toISOString()
    }
  };
}

/**
 * Validate an API key and return associated user
 * @param {string} rawKey
 * @returns {Promise<Object|null>} { userId, scopes, keyId } or null
 */
async function validateApiKey(rawKey) {
  if (!rawKey || !rawKey.startsWith(KEY_PREFIX)) {
    return null;
  }

  const db = await getDatabaseInstance();

  // Get all non-revoked keys (we'll check hash manually since bcrypt needs full comparison)
  const keys = await db.getAdapter().query(
    `SELECT id, user_id, key_hash, scopes, expires_at, revoked_at
     FROM api_keys
     WHERE revoked_at IS NULL
     AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`,
    []
  );

  // Check each key hash (in production with many keys, use key_prefix to narrow down first)
  for (const key of keys) {
    const isValid = await verifyKey(rawKey, key.key_hash);
    if (isValid) {
      // Update last_used_at
      await db.getAdapter().execute(
        'UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?',
        [key.id]
      );

      return {
        keyId: key.id,
        userId: key.user_id,
        scopes: JSON.parse(key.scopes)
      };
    }
  }

  return null;
}

/**
 * Get all API keys for a user (without raw keys)
 * @param {number} userId
 * @returns {Promise<Array>}
 */
async function getUserApiKeys(userId) {
  const db = await getDatabaseInstance();
  const keys = await db.getAdapter().query(
    `SELECT id, key_prefix, name, scopes, expires_at, last_used_at, revoked_at, created_at
     FROM api_keys
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [userId]
  );

  return keys.map(key => ({
    id: key.id,
    prefix: key.key_prefix,
    name: key.name,
    scopes: JSON.parse(key.scopes),
    expiresAt: key.expires_at,
    lastUsedAt: key.last_used_at,
    revokedAt: key.revoked_at,
    createdAt: key.created_at,
    isActive: !key.revoked_at && (!key.expires_at || new Date(key.expires_at) > new Date())
  }));
}

/**
 * Revoke an API key
 * @param {number} keyId
 * @param {number} userId - Owner user ID (for verification)
 */
async function revokeApiKey(keyId, userId) {
  const db = await getDatabaseInstance();

  // Verify ownership
  const keys = await db.getAdapter().query(
    'SELECT id FROM api_keys WHERE id = ? AND user_id = ?',
    [keyId, userId]
  );

  if (keys.length === 0) {
    throw new Error('API key not found or access denied');
  }

  await db.getAdapter().execute(
    'UPDATE api_keys SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?',
    [keyId]
  );
}

/**
 * Admin: Revoke any API key
 * @param {number} keyId
 */
async function adminRevokeApiKey(keyId) {
  const db = await getDatabaseInstance();
  const result = await db.getAdapter().execute(
    'UPDATE api_keys SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?',
    [keyId]
  );

  if (result.changes === 0) {
    throw new Error('API key not found');
  }
}

/**
 * Delete an API key permanently (admin only)
 * @param {number} keyId
 */
async function deleteApiKey(keyId) {
  const db = await getDatabaseInstance();
  const result = await db.getAdapter().execute(
    'DELETE FROM api_keys WHERE id = ?',
    [keyId]
  );

  if (result.changes === 0) {
    throw new Error('API key not found');
  }
}

/**
 * Clean up expired keys (run periodically)
 * @returns {Promise<number>} Number of keys revoked
 */
async function cleanupExpiredKeys() {
  const db = await getDatabaseInstance();
  const result = await db.getAdapter().execute(
    `UPDATE api_keys
     SET revoked_at = CURRENT_TIMESTAMP
     WHERE expires_at IS NOT NULL
     AND expires_at < CURRENT_TIMESTAMP
     AND revoked_at IS NULL`
  );
  return result.changes;
}

/**
 * Check if API key has a specific scope
 * @param {string[]} keyScopes
 * @param {string} requiredScope
 * @returns {boolean}
 */
function hasScope(keyScopes, requiredScope) {
  // Admin scope grants all permissions
  if (keyScopes.includes('admin')) return true;
  return keyScopes.includes(requiredScope);
}

/**
 * Get API key statistics for a user
 * @param {number} userId
 * @returns {Promise<Object>}
 */
async function getApiKeyStats(userId) {
  const db = await getDatabaseInstance();
  const stats = await db.getAdapter().query(
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN revoked_at IS NULL AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP) THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END) as revoked,
      SUM(CASE WHEN expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP AND revoked_at IS NULL THEN 1 ELSE 0 END) as expired
     FROM api_keys
     WHERE user_id = ?`,
    [userId]
  );

  return stats[0];
}

module.exports = {
  generateRawKey,
  hashKey,
  verifyKey,
  createApiKey,
  validateApiKey,
  getUserApiKeys,
  revokeApiKey,
  adminRevokeApiKey,
  deleteApiKey,
  cleanupExpiredKeys,
  hasScope,
  getApiKeyStats,
  KEY_PREFIX
};
