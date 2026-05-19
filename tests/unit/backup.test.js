/**
 * Tests for T57: Database Backup Strategy
 * Tests BackupManager, backup creation, rotation, and listing.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Mock logger
require.cache[require.resolve('../../src/utils/logger.js')] = {
  loaded: true,
  exports: { logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }
};

// Mock database adapter
const mockAdapter = {
  getType: () => 'sqlite',
  isConnected: () => true,
  getClient: () => ({
    name: '/tmp/test-orca.db',
    exec: (sql) => {
      // Simulate VACUUM INTO by writing a dummy file
      const match = sql.match(/VACUUM INTO '([^']+)'/);
      if (match) {
        fs.writeFileSync(match[1], 'MOCK_DB_CONTENT');
      }
    }
  })
};

require.cache[require.resolve('../../src/db/index.js')] = {
  loaded: true,
  exports: {
    getDatabaseInstance: () => ({
      getAdapter: () => mockAdapter,
      getType: () => 'sqlite',
      initialize: async () => {},
      adapter: mockAdapter
    }),
    getAdapter: () => mockAdapter
  }
};

const { BackupManager, getBackupManager, resetBackupManager } = require('../../src/db/backup.js');

describe('T57: BackupManager', () => {
  let tmpDir;
  let manager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-backup-test-'));
    manager = new BackupManager({
      backupDir: path.join(tmpDir, 'backups'),
      retentionDays: 7
    });
  });

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should ensure backup directory exists', () => {
    manager.ensureBackupDir();
    assert.ok(fs.existsSync(manager.backupDir));
  });

  it('should create a backup file', async () => {
    const result = await manager.createBackup({ type: 'sqlite' });
    assert.ok(result.file);
    assert.ok(result.checksum);
    assert.ok(result.size > 0);
    assert.ok(result.timestamp);
    assert.strictEqual(result.type, 'sqlite');
    assert.ok(result.duration >= 0);
  });

  it('should create a checksum file', async () => {
    const result = await manager.createBackup({ type: 'sqlite' });
    const checksumFile = result.file + '.sha256';
    assert.ok(fs.existsSync(checksumFile));
    const stored = fs.readFileSync(checksumFile, 'utf8').trim();
    assert.strictEqual(stored, result.checksum);
  });

  it('should track backup history', async () => {
    assert.strictEqual(manager.backupHistory.length, 0);
    await manager.createBackup({ type: 'sqlite' });
    assert.strictEqual(manager.backupHistory.length, 1);
    assert.ok(manager.lastBackup);
  });

  it('should list available backups', async () => {
    let backups = manager.listBackups();
    assert.strictEqual(backups.length, 0);

    await manager.createBackup({ type: 'sqlite' });
    backups = manager.listBackups();
    assert.strictEqual(backups.length, 1);
    assert.ok(backups[0].name);
    assert.ok(backups[0].size > 0);
    assert.ok(backups[0].created);
    assert.strictEqual(backups[0].type, 'sqlite');
  });

  it('should list backups sorted newest first', async () => {
    await manager.createBackup({ type: 'sqlite' });
    await new Promise(r => setTimeout(r, 10)); // ensure different timestamps
    await manager.createBackup({ type: 'sqlite' });
    await new Promise(r => setTimeout(r, 10));
    await manager.createBackup({ type: 'sqlite' });

    const backups = manager.listBackups();
    assert.strictEqual(backups.length, 3);
    assert.ok(new Date(backups[0].created) >= new Date(backups[1].created));
    assert.ok(new Date(backups[1].created) >= new Date(backups[2].created));
  });

  it('should rotate expired backups', async () => {
    await manager.createBackup({ type: 'sqlite' });
    assert.strictEqual(manager.listBackups().length, 1);

    // Create an old backup file manually
    const oldBackup = path.join(manager.backupDir, 'orca-sqlite-old.db');
    fs.writeFileSync(oldBackup, 'OLD_DATA');
    fs.writeFileSync(oldBackup + '.sha256', 'checksum\n');

    // Modify the old file's mtime to be older than retention
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldBackup, oldDate, oldDate);

    manager.rotateBackups();

    const remaining = manager.listBackups();
    assert.strictEqual(remaining.length, 1); // old one removed
  });

  it('should not rotate if retention is 0 or negative', async () => {
    const noRetentionMgr = new BackupManager({
      backupDir: path.join(tmpDir, 'backups2'),
      retentionDays: -1 // negative = keep forever
    });

    await noRetentionMgr.createBackup({ type: 'sqlite' });
    const oldBackup = path.join(noRetentionMgr.backupDir, 'orca-sqlite-old.db');
    fs.writeFileSync(oldBackup, 'OLD_DATA');
    const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldBackup, oldDate, oldDate);

    noRetentionMgr.rotateBackups();
    const remaining = noRetentionMgr.listBackups();
    assert.strictEqual(remaining.length, 2,
      `Expected 2 backups remaining with retentionDays=-1, got ${remaining.length}`);
  });

  it('should throw when creating backup while one is running', async () => {
    manager._running = true;
    await assert.rejects(
      () => manager.createBackup({ type: 'sqlite' }),
      { message: 'Backup already in progress' }
    );
    manager._running = false;
  });

  it('should get status correctly', () => {
    const status = manager.getStatus();
    assert.strictEqual(status.lastBackup, null);
    assert.strictEqual(status.totalBackups, 0);
    assert.ok(status.backupDir);
    assert.strictEqual(status.retentionDays, 7);
    assert.strictEqual(status.isRunning, false);
    assert.strictEqual(status.schedulerActive, false);
  });

  it('should update status after backup', async () => {
    await manager.createBackup({ type: 'sqlite' });
    const status = manager.getStatus();
    assert.ok(status.lastBackup);
    assert.strictEqual(status.totalBackups, 1);
  });

  it('should start and stop scheduler', () => {
    manager.startScheduler(10000);
    let status = manager.getStatus();
    assert.strictEqual(status.schedulerActive, true);

    manager.stopScheduler();
    status = manager.getStatus();
    assert.strictEqual(status.schedulerActive, false);
  });

  it('should provide singleton instance', () => {
    resetBackupManager();
    const mgr1 = getBackupManager({ backupDir: path.join(tmpDir, 'singleton') });
    const mgr2 = getBackupManager();
    assert.strictEqual(mgr1, mgr2);
    resetBackupManager();
  });

  it('should handle backup with custom retention', async () => {
    const customMgr = new BackupManager({
      backupDir: path.join(tmpDir, 'custom-retention'),
      retentionDays: 365
    });
    assert.strictEqual(customMgr.retentionDays, 365);
    await customMgr.createBackup({ type: 'sqlite' });
    assert.strictEqual(customMgr.listBackups().length, 1);
  });
});

describe('T57: Backup Script Compatibility', () => {
  let tmpDir;
  let manager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-backup-script-'));
    manager = new BackupManager({
      backupDir: path.join(tmpDir, 'backups'),
      retentionDays: 30
    });
  });

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should produce .db files compatible with shell script restore', async () => {
    const result = await manager.createBackup({ type: 'sqlite' });
    assert.ok(result.file.endsWith('.db'));
    assert.ok(result.checksum);

    // Verify the checksum matches the file
    const crypto = require('crypto');
    const buffer = fs.readFileSync(result.file);
    const verifyHash = crypto.createHash('sha256').update(buffer).digest('hex');
    assert.strictEqual(verifyHash, result.checksum);
  });

  it('should produce .sha256 files compatible with shasum verification', async () => {
    const result = await manager.createBackup({ type: 'sqlite' });
    const checksumFile = result.file + '.sha256';
    const content = fs.readFileSync(checksumFile, 'utf8').trim();
    // sha256sum format: <hash>  <filename>
    assert.ok(content.length === 64); // hex SHA-256
  });

  it('should report backup size accurately', async () => {
    const result = await manager.createBackup({ type: 'sqlite' });
    const stats = fs.statSync(result.file);
    assert.strictEqual(result.size, stats.size);
  });
});
