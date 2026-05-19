const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { initializeDatabaseInstance } = require('../../src/db');
const {
  logAudit,
  logAuthEvent,
  logDataEvent,
  logApiKeyEvent,
  logWorkspaceEvent,
  logSystemEvent,
  verifyAuditLog,
  getAuditLogs,
  exportAuditLogs,
  getAuditStats,
  calculateHash
} = require('../../src/audit/logger');

describe('Audit Logger - Hash Chain', () => {
  let db;

  beforeEach(async () => {
    process.env.ORCA_DB_URL = ':memory:';
    db = await initializeDatabaseInstance();
  });

  afterEach(async () => {
    await db.close();
  });

  it('should calculate consistent hash', () => {
    const entry = {
      eventType: 'auth',
      userId: 1,
      userRole: 'admin',
      resourceType: 'user',
      resourceId: '1',
      action: 'login',
      status: 'success',
      metadata: null,
      timestamp: '2024-01-01T00:00:00.000Z'
    };

    const hash1 = calculateHash(entry, 'genesis');
    const hash2 = calculateHash(entry, 'genesis');
    assert.strictEqual(hash1, hash2);
    assert.strictEqual(hash1.length, 64); // SHA-256 hex length
  });

  it('should produce different hashes for different data', () => {
    const entry1 = { eventType: 'auth', action: 'login', status: 'success', userId: 1, userRole: null, resourceType: null, resourceId: null, metadata: null, timestamp: '2024-01-01T00:00:00.000Z' };
    const entry2 = { eventType: 'auth', action: 'logout', status: 'success', userId: 1, userRole: null, resourceType: null, resourceId: null, metadata: null, timestamp: '2024-01-01T00:00:00.000Z' };

    const hash1 = calculateHash(entry1, 'genesis');
    const hash2 = calculateHash(entry2, 'genesis');
    assert.notStrictEqual(hash1, hash2);
  });

  it('should produce different hashes for different previous hash', () => {
    const entry = { eventType: 'auth', action: 'login', status: 'success', userId: 1, userRole: null, resourceType: null, resourceId: null, metadata: null, timestamp: '2024-01-01T00:00:00.000Z' };

    const hash1 = calculateHash(entry, 'genesis');
    const hash2 = calculateHash(entry, 'previous');
    assert.notStrictEqual(hash1, hash2);
  });
});

describe('Audit Logger - Event Logging', () => {
  let db;
  let testUserId;

  beforeEach(async () => {
    process.env.ORCA_DB_URL = ':memory:';
    db = await initializeDatabaseInstance();
    // Insert a test user to satisfy foreign key constraints
    const result = await db.getAdapter().execute(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      ['audituser', 'audit@test.com', 'hash123']
    );
    testUserId = result.lastInsertRowid;
  });

  afterEach(async () => {
    await db.close();
  });

  it('should log generic audit event', async () => {
    const result = await logAudit({
      eventType: 'test',
      action: 'test_action',
      status: 'success'
    });

    assert.ok(result.id);
    assert.strictEqual(result.eventType, 'test');
    assert.strictEqual(result.action, 'test_action');
    assert.strictEqual(result.status, 'success');
    assert.ok(result.currentHash);
    assert.strictEqual(result.previousHash, 'genesis');
  });

  it('should log auth event', async () => {
    const result = await logAuthEvent('login', 'success', {
      userId: testUserId,
      userRole: 'admin',
      method: 'email'
    });

    assert.strictEqual(result.eventType, 'auth');
    assert.strictEqual(result.action, 'login');
    assert.strictEqual(result.userId, testUserId);
    assert.strictEqual(result.userRole, 'admin');
    assert.ok(result.metadata);
    const metadata = JSON.parse(result.metadata);
    assert.strictEqual(metadata.method, 'email');
  });

  it('should log data event', async () => {
    const result = await logDataEvent('view', 'session', 'sess-1', 'success', {
      userId: testUserId,
      metadata: { ip: '127.0.0.1' }
    });

    assert.strictEqual(result.eventType, 'data');
    assert.strictEqual(result.action, 'view');
    assert.strictEqual(result.resourceType, 'session');
    assert.strictEqual(result.resourceId, 'sess-1');
  });

  it('should log API key event', async () => {
    const result = await logApiKeyEvent('create', 'success', {
      userId: testUserId,
      keyId: 'key-1',
      keyPrefix: 'orca_live_abc'
    });

    assert.strictEqual(result.eventType, 'api_key');
    assert.strictEqual(result.action, 'create');
    assert.strictEqual(result.resourceType, 'api_key');
  });

  it('should log workspace event', async () => {
    const result = await logWorkspaceEvent('create', 'success', {
      userId: testUserId,
      workspaceId: 1,
      workspaceName: 'Test Workspace'
    });

    assert.strictEqual(result.eventType, 'workspace');
    assert.strictEqual(result.action, 'create');
    assert.strictEqual(result.resourceType, 'workspace');
  });

  it('should log system event', async () => {
    const result = await logSystemEvent('config_change', 'success', {
      userId: testUserId,
      metadata: { key: 'setting', oldValue: 'a', newValue: 'b' }
    });

    assert.strictEqual(result.eventType, 'system');
    assert.strictEqual(result.action, 'config_change');
    assert.strictEqual(result.resourceType, 'system');
  });

  it('should chain hashes between entries', async () => {
    const entry1 = await logAudit({ eventType: 'test', action: 'first', status: 'success' });
    const entry2 = await logAudit({ eventType: 'test', action: 'second', status: 'success' });

    assert.strictEqual(entry2.previousHash, entry1.currentHash);
  });
});

describe('Audit Logger - Verification', () => {
  let db;
  let testUserId;

  beforeEach(async () => {
    process.env.ORCA_DB_URL = ':memory:';
    db = await initializeDatabaseInstance();
    const result = await db.getAdapter().execute(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      ['audituser', 'audit@test.com', 'hash123']
    );
    testUserId = result.lastInsertRowid;
  });

  afterEach(async () => {
    await db.close();
  });

  it('should verify empty audit log', async () => {
    const result = await verifyAuditLog();
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.lastValidId, null);
    assert.deepStrictEqual(result.errors, []);
  });

  it('should verify valid audit log', async () => {
    await logAuthEvent('login', 'success', { userId: testUserId });
    await logAuthEvent('logout', 'success', { userId: testUserId });
    await logDataEvent('view', 'session', 's1', 'success', { userId: testUserId });

    const result = await verifyAuditLog();
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.lastValidId, 3);
    assert.deepStrictEqual(result.errors, []);
  });

  it('should detect tampered audit log', async () => {
    await logAuthEvent('login', 'success', { userId: testUserId });
    await logAuthEvent('logout', 'success', { userId: testUserId });

    // Tamper with an entry
    await db.getAdapter().execute(
      "UPDATE audit_logs SET action = 'hacked' WHERE id = 1"
    );

    const result = await verifyAuditLog();
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors.some(e => e.includes('Hash mismatch')));
  });

  it('should detect broken hash chain', async () => {
    await logAuthEvent('login', 'success', { userId: testUserId });
    await logAuthEvent('logout', 'success', { userId: testUserId });

    // Tamper with previous_hash
    await db.getAdapter().execute(
      "UPDATE audit_logs SET previous_hash = 'tampered' WHERE id = 2"
    );

    const result = await verifyAuditLog();
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some(e => e.includes('Previous hash mismatch')));
  });
});

describe('Audit Logger - Queries', () => {
  let db;
  let userId1;
  let userId2;

  beforeEach(async () => {
    process.env.ORCA_DB_URL = ':memory:';
    db = await initializeDatabaseInstance();

    const u1 = await db.getAdapter().execute(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      ['user1', 'user1@test.com', 'hash123']
    );
    userId1 = u1.lastInsertRowid;

    const u2 = await db.getAdapter().execute(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      ['user2', 'user2@test.com', 'hash123']
    );
    userId2 = u2.lastInsertRowid;

    await logAuthEvent('login', 'success', { userId: userId1 });
    await logAuthEvent('login', 'failure', { userId: userId2 });
    await logAuthEvent('logout', 'success', { userId: userId1 });
    await logDataEvent('view', 'session', 's1', 'success', { userId: userId1 });
    await logApiKeyEvent('create', 'success', { userId: userId1 });
  });

  afterEach(async () => {
    await db.close();
  });

  it('should get all audit logs', async () => {
    const logs = await getAuditLogs();
    assert.strictEqual(logs.length, 5);
  });

  it('should filter by event type', async () => {
    const logs = await getAuditLogs({ eventType: 'auth' });
    assert.strictEqual(logs.length, 3);
    assert.ok(logs.every(l => l.eventType === 'auth'));
  });

  it('should filter by status', async () => {
    const logs = await getAuditLogs({ status: 'failure' });
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].status, 'failure');
  });

  it('should filter by user id', async () => {
    const logs = await getAuditLogs({ userId: userId1 });
    assert.strictEqual(logs.length, 4);
  });

  it('should limit results', async () => {
    const logs = await getAuditLogs({ limit: 2 });
    assert.strictEqual(logs.length, 2);
  });

  it('should export audit logs', async () => {
    const exportData = await exportAuditLogs({ eventType: 'auth' });
    const parsed = JSON.parse(exportData);
    assert.strictEqual(parsed.totalEntries, 3);
    assert.ok(Array.isArray(parsed.logs));
    assert.ok(parsed.exportedAt);
  });

  it('should get audit statistics', async () => {
    const stats = await getAuditStats();
    assert.strictEqual(stats.total, 5);
    assert.strictEqual(stats.byType.auth, 3);
    assert.strictEqual(stats.byType.data, 1);
    assert.strictEqual(stats.byType.api_key, 1);
    assert.strictEqual(stats.byStatus.success, 4);
    assert.strictEqual(stats.byStatus.failure, 1);
  });
});
