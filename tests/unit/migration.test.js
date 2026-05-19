/**
 * Tests for JSON to Database Migration script (T69)
 *
 * Tests idempotency, dry-run, data integrity, and edge cases.
 */

const { describe, it, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..', '..');

// Temporary test fixtures directory
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-migration-test-'));

// ---- Mock data fixtures ----

const mockSessions = [
  { timestamp: '2026-01-01T00:00:00.000Z', prompt: 'Hello', mode: 'CHAT', agent: 'CEO', result: 'Hi there', tokens: 100 },
  { timestamp: '2026-01-02T00:00:00.000Z', prompt: 'What is AI?', result: 'Artificial Intelligence...', tokens: 250 }
];

const mockAgents = {
  orchestrator: 'orchestrator',
  agents: [
    { id: 2, role: 'Test Agent', model: 'model-1', department: 'Engineering', fallbackModel: 'fb-1' },
    { id: 3, role: 'Test Agent 2', model: 'model-2', department: 'Marketing', fallbackModel: 'fb-2' }
  ]
};

const mockEvents = [
  { type: 'task.completed', data: { taskId: 1 }, created_at: '2026-01-01T00:00:00.000Z' },
  { type: 'error.occurred', data: { code: 'E001' }, created_at: '2026-01-02T00:00:00.000Z' }
];

// ---- Test helpers ----

function writeFixture(dir, filename, data) {
  const filePath = path.join(dir, filename);
  const ext = path.extname(filename);
  if (ext === '.jsonl') {
    fs.writeFileSync(filePath, data.map(d => JSON.stringify(d)).join('\n'));
  } else {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }
  return filePath;
}

/**
 * Create a DatabaseManager with an in-memory SQLite adapter.
 */
async function createTestDbManager() {
  const Database = require('better-sqlite3');
  const { DatabaseAdapter } = require(path.join(ROOT, 'src', 'db', 'adapters', 'base.js'));
  const { DatabaseManager } = require(path.join(ROOT, 'src', 'db', 'index.js'));

  class InMemoryAdapter extends DatabaseAdapter {
    constructor() {
      super();
      this.db = new Database(':memory:');
      this._type = 'sqlite';
    }

    getType() { return this._type; }
    async connect() {}
    async initialize() {}
    isConnected() { return true; }

    async execute(sql, params = []) {
      const stmt = this.db.prepare(sql);
      if (sql.trim().toUpperCase().startsWith('SELECT') || sql.trim().toUpperCase().startsWith('WITH')) {
        return stmt.all(...params);
      }
      return stmt.run(...params);
    }

    async run(sql, params = []) {
      const stmt = this.db.prepare(sql);
      return stmt.run(...params);
    }

    async query(sql, params = []) {
      const stmt = this.db.prepare(sql);
      return stmt.all(...params);
    }

    close() { this.db.close(); }
    async disconnect() { this.close(); }
    getClient() { return this.db; }

    async transaction(callback) {
      const tx = this.db.transaction(callback);
      return tx();
    }

    prepare(sql) {
      const stmt = this.db.prepare(sql);
      return {
        run: (...args) => stmt.run(...args),
        all: (...args) => stmt.all(...args),
        get: (...args) => stmt.get(...args)
      };
    }
  }

  const adapter = new InMemoryAdapter();

  // Create a DatabaseManager and inject the adapter
  const db = new DatabaseManager();
  db.adapter = adapter;
  db.initialized = true;

  // prepareStatements will be called after schema setup
  db.preparedStatements = {};

  return { db, adapter };
}

async function setupSchema(adapter) {
  const schema = fs.readFileSync(path.join(ROOT, 'src', 'db', 'schema.sql'), 'utf8');
  // Split on semicolons but skip SQL comment lines (including indented ones)
  const statements = schema
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n')
    .replace(/--[^\n]*/g, '') // Remove inline comments
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .filter(s => !s.startsWith('--')); // Catch any remaining comment-only fragments

  for (const stmt of statements) {
    adapter.db.prepare(stmt).run();
  }
}

describe('Migration Script (T69)', () => {
  let fixtureDir;
  let dbManager;
  let adapter;

  beforeEach(async () => {
    fixtureDir = fs.mkdtempSync(path.join(TMP, 'fixture-'));

    // Write mock data files
    writeFixture(fixtureDir, 'history.json', mockSessions);
    writeFixture(fixtureDir, 'agents.json', mockAgents);
    writeFixture(fixtureDir, 'events.jsonl', mockEvents);
    writeFixture(fixtureDir, 'registry.json', []);

    // Create in-memory DatabaseManager with schema
    const result = await createTestDbManager();
    dbManager = result.db;
    adapter = result.adapter;
    // Schema must be created BEFORE prepareStatements
    await setupSchema(adapter);
    // Re-prepare statements now that tables exist
    await dbManager.prepareStatements();

    // Stub loadAgentsFromJson so it reads from our fixture
    const origLoadAgents = dbManager.loadAgentsFromJson.bind(dbManager);
    dbManager.loadAgentsFromJson = async () => {
      const data = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'agents.json'), 'utf8'));
      const agents = data.agents || [];
      for (const agent of agents) {
        await adapter.execute(
          `INSERT OR IGNORE INTO agents (name, role, model, fallbackModel, department) VALUES (?, ?, ?, ?, ?)`,
          [agent.role || agent.name || 'Unknown', agent.role || '', agent.model || '', agent.fallbackModel || '', agent.department || '']
        );
      }
      return agents.length;
    };
  });

  afterEach(async () => {
    try {
      if (dbManager) await dbManager.close();
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    } catch { /* ok */ }
  });

  after(() => {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ok */ }
  });

  // ---- Individual migration steps ----

  describe('migrate sessions', () => {
    it('should insert sessions into the database', async () => {
      const { migrateSessions } = require(path.join(ROOT, 'scripts', 'migrate.js'));
      const result = await migrateSessions(dbManager, false, {
        sessions: path.join(fixtureDir, 'history.json')
      });
      assert.strictEqual(result.status, 'INSERTED');
      assert.strictEqual(result.count, 2);

      const rows = await adapter.query('SELECT * FROM sessions ORDER BY id');
      assert.strictEqual(rows.length, 2);
      assert.strictEqual(rows[0].prompt, 'Hello');
      assert.strictEqual(rows[1].prompt, 'What is AI?');
    });
  });

  describe('migrate agents', () => {
    it('should insert agents into the database', async () => {
      const { migrateAgents } = require(path.join(ROOT, 'scripts', 'migrate.js'));
      const result = await migrateAgents(dbManager, false, {
        agents: path.join(fixtureDir, 'agents.json')
      });
      assert.strictEqual(result.status, 'INSERTED');
      assert.strictEqual(result.count, 2);

      const rows = await adapter.query('SELECT * FROM agents ORDER BY id');
      assert.strictEqual(rows.length, 2);
    });
  });

  describe('migrate events', () => {
    it('should insert events from JSONL file', async () => {
      const { migrateEvents } = require(path.join(ROOT, 'scripts', 'migrate.js'));
      const result = await migrateEvents(dbManager, false, {
        events: path.join(fixtureDir, 'events.jsonl')
      });
      assert.strictEqual(result.status, 'INSERTED');
      assert.strictEqual(result.count, 2);

      const rows = await adapter.query('SELECT * FROM events ORDER BY id');
      assert.strictEqual(rows.length, 2);
      assert.strictEqual(rows[0].type, 'task.completed');
      assert.strictEqual(rows[1].type, 'error.occurred');
    });
  });

  describe('migrate skills', () => {
    it('should insert skills from registry file', async () => {
      writeFixture(fixtureDir, 'registry.json', [
        { name: 'test-skill', version: '1.0.0', description: 'A test', permissions: ['read'] }
      ]);

      const { migrateSkills } = require(path.join(ROOT, 'scripts', 'migrate.js'));
      const result = await migrateSkills(dbManager, false, {
        skills: path.join(fixtureDir, 'registry.json')
      });
      assert.strictEqual(result.status, 'INSERTED');
      assert.strictEqual(result.count, 1);

      const rows = await adapter.query("SELECT * FROM skills WHERE name = 'test-skill'");
      assert.strictEqual(rows.length, 1);
      assert.strictEqual(rows[0].version, '1.0.0');
    });
  });

  // ---- Idempotency ----

  describe('idempotency', () => {
    it('should skip sessions on second run', async () => {
      await adapter.execute(
        `INSERT INTO sessions (prompt, mode, agent, result, tokens) VALUES (?, ?, ?, ?, ?)`,
        ['pre', 'CHAT', 'CEO', 'pre-existing', 0]
      );

      const { migrateSessions } = require(path.join(ROOT, 'scripts', 'migrate.js'));
      const result = await migrateSessions(dbManager, false, {
        sessions: path.join(fixtureDir, 'history.json')
      });
      assert.strictEqual(result.status, 'SKIPPED');
    });

    it('should skip agents on second run', async () => {
      await adapter.execute(
        `INSERT INTO agents (name, role, model, fallbackModel) VALUES (?, ?, ?, ?)`,
        ['Pre', 'pre-role', 'pre-model', 'pre-fb']
      );

      const { migrateAgents } = require(path.join(ROOT, 'scripts', 'migrate.js'));
      const result = await migrateAgents(dbManager, false, {
        agents: path.join(fixtureDir, 'agents.json')
      });
      assert.strictEqual(result.status, 'SKIPPED');
    });

    it('should skip skills on second run', async () => {
      await adapter.execute(
        `INSERT INTO skills (name, version, description, permissions) VALUES (?, ?, ?, ?)`,
        ['existing-skill', '1.0.0', 'exists', '[]']
      );

      const { migrateSkills } = require(path.join(ROOT, 'scripts', 'migrate.js'));
      const result = await migrateSkills(dbManager, false, {
        skills: path.join(fixtureDir, 'registry.json')
      });
      assert.strictEqual(result.status, 'SKIPPED');
    });
  });

  // ---- Dry run ----

  describe('dry run', () => {
    it('should not insert any data', async () => {
      const { migrateSessions, migrateEvents } = require(path.join(ROOT, 'scripts', 'migrate.js'));
      await migrateSessions(dbManager, true, { sessions: path.join(fixtureDir, 'history.json') });
      await migrateEvents(dbManager, true, { events: path.join(fixtureDir, 'events.jsonl') });

      const sessions = await adapter.query('SELECT COUNT(*) as cnt FROM sessions');
      const events = await adapter.query('SELECT COUNT(*) as cnt FROM events');
      assert.strictEqual(sessions[0].cnt, 0);
      assert.strictEqual(events[0].cnt, 0);
    });

    it('should return WOULD_INSERT status', async () => {
      const { migrateSessions } = require(path.join(ROOT, 'scripts', 'migrate.js'));
      const result = await migrateSessions(dbManager, true, { sessions: path.join(fixtureDir, 'history.json') });
      assert.strictEqual(result.status, 'WOULD_INSERT');
      assert.strictEqual(result.count, 2);
    });

    it('should include checksum in results for file-based sources', async () => {
      const { migrateSessions } = require(path.join(ROOT, 'scripts', 'migrate.js'));
      const result = await migrateSessions(dbManager, true, { sessions: path.join(fixtureDir, 'history.json') });
      assert.ok(result.checksum);
      assert.strictEqual(result.checksum.length, 64);
    });
  });

  // ---- Edge cases ----

  describe('edge cases', () => {
    it('should handle non-existent files', async () => {
      const { migrateSessions } = require(path.join(ROOT, 'scripts', 'migrate.js'));
      const result = await migrateSessions(dbManager, false, {
        sessions: path.join(fixtureDir, 'nonexistent.json')
      });
      assert.strictEqual(result.status, 'SKIPPED');
    });

    it('should handle empty events file', async () => {
      fs.writeFileSync(path.join(fixtureDir, 'events.jsonl'), '');
      const { migrateEvents } = require(path.join(ROOT, 'scripts', 'migrate.js'));
      const result = await migrateEvents(dbManager, false, {
        events: path.join(fixtureDir, 'events.jsonl')
      });
      assert.strictEqual(result.status, 'SKIPPED');
    });

    it('should handle empty skills registry', async () => {
      fs.writeFileSync(path.join(fixtureDir, 'registry.json'), '[]');
      const { migrateSkills } = require(path.join(ROOT, 'scripts', 'migrate.js'));
      const result = await migrateSkills(dbManager, false, {
        skills: path.join(fixtureDir, 'registry.json')
      });
      assert.strictEqual(result.status, 'SKIPPED');
    });
  });

  // ---- Module exports ----

  describe('module exports', () => {
    it('should export all migration functions', () => {
      const mod = require(path.join(ROOT, 'scripts', 'migrate.js'));
      assert.strictEqual(typeof mod.migrateSessions, 'function');
      assert.strictEqual(typeof mod.migrateAgents, 'function');
      assert.strictEqual(typeof mod.migrateEvents, 'function');
      assert.strictEqual(typeof mod.migrateSkills, 'function');
      assert.strictEqual(typeof mod.migrateInputHistory, 'function');
      assert.strictEqual(typeof mod.main, 'function');
    });
  });
});
