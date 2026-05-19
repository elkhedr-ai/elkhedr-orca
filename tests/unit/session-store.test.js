const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { initializeDatabaseInstance, getDatabaseInstance } = require('../../src/db');
const { getSession, upsertSession } = require('../../src/session/store');

describe('Session Store', () => {
  let db;

  beforeEach(async () => {
    // Use an in-memory SQLite database for isolation
    process.env.ORCA_DB_URL = ':memory:';
    db = await initializeDatabaseInstance();
    // Ensure tables are created (they should be via initialization in getDatabaseInstance)
  });

  afterEach(async () => {
    await db.close();
  });

  it('should upsert and retrieve a session', async () => {
    const sessionId = 'test-session-1';
    const stats = { level: 'Thinking', sandbox: true, currentAgent: 'orchestrator' };

    // Upsert the session
    await upsertSession(sessionId, stats);

    // Retrieve the session
    const retrieved = await getSession(sessionId);
    console.log('retrieved:', retrieved);
    console.log('retrieved.currentAgent:', retrieved.currentAgent);
    assert.strictEqual(retrieved.level, stats.level);
    assert.strictEqual(retrieved.sandbox, stats.sandbox);
    assert.strictEqual(retrieved.currentAgent, stats.currentAgent);
  });

  it('should return null for non-existent session', async () => {
    const retrieved = await getSession('non-existent-session');
    assert.strictEqual(retrieved, null);
  });

  it('should update an existing session', async () => {
    const sessionId = 'test-session-2';
    const initialStats = { level: 'Instant', sandbox: false, currentAgent: null };
    const updatedStats = { level: 'Swarm', sandbox: true, currentAgent: 'agent-1' };

    // Insert initial
    await upsertSession(sessionId, initialStats);

    // Update
    await upsertSession(sessionId, updatedStats);

    // Retrieve and verify updated values
    const retrieved = await getSession(sessionId);
    assert.strictEqual(retrieved.level, updatedStats.level);
    assert.strictEqual(retrieved.sandbox, updatedStats.sandbox);
    assert.strictEqual(retrieved.currentAgent, updatedStats.currentAgent);
  });
});
