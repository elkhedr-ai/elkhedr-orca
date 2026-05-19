const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { initializeDatabaseInstance } = require('../../src/db');
const { registerUser } = require('../../src/auth/index');
const {
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
} = require('../../src/auth/api-keys');

describe('API Key Generation', () => {
  it('should generate raw key with correct prefix', () => {
    const key = generateRawKey();
    assert.ok(key.startsWith(KEY_PREFIX));
    assert.strictEqual(key.length, KEY_PREFIX.length + 48);
  });

  it('should generate unique keys', () => {
    const key1 = generateRawKey();
    const key2 = generateRawKey();
    assert.notStrictEqual(key1, key2);
  });

  it('should hash and verify key', async () => {
    const rawKey = generateRawKey();
    const hash = await hashKey(rawKey);
    assert.ok(hash);
    assert.ok(await verifyKey(rawKey, hash));
    assert.ok(!(await verifyKey('wrong-key', hash)));
  });
});

describe('API Key Management', () => {
  let db;
  let userId;

  beforeEach(async () => {
    process.env.ORCA_DB_URL = ':memory:';
    db = await initializeDatabaseInstance();
    const user = await registerUser('testuser', 'test@test.com', 'password123');
    userId = user.user.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it('should create API key with default read scope', async () => {
    const result = await createApiKey(userId, 'My Test Key');
    assert.ok(result.rawKey);
    assert.ok(result.rawKey.startsWith(KEY_PREFIX));
    assert.strictEqual(result.keyData.name, 'My Test Key');
    assert.deepStrictEqual(result.keyData.scopes, ['read']);
    assert.strictEqual(result.keyData.userId, userId);
  });

  it('should create API key with multiple scopes', async () => {
    const result = await createApiKey(userId, 'Admin Key', ['read', 'write', 'admin']);
    assert.deepStrictEqual(result.keyData.scopes, ['read', 'write', 'admin']);
  });

  it('should reject invalid scopes', async () => {
    await assert.rejects(
      createApiKey(userId, 'Bad Key', ['read', 'delete']),
      /Invalid scopes/
    );
  });

  it('should create API key with expiration', async () => {
    const result = await createApiKey(userId, 'Temp Key', ['read'], 30);
    assert.ok(result.keyData.expiresAt);
    const expiresAt = new Date(result.keyData.expiresAt);
    const now = new Date();
    const diffDays = (expiresAt - now) / (1000 * 60 * 60 * 24);
    assert.ok(diffDays >= 29 && diffDays <= 30);
  });

  it('should validate a valid API key', async () => {
    const created = await createApiKey(userId, 'Valid Key', ['read', 'write']);
    const validated = await validateApiKey(created.rawKey);
    assert.ok(validated);
    assert.strictEqual(validated.userId, userId);
    assert.deepStrictEqual(validated.scopes, ['read', 'write']);
    assert.ok(validated.keyId);
  });

  it('should reject invalid API key', async () => {
    const result = await validateApiKey('invalid-key');
    assert.strictEqual(result, null);
  });

  it('should reject wrong prefix API key', async () => {
    const result = await validateApiKey('wrong_prefix_12345');
    assert.strictEqual(result, null);
  });

  it('should get user API keys', async () => {
    await createApiKey(userId, 'Key 1', ['read']);
    await createApiKey(userId, 'Key 2', ['read', 'write']);

    const keys = await getUserApiKeys(userId);
    assert.strictEqual(keys.length, 2);
    assert.ok(keys.some(k => k.name === 'Key 1'));
    assert.ok(keys.some(k => k.name === 'Key 2'));
  });

  it('should not expose full key in getUserApiKeys', async () => {
    const created = await createApiKey(userId, 'Secret Key');
    const keys = await getUserApiKeys(userId);
    assert.strictEqual(keys.length, 1);
    assert.ok(!keys[0].prefix.includes(created.rawKey.substring(KEY_PREFIX.length + 8)));
    assert.ok(keys[0].prefix.startsWith(KEY_PREFIX));
  });

  it('should revoke API key', async () => {
    const created = await createApiKey(userId, 'To Revoke');
    const keys = await getUserApiKeys(userId);
    const keyId = keys[0].id;

    await revokeApiKey(keyId, userId);

    // Should no longer validate
    const validated = await validateApiKey(created.rawKey);
    assert.strictEqual(validated, null);

    // Should show as revoked in list
    const updatedKeys = await getUserApiKeys(userId);
    assert.strictEqual(updatedKeys[0].isActive, false);
    assert.ok(updatedKeys[0].revokedAt);
  });

  it('should reject revoking key owned by another user', async () => {
    const otherUser = await registerUser('other', 'other@test.com', 'password123');
    await createApiKey(otherUser.user.id, 'Other Key');
    const keys = await getUserApiKeys(otherUser.user.id);

    await assert.rejects(
      revokeApiKey(keys[0].id, userId),
      /API key not found or access denied/
    );
  });

  it('should admin revoke any key', async () => {
    const otherUser = await registerUser('other', 'other@test.com', 'password123');
    const created = await createApiKey(otherUser.user.id, 'Other Key');

    const keys = await getUserApiKeys(otherUser.user.id);
    await adminRevokeApiKey(keys[0].id);

    const validated = await validateApiKey(created.rawKey);
    assert.strictEqual(validated, null);
  });

  it('should delete API key permanently', async () => {
    await createApiKey(userId, 'To Delete');
    const keys = await getUserApiKeys(userId);
    const keyId = keys[0].id;

    await deleteApiKey(keyId);
    const remaining = await getUserApiKeys(userId);
    assert.strictEqual(remaining.length, 0);
  });

  it('should reject deleting non-existent key', async () => {
    await assert.rejects(
      deleteApiKey(99999),
      /API key not found/
    );
  });

  it('should expire keys after expiration date', async () => {
    const created = await createApiKey(userId, 'Expired Key', ['read'], -1); // Expired yesterday

    // Cleanup should revoke it
    const revoked = await cleanupExpiredKeys();
    assert.strictEqual(revoked, 1);

    const validated = await validateApiKey(created.rawKey);
    assert.strictEqual(validated, null);
  });

  it('should not expire valid keys', async () => {
    await createApiKey(userId, 'Valid Key', ['read'], 30); // Expires in 30 days
    const revoked = await cleanupExpiredKeys();
    assert.strictEqual(revoked, 0);
  });

  it('should track key usage', async () => {
    const created = await createApiKey(userId, 'Tracked Key');

    // First use
    await validateApiKey(created.rawKey);

    const keys = await getUserApiKeys(userId);
    assert.ok(keys[0].lastUsedAt);
  });

  it('should check scopes correctly', () => {
    assert.strictEqual(hasScope(['read'], 'read'), true);
    assert.strictEqual(hasScope(['read'], 'write'), false);
    assert.strictEqual(hasScope(['read', 'write'], 'write'), true);
    assert.strictEqual(hasScope(['admin'], 'read'), true); // Admin grants all
    assert.strictEqual(hasScope(['admin'], 'write'), true);
    assert.strictEqual(hasScope(['admin'], 'admin'), true);
  });

  it('should get API key stats', async () => {
    await createApiKey(userId, 'Key 1', ['read']);
    await createApiKey(userId, 'Key 2', ['write']);
    const expired = await createApiKey(userId, 'Expired', ['read'], -1);
    await cleanupExpiredKeys();

    const stats = await getApiKeyStats(userId);
    assert.strictEqual(stats.total, 3);
    assert.strictEqual(stats.active, 2);
    assert.strictEqual(stats.revoked, 1); // Expired keys are revoked by cleanup
    assert.strictEqual(stats.expired, 0); // After cleanup, no expired-only keys remain
  });

  it('should show key status correctly', async () => {
    await createApiKey(userId, 'Active Key', ['read']);
    const revoked = await createApiKey(userId, 'Revoked Key');
    const keys = await getUserApiKeys(userId);
    const revokedKeyId = keys.find(k => k.name === 'Revoked Key').id;
    await revokeApiKey(revokedKeyId, userId);

    const updatedKeys = await getUserApiKeys(userId);
    assert.strictEqual(updatedKeys.find(k => k.name === 'Active Key').isActive, true);
    assert.strictEqual(updatedKeys.find(k => k.name === 'Revoked Key').isActive, false);
  });
});
