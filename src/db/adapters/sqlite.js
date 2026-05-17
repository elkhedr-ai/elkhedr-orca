/**
 * SQLite Database Adapter
 * Wraps better-sqlite3 to implement the DatabaseAdapter interface
 */

const Database = require('better-sqlite3');
const { DatabaseAdapter } = require('./base.js');
const path = require('path');

class SQLiteAdapter extends DatabaseAdapter {
  constructor() {
    super();
    this.db = null;
    this.connected = false;
  }

  /**
   * Connect to SQLite database
   * @param {Object} config - Configuration object
   * @param {string} config.filename - Database file path
   * @param {boolean} config.readonly - Open in readonly mode
   * @param {boolean} config.fileMustExist - Throw error if file doesn't exist
   */
  async connect(config) {
    if (this.connected) {
      return;
    }

    const dbPath = config.filename || path.join(process.cwd(), 'data', 'orca.db');
    
    this.db = new Database(dbPath, {
      readonly: config.readonly || false,
      fileMustExist: config.fileMustExist || false
    });

    // Enable foreign key constraints
    this.db.pragma('foreign_keys = ON');
    
    // Performance optimizations
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    
    this.connected = true;
  }

  /**
   * Disconnect from database
   */
  async disconnect() {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.connected = false;
    }
  }

  /**
   * Execute a query and return results
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<Array>} Query results
   */
  async query(sql, params = []) {
    if (!this.connected) {
      throw new Error('Database not connected');
    }
    
    const stmt = this.db.prepare(sql);
    return stmt.all(...params);
  }

  /**
   * Execute a statement (INSERT, UPDATE, DELETE)
   * @param {string} sql - SQL statement
   * @param {Array} params - Statement parameters
   * @returns {Promise<Object>} Execution result
   */
  async execute(sql, params = []) {
    if (!this.connected) {
      throw new Error('Database not connected');
    }
    
    const stmt = this.db.prepare(sql);
    const result = stmt.run(...params);
    
    return {
      lastInsertRowid: result.lastInsertRowid,
      changes: result.changes
    };
  }

  /**
   * Execute multiple statements in a transaction
   * @param {Function} callback - Function that receives transaction object
   * @returns {Promise<any>} Transaction result
   */
  async transaction(callback) {
    if (!this.connected) {
      throw new Error('Database not connected');
    }
    
    const transaction = this.db.transaction(callback);
    return transaction();
  }

  /**
   * Prepare a statement for repeated execution
   * @param {string} sql - SQL statement
   * @returns {Object} Prepared statement with get(), all(), run() methods
   */
  prepare(sql) {
    if (!this.connected) {
      throw new Error('Database not connected');
    }
    
    const stmt = this.db.prepare(sql);
    
    // Wrap to provide consistent async interface
    return {
      get: async (...params) => stmt.get(...params),
      all: async (...params) => stmt.all(...params),
      run: async (...params) => {
        const result = stmt.run(...params);
        return {
          lastInsertRowid: result.lastInsertRowid,
          changes: result.changes
        };
      },
      // Expose sync methods for backward compatibility
      getSync: (...params) => stmt.get(...params),
      allSync: (...params) => stmt.all(...params),
      runSync: (...params) => stmt.run(...params)
    };
  }

  /**
   * Get the underlying better-sqlite3 database instance
   * @returns {Object} Database instance
   */
  getClient() {
    return this.db;
  }

  /**
   * SQLite doesn't use connection pooling
   * @returns {null}
   */
  getPoolStats() {
    return null;
  }

  /**
   * Check if connected
   * @returns {boolean}
   */
  isConnected() {
    return this.connected && this.db !== null;
  }

  /**
   * Get adapter type
   * @returns {string}
   */
  getType() {
    return 'sqlite';
  }

  /**
   * Execute raw SQL (for migrations)
   * @param {string} sql - Raw SQL
   * @returns {Promise<void>}
   */
  async raw(sql) {
    if (!this.connected) {
      throw new Error('Database not connected');
    }
    
    this.db.exec(sql);
  }
}

module.exports = { SQLiteAdapter };

// Made with Bob
