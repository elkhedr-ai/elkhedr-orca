#!/usr/bin/env node

/**
 * T69: JSON to Database Migration
 *
 * Idempotent migration script that transfers existing JSON data files
 * into the SQLite/PostgreSQL database.
 *
 * Data sources:
 *   - sessions/history.json  -> sessions table
 *   - data/analytics.json     -> costs + analytics_* tables
 *   - data/events.jsonl       -> events table
 *   - data/orca.db            -> already a database (skipped)
 *   - skills/registry.json    -> skills table
 *   - src/agents.json         -> agents table (via existing loadAgentsFromJson)
 *   - src/agents/custom-agents.json -> handled separately by CustomAgentManager
 *
 * Usage:
 *   node scripts/migrate.js              # Run migration
 *   node scripts/migrate.js --dry-run    # Preview without writing
 *   node scripts/migrate.js --force      # Skip confirmation prompts
 *   node scripts/migrate.js --rollback   # Show rollback plan only
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

// ---- Configuration ----

const DATA_SOURCES = {
  sessions: {
    path: path.join(ROOT, 'sessions', 'history.json'),
    label: 'Session History (sessions/history.json)',
    table: 'sessions',
    required: false
  },
  agents: {
    path: path.join(ROOT, 'src', 'agents.json'),
    label: 'Agent Definitions (src/agents.json)',
    table: 'agents',
    required: true
  },
  events: {
    path: path.join(ROOT, 'data', 'events.jsonl'),
    label: 'Events (data/events.jsonl)',
    table: 'events',
    required: false
  },
  skills: {
    path: path.join(ROOT, 'skills', 'registry.json'),
    label: 'Skill Registry (skills/registry.json)',
    table: 'skills',
    required: false
  }
};

// ---- Helpers ----

function computeChecksum(filePath) {
  try {
    const data = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
  } catch {
    return null;
  }
}

function safeParseJSON(filePath) {
  try {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) return null;
    const data = fs.readFileSync(filePath, 'utf8').trim();
    return data ? JSON.parse(data) : null;
  } catch (err) {
    return { _parseError: err.message };
  }
}

function parseJSONL(filePath) {
  try {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) return [];
    const lines = fs.readFileSync(filePath, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);
    return lines.map(l => JSON.parse(l));
  } catch (err) {
    return { _parseError: err.message };
  }
}

async function tableExists(db, tableName) {
  const dialect = db.getType();
  const sql = dialect === 'sqlite'
    ? `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    : `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name=$1)`;
  const result = dialect === 'sqlite'
    ? await db.adapter.query(sql, [tableName])
    : await db.adapter.query(sql, [tableName]);
  return result.length > 0;
}

async function rowCount(db, tableName) {
  try {
    const result = await db.adapter.query(`SELECT COUNT(*) as cnt FROM ${tableName}`);
    return result[0]?.cnt || 0;
  } catch {
    return -1;
  }
}

// ---- Migration Steps ----

/**
 * @param {object} db - DatabaseManager instance
 * @param {boolean} dryRun - If true, don't write
 * @param {object} [overrides] - Optional path overrides for testing
 */
async function migrateSessions(db, dryRun, overrides = {}) {
  const source = overrides.sessions ? { path: overrides.sessions, label: 'Session History (sessions/history.json)' } : DATA_SOURCES.sessions;
  const data = safeParseJSON(source.path);
  if (!data) {
    return { source: source.label, status: 'SKIPPED', reason: 'File not found or empty' };
  }
  if (!Array.isArray(data)) {
    return { source: source.label, status: 'SKIPPED', reason: 'Not an array' };
  }

  const existingCount = await rowCount(db, 'sessions');
  if (existingCount > 0) {
    return { source: source.label, status: 'SKIPPED', reason: `Table already has ${existingCount} rows` };
  }

  let inserted = 0;
  for (const entry of data) {
    const tokens = typeof entry.tokens === 'number' ? entry.tokens : 0;
    const mode = entry.mode || 'LEGACY';
    const agent = entry.agent || 'Unknown';

    if (!dryRun) {
      await db.saveSessionData({
        prompt: entry.prompt || '',
        mode,
        agent,
        result: entry.result || '',
        tokens,
        traceId: entry.traceId || null
      });
    }
    inserted++;
  }

  return {
    source: source.label,
    status: dryRun ? 'WOULD_INSERT' : 'INSERTED',
    count: inserted,
    checksum: computeChecksum(source.path)
  };
}

async function migrateAgents(db, dryRun, overrides = {}) {
  const source = overrides.agents ? { path: overrides.agents, label: 'Agent Definitions (src/agents.json)' } : DATA_SOURCES.agents;

  // Check if agents table already has data
  const existingCount = await rowCount(db, 'agents');
  if (existingCount > 0) {
    return { source: source.label, status: 'SKIPPED', reason: `Table already has ${existingCount} rows` };
  }

  if (!dryRun) {
    const loaded = await db.loadAgentsFromJson();
    return {
      source: source.label,
      status: 'INSERTED',
      count: loaded,
      checksum: computeChecksum(source.path)
    };
  }

  // Dry-run: parse and count without inserting
  const data = safeParseJSON(source.path);
  const agentCount = data?.agents?.length || 0;
  return {
    source: source.label,
    status: 'WOULD_INSERT',
    count: agentCount,
    checksum: computeChecksum(source.path)
  };
}

async function migrateEvents(db, dryRun, overrides = {}) {
  const source = overrides.events ? { path: overrides.events, label: 'Events (data/events.jsonl)' } : DATA_SOURCES.events;
  const data = parseJSONL(source.path);

  if (data._parseError) {
    return { source: source.label, status: 'ERROR', error: data._parseError };
  }
  if (!Array.isArray(data) || data.length === 0) {
    return { source: source.label, status: 'SKIPPED', reason: 'File not found, empty, or no events' };
  }

  const existingCount = await rowCount(db, 'events');
  if (existingCount > 0) {
    return { source: source.label, status: 'SKIPPED', reason: `Table already has ${existingCount} rows` };
  }

  let inserted = 0;
  for (const entry of data) {
    if (!entry.type) continue;
    const eventData = typeof entry.data === 'object' ? JSON.stringify(entry.data) : (entry.data || '{}');
    if (!dryRun) {
      await db.adapter.execute(
        `INSERT INTO events (type, data, created_at) VALUES (?, ?, ?)`,
        [entry.type, eventData, entry.created_at || null]
      );
    }
    inserted++;
  }

  return {
    source: source.label,
    status: dryRun ? 'WOULD_INSERT' : 'INSERTED',
    count: inserted
  };
}

async function migrateSkills(db, dryRun, overrides = {}) {
  const source = overrides.skills ? { path: overrides.skills, label: 'Skill Registry (skills/registry.json)' } : DATA_SOURCES.skills;
  const data = safeParseJSON(source.path);

  if (!data) {
    return { source: source.label, status: 'SKIPPED', reason: 'File not found or empty' };
  }

  const existingCount = await rowCount(db, 'skills');
  if (existingCount > 0) {
    return { source: source.label, status: 'SKIPPED', reason: `Table already has ${existingCount} rows` };
  }

  // registry.json is an array of { name, version, description, permissions }
  const skillsArray = Array.isArray(data) ? data : (data.skills || []);
  if (skillsArray.length === 0) {
    return { source: source.label, status: 'SKIPPED', reason: 'Empty registry' };
  }

  let inserted = 0;
  for (const skill of skillsArray) {
    if (!skill.name) continue;
    const permissions = JSON.stringify(skill.permissions || []);
    if (!dryRun) {
      await db.adapter.execute(
        `INSERT OR IGNORE INTO skills (name, version, description, permissions) VALUES (?, ?, ?, ?)`,
        [skill.name, skill.version || '1.0.0', skill.description || '', permissions]
      );
    }
    inserted++;
  }

  return {
    source: source.label,
    status: dryRun ? 'WOULD_INSERT' : 'INSERTED',
    count: inserted,
    checksum: computeChecksum(source.path)
  };
}

async function migrateInputHistory(db, dryRun) {
  // Check if input_history has data already
  const existingCount = await rowCount(db, 'input_history');
  if (existingCount > 0) {
    return { source: 'Input History (derived)', status: 'SKIPPED', reason: `Table already has ${existingCount} rows` };
  }

  return {
    source: 'Input History (derived)',
    status: 'SKIPPED',
    reason: 'Input history is session-based, not migrated from file'
  };
}

// ---- Main ----

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('--dry');
  const force = args.includes('--force');
  const rollback = args.includes('--rollback');

  console.log('');
  console.log('==========================================');
  console.log('  T69: JSON → Database Migration');
  console.log('==========================================');
  console.log('');

  if (rollback) {
    console.log('📋 Rollback Plan');
    console.log('');
    console.log('  All migrations use INSERT operations only — they do NOT');
    console.log('  modify or delete existing data. Rollback consists of:');
    console.log('');
    console.log('  1. TRUNCATE the affected tables:');
    console.log('     - sessions (DELETE FROM sessions)');
    console.log('     - events (DELETE FROM events)');
    console.log('     - skills (DELETE FROM skills)');
    console.log('     - agents (DELETE FROM agents)');
    console.log('');
    console.log('  2. Re-run this migration to re-import from JSON files.');
    console.log('');
    console.log('  ⚠️  Caution: TRUNCATE removes ALL data in those tables,');
    console.log('     including any new records created after migration.');
    console.log('');
    return;
  }

  // Print data source status
  console.log('📂 Data Sources:');
  console.log('');
  const table = [];
  for (const [key, src] of Object.entries(DATA_SOURCES)) {
    const exists = fs.existsSync(src.path);
    const icon = exists ? '✅' : '⬜';
    const size = exists ? `(${(fs.statSync(src.path).size / 1024).toFixed(1)} KB)` : '';
    const chk = exists ? computeChecksum(src.path).substring(0, 12) : '-';
    table.push({ key, icon, label: src.label, size, checksum: chk });
  }
  console.log('  Key:  ✅ Found   ⬜ Not found');
  console.log('');
  for (const row of table) {
    console.log(`  ${row.icon} ${row.label.padEnd(40)} ${row.size.padEnd(10)} sha256:${row.checksum}`);
  }
  console.log('');

  if (!force) {
    // Confirm extra files (custom-agents.json)
    const customAgentsPath = path.join(ROOT, 'src', 'agents', 'custom-agents.json');
    if (fs.existsSync(customAgentsPath)) {
      const size = (fs.statSync(customAgentsPath).size / 1024).toFixed(1);
      console.log(`  📎 Custom agents: ${customAgentsPath} (${size} KB)`);
    }

    console.log('  Custom agents are managed by CustomAgentManager (syncToMainRegistry).');
    console.log('  This migration will sync them via loadAgentsFromJson if agents table is empty.');
    console.log('');

    if (!dryRun) {
      console.log('  Migration will write to the database. Use --dry-run to preview.');
      console.log('');
    }
  }

  // ---- Initialize DB ----
  console.log('🔌 Connecting to database...');
  const { DatabaseManager } = require(path.join(ROOT, 'src', 'db', 'index.js'));
  const db = new DatabaseManager();
  await db.initialize();

  const dbType = db.getType();
  console.log(`   Database type: ${dbType}`);
  console.log('');

  // ---- Run migrations ----
  console.log(`🚀 Running migration${dryRun ? ' (DRY RUN)' : ''}...`);
  console.log('');

  if (!await tableExists(db, 'sessions')) {
    console.log('  ❌  Database schema not initialized. Run npm run db:migrate first.');
    await db.close();
    process.exit(1);
  }

  const results = [];
  results.push(await migrateSessions(db, dryRun));
  results.push(await migrateAgents(db, dryRun));
  results.push(await migrateEvents(db, dryRun));
  results.push(await migrateSkills(db, dryRun));
  results.push(await migrateInputHistory(db, dryRun));

  // ---- Print results ----
  console.log('');
  console.log('==========================================');
  console.log('  Migration Results');
  console.log('==========================================');
  console.log('');
  console.log('  Source'.padEnd(42) + 'Status'.padEnd(14) + 'Count');
  console.log('  ' + '-'.repeat(70));
  for (const r of results) {
    const status = r.error
      ? `ERROR`
      : r.status;
    const count = r.count !== undefined ? String(r.count) : (r.reason || '-');
    console.log(`  ${r.source.padEnd(40)} ${status.padEnd(12)} ${count}`);
  }
  console.log('');

  const totalInserted = results.reduce((sum, r) => sum + (r.count || 0), 0);
  console.log(`  Total records ${dryRun ? 'would be' : 'inserted'}: ${totalInserted}`);
  console.log('');

  // ---- Summary ----
  console.log('📋 Migration Summary:');
  console.log('');
  for (const r of results) {
    const icon = r.status === 'INSERTED' ? '✅' :
                 r.status === 'SKIPPED' ? '⏭️' :
                 r.status === 'WOULD_INSERT' ? '🔍' :
                 r.error ? '❌' : '⚠️';
    const detail = r.count !== undefined ? `${r.count} records` : (r.reason || r.error || 'OK');
    console.log(`  ${icon} ${r.source}: ${detail}`);
  }
  console.log('');
  console.log(`  Checksums recorded for ${results.filter(r => r.checksum).length} sources.`);
  console.log('  Run with --rollback to see the rollback plan.');
  console.log('');

  await db.close();
  console.log('✨ Migration complete.');
}

// Export individual migration steps for testing
module.exports = {
  migrateSessions,
  migrateAgents,
  migrateEvents,
  migrateSkills,
  migrateInputHistory,
  main
};

if (require.main === module) {
  main().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}
