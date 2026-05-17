/**
 * Base Database Adapter Interface
 * All database adapters must implement this interface
 */

class DatabaseAdapter {
  /**
   * Connect to the database
   * @param {Object} config - Database configuration
   * @returns {Promise<void>}
   */
  async connect(config) {
    throw new Error('connect() must be implemented by adapter');
  }

  /**
   * Disconnect from the database
   * @returns {Promise<void>}
   */
  async disconnect() {
    throw new Error('disconnect() must be implemented by adapter');
  }

  /**
   * Execute a query and return results
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<Array>} Query results
   */
  async query(sql, params = []) {
    throw new Error('query() must be implemented by adapter');
  }

  /**
   * Execute a statement (INSERT, UPDATE, DELETE)
   * @param {string} sql - SQL statement
   * @param {Array} params - Statement parameters
   * @returns {Promise<Object>} Execution result with lastInsertRowid, changes, etc.
   */
  async execute(sql, params = []) {
    throw new Error('execute() must be implemented by adapter');
  }

  /**
   * Execute multiple statements in a transaction
   * @param {Function} callback - Async function that receives transaction object
   * @returns {Promise<any>} Transaction result
   */
  async transaction(callback) {
    throw new Error('transaction() must be implemented by adapter');
  }

  /**
   * Prepare a statement for repeated execution
   * @param {string} sql - SQL statement
   * @returns {Object} Prepared statement interface
   */
  prepare(sql) {
    throw new Error('prepare() must be implemented by adapter');
  }

  /**
   * Get the underlying database client
   * @returns {Object} Database client
   */
  getClient() {
    throw new Error('getClient() must be implemented by adapter');
  }

  /**
   * Get connection pool statistics (for adapters that support pooling)
   * @returns {Object|null} Pool stats or null if not applicable
   */
  getPoolStats() {
    return null;
  }

  /**
   * Check if the adapter is connected
   * @returns {boolean}
   */
  isConnected() {
    throw new Error('isConnected() must be implemented by adapter');
  }

  /**
   * Get adapter type
   * @returns {string} Adapter type (e.g., 'sqlite', 'postgresql')
   */
  getType() {
    throw new Error('getType() must be implemented by adapter');
  }
}

module.exports = { DatabaseAdapter };

// Made with Bob
