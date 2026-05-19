const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { initializeDatabaseInstance } = require('../../src/db');
const { getDatabaseInstance } = require('../../src/db');

describe('Knowledge Base DB methods', () => {
  let db;

  beforeEach(async () => {
    // Ensure DB uses SQLite memory for isolation (set env var if needed)
    process.env.ORCA_DB_URL = ':memory:';
    db = await initializeDatabaseInstance();
  });

  afterEach(async () => {
    await db.close();
  });

  it('create, update, retrieve and search entries', async () => {
    const entryId = await db.createKnowledgeEntry({
      agentId: 'test-agent',
      title: 'Orca architecture',
      content: '# Architecture\nDetails...',
      type: 'markdown'
    });
    assert.strictEqual(typeof entryId, 'number');
    assert.ok(entryId > 0);

    // Update content – creates version
    await db.updateKnowledgeEntry(entryId, { content: '# Updated Architecture\nNew details' });

    const entry = await db.getKnowledgeEntryById(entryId);
    assert.strictEqual(entry.title, 'Orca architecture');
    assert.ok(entry.content.includes('Updated Architecture'));

    const results = await db.searchKnowledge('test-agent', 'Orca');
    assert.strictEqual(Array.isArray(results), true);
    assert.ok(results.length > 0);
    assert.strictEqual(results[0].id, entryId);
  });
});
