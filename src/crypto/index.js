/**
 * Encryption Module
 * Provides AES-256-GCM encryption for sensitive data at rest.
 * Uses Node.js built-in crypto module.
 */

const crypto = require('crypto');
const { logger } = require('../utils/logger.js');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Derive a key from a master key and salt using PBKDF2
 * @param {string} masterKey - The master encryption key
 * @param {Buffer} salt - Random salt
 * @returns {Buffer} 32-byte key
 */
function deriveKey(masterKey, salt) {
  return crypto.pbkdf2Sync(masterKey, salt, 100000, KEY_LENGTH, 'sha512');
}

/**
 * Encrypt sensitive data using AES-256-GCM
 * @param {string} plaintext - Data to encrypt
 * @param {string} masterKey - Master encryption key (should be from env)
 * @returns {string} Encrypted data in format: salt:iv:authTag:ciphertext (base64)
 */
function encrypt(plaintext, masterKey) {
  if (!plaintext) return null;
  if (!masterKey || masterKey.length < 16) {
    throw new Error('Master key must be at least 16 characters');
  }

  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(masterKey, salt);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  // Combine: salt + iv + authTag + ciphertext
  const result = Buffer.concat([salt, iv, authTag, encrypted]);
  return result.toString('base64');
}

/**
 * Decrypt data encrypted with encrypt()
 * @param {string} ciphertext - Base64 encrypted data
 * @param {string} masterKey - Master encryption key
 * @returns {string|null} Decrypted plaintext
 */
function decrypt(ciphertext, masterKey) {
  if (!ciphertext) return null;
  if (!masterKey || masterKey.length < 16) {
    throw new Error('Master key must be at least 16 characters');
  }

  try {
    const data = Buffer.from(ciphertext, 'base64');

    // Extract components
    const salt = data.subarray(0, 32);
    const iv = data.subarray(32, 32 + IV_LENGTH);
    const authTag = data.subarray(32 + IV_LENGTH, 32 + IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = data.subarray(32 + IV_LENGTH + AUTH_TAG_LENGTH);

    const key = deriveKey(masterKey, salt);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);

    return decrypted.toString('utf8');
  } catch (error) {
    logger.error({ error: error.message }, 'Decryption failed');
    throw new Error('Decryption failed: invalid key or corrupted data');
  }
}

/**
 * Encrypt an object (converts to JSON first)
 * @param {Object} data - Object to encrypt
 * @param {string} masterKey - Master encryption key
 * @returns {string} Encrypted JSON
 */
function encryptObject(data, masterKey) {
  if (!data) return null;
  return encrypt(JSON.stringify(data), masterKey);
}

/**
 * Decrypt an object (parses JSON after decryption)
 * @param {string} ciphertext - Encrypted JSON
 * @param {string} masterKey - Master encryption key
 * @returns {Object|null}
 */
function decryptObject(ciphertext, masterKey) {
  if (!ciphertext) return null;
  const plaintext = decrypt(ciphertext, masterKey);
  if (!plaintext) return null;
  return JSON.parse(plaintext);
}

/**
 * Hash sensitive data (one-way, for comparison)
 * Uses HMAC-SHA256 with the master key
 * @param {string} data - Data to hash
 * @param {string} masterKey - Master key for HMAC
 * @returns {string} Hex-encoded hash
 */
function hash(data, masterKey) {
  if (!data) return null;
  return crypto.createHmac('sha256', masterKey).update(data).digest('hex');
}

/**
 * Generate a random encryption key (for initial setup)
 * @returns {string} Base64-encoded random key
 */
function generateKey() {
  return crypto.randomBytes(32).toString('base64');
}

/**
 * Encrypt specific database fields in a record
 * @param {Object} record - Database record
 * @param {string[]} fields - Fields to encrypt
 * @param {string} masterKey - Master encryption key
 * @returns {Object} Record with encrypted fields
 */
function encryptRecordFields(record, fields, masterKey) {
  const result = { ...record };
  for (const field of fields) {
    if (result[field] !== undefined && result[field] !== null) {
      result[field] = encrypt(String(result[field]), masterKey);
      result[`${field}_encrypted`] = true;
    }
  }
  return result;
}

/**
 * Decrypt specific database fields in a record
 * @param {Object} record - Database record with encrypted fields
 * @param {string[]} fields - Fields to decrypt
 * @param {string} masterKey - Master encryption key
 * @returns {Object} Record with decrypted fields
 */
function decryptRecordFields(record, fields, masterKey) {
  const result = { ...record };
  for (const field of fields) {
    if (result[field] !== undefined && result[field] !== null && result[`${field}_encrypted`]) {
      result[field] = decrypt(result[field], masterKey);
      delete result[`${field}_encrypted`];
    } else if (result[field] !== undefined && result[field] !== null) {
      // Try to decrypt anyway (legacy data)
      try {
        const decrypted = decrypt(result[field], masterKey);
        if (decrypted !== null) {
          result[field] = decrypted;
        }
      } catch {
        // Not encrypted, leave as-is
      }
    }
  }
  return result;
}

module.exports = {
  encrypt,
  decrypt,
  encryptObject,
  decryptObject,
  hash,
  generateKey,
  encryptRecordFields,
  decryptRecordFields,
  ALGORITHM,
  KEY_LENGTH
};
