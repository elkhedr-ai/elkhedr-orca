const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const {
  encrypt,
  decrypt,
  encryptObject,
  decryptObject,
  hash,
  generateKey,
  encryptRecordFields,
  decryptRecordFields,
  ALGORITHM
} = require('../../src/crypto/index.js');

const TEST_MASTER_KEY = 'test-master-key-123456789012345678901234567890';

describe('Crypto Module', () => {
  describe('encrypt/decrypt', () => {
    it('should encrypt and decrypt plaintext', () => {
      const plaintext = 'sensitive data here';
      const encrypted = encrypt(plaintext, TEST_MASTER_KEY);

      assert.ok(encrypted);
      assert.notStrictEqual(encrypted, plaintext);

      const decrypted = decrypt(encrypted, TEST_MASTER_KEY);
      assert.strictEqual(decrypted, plaintext);
    });

    it('should return null for null/undefined input', () => {
      assert.strictEqual(encrypt(null, TEST_MASTER_KEY), null);
      assert.strictEqual(encrypt(undefined, TEST_MASTER_KEY), null);
      assert.strictEqual(decrypt(null, TEST_MASTER_KEY), null);
      assert.strictEqual(decrypt(undefined, TEST_MASTER_KEY), null);
    });

    it('should produce different ciphertexts for same plaintext', () => {
      const plaintext = 'test';
      const encrypted1 = encrypt(plaintext, TEST_MASTER_KEY);
      const encrypted2 = encrypt(plaintext, TEST_MASTER_KEY);

      assert.notStrictEqual(encrypted1, encrypted2);
    });

    it('should fail decryption with wrong key', () => {
      const plaintext = 'secret';
      const encrypted = encrypt(plaintext, TEST_MASTER_KEY);

      assert.throws(() => {
        decrypt(encrypted, 'wrong-key-123456789012345678901234567890');
      }, /Decryption failed/);
    });

    it('should throw on short master key', () => {
      assert.throws(() => {
        encrypt('test', 'short');
      }, /at least 16 characters/);
    });
  });

  describe('encryptObject/decryptObject', () => {
    it('should encrypt and decrypt objects', () => {
      const obj = { apiKey: 'secret123', userId: 42 };
      const encrypted = encryptObject(obj, TEST_MASTER_KEY);

      assert.ok(encrypted);
      assert.strictEqual(typeof encrypted, 'string');

      const decrypted = decryptObject(encrypted, TEST_MASTER_KEY);
      assert.deepStrictEqual(decrypted, obj);
    });

    it('should return null for null input', () => {
      assert.strictEqual(encryptObject(null, TEST_MASTER_KEY), null);
      assert.strictEqual(decryptObject(null, TEST_MASTER_KEY), null);
    });
  });

  describe('hash', () => {
    it('should produce consistent HMAC', () => {
      const data = 'password123';
      const hash1 = hash(data, TEST_MASTER_KEY);
      const hash2 = hash(data, TEST_MASTER_KEY);

      assert.strictEqual(hash1, hash2);
      assert.strictEqual(hash1.length, 64); // hex sha256
    });

    it('should return null for null data', () => {
      assert.strictEqual(hash(null, TEST_MASTER_KEY), null);
    });
  });

  describe('generateKey', () => {
    it('should generate a random key', () => {
      const key1 = generateKey();
      const key2 = generateKey();

      assert.ok(key1);
      assert.ok(key2);
      assert.notStrictEqual(key1, key2);

      // Base64 decoded should be 32 bytes
      const decoded = Buffer.from(key1, 'base64');
      assert.strictEqual(decoded.length, 32);
    });
  });

  describe('encryptRecordFields/decryptRecordFields', () => {
    it('should encrypt and decrypt record fields', () => {
      const record = {
        id: 1,
        name: 'Test User',
        email: 'test@example.com',
        ssn: '123-45-6789'
      };

      const encrypted = encryptRecordFields(record, ['ssn', 'email'], TEST_MASTER_KEY);

      assert.ok(encrypted.ssn !== record.ssn);
      assert.ok(encrypted.email !== record.email);
      assert.strictEqual(encrypted.name, 'Test User');
      assert.ok(encrypted.ssn_encrypted);
      assert.ok(encrypted.email_encrypted);

      const decrypted = decryptRecordFields(encrypted, ['ssn', 'email'], TEST_MASTER_KEY);
      assert.strictEqual(decrypted.ssn, '123-45-6789');
      assert.strictEqual(decrypted.email, 'test@example.com');
    });
  });
});

describe('Crypto Key Rotation', () => {
  let db;

  beforeEach(async () => {
    process.env.ORCA_DB_URL = ':memory:';
    const { initializeDatabaseInstance } = require('../../src/db');
    db = await initializeDatabaseInstance();
  });

  afterEach(async () => {
    await db.close();
  });

  it('should register a new key version', async () => {
    const { registerNewKey, getCurrentKeyVersion } = require('../../src/crypto/key-rotation.js');

    const version = await registerNewKey(TEST_MASTER_KEY);
    assert.ok(version > 0);

    const current = await getCurrentKeyVersion();
    assert.strictEqual(current, version);
  });

  it('should rotate key and re-encrypt data', async () => {
    const { rotateKey, registerNewKey } = require('../../src/crypto/key-rotation.js');

    // Create a test table
    await db.getAdapter().execute(`
      CREATE TABLE IF NOT EXISTS test_sensitive (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        secret TEXT
      )
    `);

    // Insert encrypted data
    const secret = 'my-secret-data';
    const encrypted = encrypt(secret, TEST_MASTER_KEY);
    await db.getAdapter().execute(
      'INSERT INTO test_sensitive (secret) VALUES (?)',
      [encrypted]
    );

    // Register initial key
    await registerNewKey(TEST_MASTER_KEY);

    // Rotate
    const newKey = 'new-master-key-123456789012345678901234567890';
    const result = await rotateKey(TEST_MASTER_KEY, newKey, {
      tables: ['test_sensitive'],
      fields: [['secret']]
    });

    assert.ok(result.newKeyVersion > 0);
    assert.strictEqual(result.recordsProcessed, 1);

    // Verify data can be decrypted with new key
    const rows = await db.getAdapter().query('SELECT secret FROM test_sensitive');
    const decrypted = decrypt(rows[0].secret, newKey);
    assert.strictEqual(decrypted, secret);
  });
});

describe('Crypto TLS', () => {
  const { isTlsConfigured, getSecurityHeaders } = require('../../src/crypto/tls.js');

  it('should detect TLS configuration', () => {
    assert.strictEqual(isTlsConfigured(), false);

    process.env.ORCA_TLS_CERT_PATH = '/path/to/cert.pem';
    process.env.ORCA_TLS_KEY_PATH = '/path/to/key.pem';
    assert.strictEqual(isTlsConfigured(), true);

    delete process.env.ORCA_TLS_CERT_PATH;
    delete process.env.ORCA_TLS_KEY_PATH;
  });

  it('should return security headers', () => {
    const headers = getSecurityHeaders();
    assert.ok(headers['Strict-Transport-Security']);
    assert.ok(headers['X-Content-Type-Options']);
    assert.ok(headers['X-Frame-Options']);
  });
});
