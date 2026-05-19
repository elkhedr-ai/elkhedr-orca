/**
 * Database Backup Manager
 * Programmatic backup scheduling and management.
 * Supports SQLite (VACUUM INTO) and PostgreSQL (pg_dump).
 */

const { execSync, exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { logger } = require('../utils/logger.js');
const { getDatabaseInstance } = require('./index.js');

class BackupManager {
  constructor(options = {}) {
    this.backupDir = options.backupDir || path.join(process.cwd(), 'backups', 'db');
    this.retentionDays = options.retentionDays || 30;
    this.scheduledInterval = null;
    this.scheduleCron = options.schedule || '0 3 * * *'; // Default: daily at 3 AM
    this.lastBackup = null;
    this.backupHistory = [];
    this._running = false;
  }

  /**
   * Ensure backup directory exists
   */
  ensureBackupDir() {
    fs.mkdirSync(this.backupDir, { recursive: true });
  }

  /**
   * Create a database backup
   * @param {Object} options - { type: 'sqlite' | 'postgresql' }
   * @returns {Promise<Object>} { file, size, timestamp, checksum }
   */
  async createBackup(options = {}) {
    if (this._running) {
      throw new Error('Backup already in progress');
    }
    this._running = true;

    try {
      this.ensureBackupDir();
      const db = getDatabaseInstance();
      const dbType = options.type || db.getType() || 'sqlite';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const startTime = Date.now();

      let result;
      switch (dbType) {
        case 'sqlite':
          result = this._backupSqlite(timestamp);
          break;
        case 'postgresql':
          result = await this._backupPostgres(timestamp);
          break;
        default:
          throw new Error(`Unsupported database type: ${dbType}`);
      }

      const duration = Date.now() - startTime;
      const backupRecord = {
        file: result.file,
        size: result.size,
        checksum: result.checksum,
        timestamp: new Date().toISOString(),
        type: dbType,
        duration
      };

      this.backupHistory.push(backupRecord);
      this.lastBackup = backupRecord;

      // Rotate old backups
      this.rotateBackups();

      logger.info({
        file: result.file,
        size: result.size,
        duration,
        type: dbType
      }, 'Database backup created');

      return backupRecord;
    } finally {
      this._running = false;
    }
  }

  /**
   * Backup SQLite using VACUUM INTO (online-safe)
   */
  _backupSqlite(timestamp) {
    const db = getDatabaseInstance();
    const adapter = db.getAdapter();

    if (adapter.getType() !== 'sqlite') {
      throw new Error('Not connected to SQLite database');
    }

    const dbPath = adapter.getClient()?.name;
    if (!dbPath) {
      throw new Error('Cannot determine SQLite database path');
    }

    const backupFile = path.join(this.backupDir, `orca-sqlite-${timestamp}.db`);
    const checksumFile = backupFile + '.sha256';

    // Use VACUUM INTO for safe online backup
    adapter.getClient().exec(`VACUUM INTO '${backupFile}'`);

    // Checksum
    const buffer = fs.readFileSync(backupFile);
    const crypto = require('crypto');
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    fs.writeFileSync(checksumFile, checksum + '\n');

    return {
      file: backupFile,
      size: buffer.length,
      checksum
    };
  }

  /**
   * Backup PostgreSQL using pg_dump
   */
  async _backupPostgres(timestamp) {
    const pgHost = process.env.ORCA_DB_HOST || 'localhost';
    const pgPort = process.env.ORCA_DB_PORT || '5432';
    const pgDb = process.env.ORCA_DB_NAME || 'orca';
    const pgUser = process.env.ORCA_DB_USER || 'orca';
    const backupFile = path.join(this.backupDir, `orca-pgsql-${timestamp}.sql.gz`);

    return new Promise((resolve, reject) => {
      const env = { ...process.env };
      if (process.env.ORCA_DB_PASSWORD) {
        env.PGPASSWORD = process.env.ORCA_DB_PASSWORD;
      }

      const cmd = `pg_dump -h "${pgHost}" -p "${pgPort}" -U "${pgUser}" -d "${pgDb}" --clean --if-exists --no-owner --no-acl --compress=9 --file="${backupFile}"`;

      exec(cmd, { env, timeout: 300000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`pg_dump failed: ${stderr || error.message}`));
          return;
        }

        const stats = fs.statSync(backupFile);
        const crypto = require('crypto');
        const buffer = fs.readFileSync(backupFile);
        const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
        const checksumFile = backupFile + '.sha256';
        fs.writeFileSync(checksumFile, checksum + '\n');

        resolve({
          file: backupFile,
          size: stats.size,
          checksum
        });
      });
    });
  }

  /**
   * Remove backups older than retention period
   */
  rotateBackups() {
    if (!this.retentionDays || this.retentionDays <= 0) return;

    const cutoff = Date.now() - (this.retentionDays * 24 * 60 * 60 * 1000);
    let removedCount = 0;

    if (fs.existsSync(this.backupDir)) {
      const files = fs.readdirSync(this.backupDir);
      for (const file of files) {
        const filePath = path.join(this.backupDir, file);
        const stats = fs.statSync(filePath);
        if (stats.isFile() && stats.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          removedCount++;
        }
      }
    }

    if (removedCount > 0) {
      logger.info({ count: removedCount }, 'Expired backups rotated');
    }
  }

  /**
   * List available backups
   * @returns {Array<Object>} List of backup records sorted by date (newest first)
   */
  listBackups() {
    if (!fs.existsSync(this.backupDir)) return [];

    const backups = [];
    const files = fs.readdirSync(this.backupDir);

    // Group files with their checksums
    const fileMap = new Map();
    for (const file of files) {
      if (file.endsWith('.sha256')) continue;
      if (file.endsWith('.db') || file.endsWith('.sql.gz') || file.endsWith('.dump')) {
        const filePath = path.join(this.backupDir, file);
        const stats = fs.statSync(filePath);
        const checksumFile = filePath + '.sha256';
        let checksum = null;
        if (fs.existsSync(checksumFile)) {
          checksum = fs.readFileSync(checksumFile, 'utf8').trim();
        }

        fileMap.set(file, {
          file: filePath,
          name: file,
          size: stats.size,
          created: stats.mtime,
          checksum
        });
      }
    }

    // Determine type
    for (const [, record] of fileMap) {
      if (record.name.includes('sqlite') || record.name.endsWith('.db')) {
        record.type = 'sqlite';
      } else if (record.name.includes('pgsql') || record.name.includes('postgres')) {
        record.type = 'postgresql';
      }
      backups.push(record);
    }

    return backups.sort((a, b) => b.created - a.created);
  }

  /**
   * Start scheduled backups
   */
  startScheduler(intervalMs = null) {
    if (this.scheduledInterval) {
      clearInterval(this.scheduledInterval);
    }

    // Default: every 24 hours
    const interval = intervalMs || 24 * 60 * 60 * 1000;

    this.scheduledInterval = setInterval(async () => {
      try {
        await this.createBackup();
      } catch (error) {
        logger.error({ error: error.message }, 'Scheduled backup failed');
      }
    }, interval);

    // Prevent Node from keeping process alive just for backups
    if (this.scheduledInterval.unref) {
      this.scheduledInterval.unref();
    }

    logger.info({
      interval: `${Math.round(interval / 1000 / 60 / 60)}h`,
      backupDir: this.backupDir,
      retentionDays: this.retentionDays
    }, 'Backup scheduler started');
  }

  /**
   * Stop scheduled backups
   */
  stopScheduler() {
    if (this.scheduledInterval) {
      clearInterval(this.scheduledInterval);
      this.scheduledInterval = null;
      logger.info('Backup scheduler stopped');
    }
  }

  /**
   * Get backup status
   */
  getStatus() {
    return {
      lastBackup: this.lastBackup,
      totalBackups: this.backupHistory.length,
      backupDir: this.backupDir,
      retentionDays: this.retentionDays,
      isRunning: this._running,
      schedulerActive: this.scheduledInterval !== null
    };
  }
}

// Singleton
let instance = null;

function getBackupManager(options = {}) {
  if (!instance) {
    instance = new BackupManager(options);
  }
  return instance;
}

function resetBackupManager() {
  if (instance) {
    instance.stopScheduler();
    instance = null;
  }
}

module.exports = {
  BackupManager,
  getBackupManager,
  resetBackupManager
};
