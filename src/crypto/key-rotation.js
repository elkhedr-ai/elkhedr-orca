/**
 * Key Rotation Strategy
 * Manages encryption key lifecycle: generation, rotation, versioning, and re-encryption.
 */

const crypto = require('crypto');
const { getDatabaseInstance } = require('../db');
const { logger } = require('../utils/logger.js');
const { encrypt, decrypt } = require('./index.js');

const KEY_VERSION_TABLE = 'encryption_keys';

/**
 * Initialize encryption key metadata table
 */
async function initKeyRotationTable() {
  const db = await getDatabaseInstance();
  await db.getAdapter().execute(`
    CREATE TABLE IF NOT EXISTS ${KEY_VERSION_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_version INTEGER NOT NULL UNIQUE,
      key_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      rotated_at DATETIME,
      retired_at DATETIME
    )
  `);

  await db.getAdapter().execute(`
    CREATE INDEX IF NOT EXISTS idx_enc_keys_version ON ${KEY_VERSION_TABLE}(key_version)
  `);

  await db.getAdapter().execute(`
    CREATE INDEX IF NOT EXISTS idx_enc_keys_active ON ${KEY_VERSION_TABLE}(active)
  `);
}

/**
 * Generate a new master key (should be stored securely, e.g., env var or vault)
 * @returns {string} Base64-encoded 32-byte key
 */
function generateMasterKey() {
  return crypto.randomBytes(32).toString('base64');
}

/**
 * Hash a key for storage (to verify without storing plaintext)
 * @param {string} key
 * @returns {string} SHA-256 hash
 */
function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Register a new key version in the database
 * @param {string} masterKey - The master key
 * @returns {Promise<number>} Key version number
 */
async function registerNewKey(masterKey) {
  await initKeyRotationTable();
  const db = await getDatabaseInstance();

  // Deactivate current active key
  await db.getAdapter().execute(
    `UPDATE ${KEY_VERSION_TABLE} SET active = 0, retired_at = CURRENT_TIMESTAMP WHERE active = 1`
  );

  // Get next version number
  const result = await db.getAdapter().query(
    `SELECT COALESCE(MAX(key_version), 0) + 1 as next_version FROM ${KEY_VERSION_TABLE}`
  );
  const version = result[0].next_version;

  // Register new key
  await db.getAdapter().execute(
    `INSERT INTO ${KEY_VERSION_TABLE} (key_version, key_hash, active, created_at)
     VALUES (?, ?, 1, CURRENT_TIMESTAMP)`,
    [version, hashKey(masterKey)]
  );

  logger.info({ keyVersion: version }, 'New encryption key registered');
  return version;
}

/**
 * Get the current active key version
 * @returns {Promise<number|null>}
 */
async function getCurrentKeyVersion() {
  try {
    const db = await getDatabaseInstance();
    const rows = await db.getAdapter().query(
      `SELECT key_version FROM ${KEY_VERSION_TABLE} WHERE active = 1 ORDER BY key_version DESC LIMIT 1`
    );
    return rows.length > 0 ? rows[0].key_version : null;
  } catch {
    return null;
  }
}

/**
 * Rotate encryption key: re-encrypt all sensitive data with new key
 * This is an expensive operation and should run asynchronously.
 * @param {string} oldMasterKey - Current master key
 * @param {string} newMasterKey - New master key
 * @param {Object} options - Rotation options
 * @param {string[]} options.tables - Tables to re-encrypt
 * @param {string[]} options.fields - Fields to re-encrypt per table
 * @returns {Promise<Object>} Rotation statistics
 */
async function rotateKey(oldMasterKey, newMasterKey, options = {}) {
  const startTime = Date.now();
  const stats = {
    tablesProcessed: 0,
    recordsProcessed: 0,
    recordsFailed: 0,
    errors: []
  };

  const { tables = [], fields = [] } = options;

  if (!oldMasterKey || !newMasterKey) {
    throw new Error('Both old and new master keys are required');
  }

  const db = await getDatabaseInstance();

  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    const tableFields = Array.isArray(fields[i]) ? fields[i] : [fields[i]];

    try {
      logger.info({ table, fields: tableFields }, 'Re-encrypting table');

      const rows = await db.getAdapter().query(`SELECT id, ${tableFields.join(', ')} FROM ${table}`);
      stats.tablesProcessed++;

      for (const row of rows) {
        try {
          const updates = [];
          const params = [];

          for (const field of tableFields) {
            if (row[field] !== null && row[field] !== undefined) {
              // Decrypt with old key, encrypt with new key
              const decrypted = decrypt(row[field], oldMasterKey);
              if (decrypted !== null) {
                const reEncrypted = encrypt(decrypted, newMasterKey);
                updates.push(`${field} = ?`);
                params.push(reEncrypted);
              }
            }
          }

          if (updates.length > 0) {
            params.push(row.id);
            await db.getAdapter().execute(
              `UPDATE ${table} SET ${updates.join(', ')} WHERE id = ?`,
              params
            );
            stats.recordsProcessed++;
          }
        } catch (error) {
          stats.recordsFailed++;
          stats.errors.push({ table, id: row.id, error: error.message });
          logger.error({ table, id: row.id, error: error.message }, 'Re-encryption failed');
        }
      }
    } catch (error) {
      stats.errors.push({ table, error: error.message });
      logger.error({ table, error: error.message }, 'Table re-encryption failed');
    }
  }

  // Register the new key
  const newVersion = await registerNewKey(newMasterKey);

  const duration = Date.now() - startTime;
  logger.info({
    duration,
    stats,
    newKeyVersion: newVersion
  }, 'Key rotation completed');

  return { ...stats, newKeyVersion: newVersion, duration };
}

/**
 * Schedule quarterly key rotation (should be called from cron/scheduler)
 * @param {string} currentMasterKey - Current key
 * @param {Function} keyProvider - Async function that returns new key
 * @returns {Promise<Object>}
 */
async function scheduledRotation(currentMasterKey, keyProvider) {
  const newKey = await keyProvider();
  return rotateKey(currentMasterKey, newKey, {
    tables: ['users', 'api_keys'],
    fields: [
      ['refresh_token', 'reset_token'],
      ['key_hash']
    ]
  });
}

/**
 * Get key rotation history
 * @returns {Promise<Array>}
 */
async function getRotationHistory() {
  const db = await getDatabaseInstance();
  const rows = await db.getAdapter().query(
    `SELECT key_version, active, created_at, rotated_at, retired_at
     FROM ${KEY_VERSION_TABLE}
     ORDER BY key_version DESC`
  );
  return rows;
}

module.exports = {
  initKeyRotationTable,
  generateMasterKey,
  hashKey,
  registerNewKey,
  getCurrentKeyVersion,
  rotateKey,
  scheduledRotation,
  getRotationHistory
};
