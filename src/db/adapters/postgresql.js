/**
 * PostgreSQL Database Adapter
 * Uses Knex.js for query building and connection pooling
 */

const knex = require('knex');
const { DatabaseAdapter } = require('./base.js');

class PostgreSQLAdapter extends DatabaseAdapter {
  constructor() {
    super();
    this.knex = null;
    this.connected = false;
  }

  /**
   * Connect to PostgreSQL database
   * @param {Object} config - Configuration object
   * @param {string} config.connectionString - PostgreSQL connection string
   * @param {string} config.host - Database host
   * @param {number} config.port - Database port
   * @param {string} config.database - Database name
   * @param {string} config.user - Database user
   * @param {string} config.password - Database password
   * @param {Object} config.pool - Connection pool settings
   */
  async connect(config) {
    if (this.connected) {
      return;
    }

    // Build connection configuration
    const connectionConfig = config.connectionString 
      ? config.connectionString
      : {
          host: config.host || 'localhost',
          port: config.port || 5432,
          database: config.database || 'orca',
          user: config.user,
          password: config.password,
          ssl: config.ssl || false
        };

    // Initialize Knex with PostgreSQL
    this.knex = knex({
      client: 'pg',
      connection: connectionConfig,
      pool: {
        min: config.pool?.min || 2,
        max: config.pool?.max || 10,
        idleTimeoutMillis: config.pool?.idleTimeoutMillis || 30000,
        acquireTimeoutMillis: config.pool?.acquireTimeoutMillis || 60000,
        createTimeoutMillis: config.pool?.createTimeoutMillis || 30000,
        destroyTimeoutMillis: config.pool?.destroyTimeoutMillis || 5000,
        reapIntervalMillis: config.pool?.reapIntervalMillis || 1000,
        createRetryIntervalMillis: config.pool?.createRetryIntervalMillis || 200,
      },
      acquireConnectionTimeout: config.acquireConnectionTimeout || 60000,
      // Log queries in debug mode
      debug: config.debug || false
    });

    // Test connection
    try {
      await this.knex.raw('SELECT 1');
      this.connected = true;
    } catch (error) {
      await this.knex.destroy();
      this.knex = null;
      throw new Error(`Failed to connect to PostgreSQL: ${error.message}`);
    }
  }

  /**
   * Disconnect from database
   */
  async disconnect() {
    if (this.knex) {
      await this.knex.destroy();
      this.knex = null;
      this.connected = false;
    }
  }

  /**
   * Execute a query and return results
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters (use ? placeholders)
   * @returns {Promise<Array>} Query results
   */
  async query(sql, params = []) {
    if (!this.connected) {
      throw new Error('Database not connected');
    }

    // Convert ? placeholders to $1, $2, etc. for PostgreSQL
    const pgSql = this._convertPlaceholders(sql);
    const result = await this.knex.raw(pgSql, params);
    return result.rows;
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

    // Convert ? placeholders to $1, $2, etc. for PostgreSQL
    const pgSql = this._convertPlaceholders(sql);
    
    // For INSERT statements, try to get the inserted ID
    if (sql.trim().toUpperCase().startsWith('INSERT')) {
      // Add RETURNING id if not present
      const hasReturning = sql.toUpperCase().includes('RETURNING');
      let result;

      if (hasReturning) {
        result = await this.knex.raw(pgSql, params);
      } else {
        const sqlWithReturning = pgSql.replace(/;?\s*$/, ' RETURNING id');
        try {
          result = await this.knex.raw(sqlWithReturning, params);
        } catch (error) {
          // Some aggregate tables do not have an id column.
          if (!/column "?id"? does not exist/i.test(error.message)) {
            throw error;
          }
          result = await this.knex.raw(pgSql, params);
        }
      }
      
      return {
        lastInsertRowid: result.rows[0]?.id || null,
        changes: result.rowCount || 0
      };
    }

    // For UPDATE/DELETE statements
    const result = await this.knex.raw(pgSql, params);
    return {
      lastInsertRowid: null,
      changes: result.rowCount || 0
    };
  }

  /**
   * Execute multiple statements in a transaction
   * @param {Function} callback - Async function that receives transaction object
   * @returns {Promise<any>} Transaction result
   */
  async transaction(callback) {
    if (!this.connected) {
      throw new Error('Database not connected');
    }

    return await this.knex.transaction(async (trx) => {
      return await callback(trx);
    });
  }

  /**
   * Prepare a statement for repeated execution
   * @param {string} sql - SQL statement
   * @returns {Object} Prepared statement interface
   */
  prepare(sql) {
    if (!this.connected) {
      throw new Error('Database not connected');
    }

    const pgSql = this._convertPlaceholders(sql);

    return {
      get: async (...params) => {
        const result = await this.knex.raw(pgSql, params);
        return result.rows[0] || null;
      },
      all: async (...params) => {
        const result = await this.knex.raw(pgSql, params);
        return result.rows;
      },
      run: async (...params) => {
        return await this.execute(sql, params);
      }
    };
  }

  /**
   * Get the underlying Knex instance
   * @returns {Object} Knex instance
   */
  getClient() {
    return this.knex;
  }

  /**
   * Get connection pool statistics
   * @returns {Object} Pool stats
   */
  getPoolStats() {
    if (!this.knex) {
      return null;
    }

    const pool = this.knex.client.pool;
    return {
      used: pool.numUsed(),
      free: pool.numFree(),
      pending: pool.numPendingAcquires(),
      pendingCreates: pool.numPendingCreates(),
      min: pool.min,
      max: pool.max
    };
  }

  /**
   * Check if connected
   * @returns {boolean}
   */
  isConnected() {
    return this.connected && this.knex !== null;
  }

  /**
   * Get adapter type
   * @returns {string}
   */
  getType() {
    return 'postgresql';
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

    await this.knex.raw(sql);
  }

  /**
   * Run a SQL statement and return the execution result.
   * Provided for compatibility with the SQLite adapter.
   */
  async run(sql, params = []) {
    return await this.execute(sql, params);
  }

  /**
   * Run a SQL query and return all rows.
   * Provided for compatibility with the SQLite adapter.
   */
  async all(sql, params = []) {
    return await this.query(sql, params);
  }

  /**
   * Convert ? placeholders to PostgreSQL $1, $2, etc.
   * @private
   * @param {string} sql - SQL with ? placeholders
   * @returns {string} SQL with $n placeholders
   */
  _convertPlaceholders(sql) {
    let index = 1;
    return sql.replace(/\?/g, () => `$${index++}`);
  }

  /**
   * Get Knex query builder
   * @param {string} tableName - Table name
   * @returns {Object} Knex query builder
   */
  table(tableName) {
    if (!this.connected) {
      throw new Error('Database not connected');
    }
    return this.knex(tableName);
  }

  /**
   * Get Knex schema builder
   * @returns {Object} Knex schema builder
   */
  schema() {
    if (!this.connected) {
      throw new Error('Database not connected');
    }
    return this.knex.schema;
  }
}

module.exports = { PostgreSQLAdapter };

// Made with Bob
