/**
 * Database Adapter Factory
 * Creates the appropriate database adapter based on configuration
 */

const { SQLiteAdapter } = require('./sqlite.js');
const { PostgreSQLAdapter } = require('./postgresql.js');
const { logger } = require('../../utils/logger.js');

/**
 * Create a database adapter based on type
 * @param {string} type - Adapter type ('sqlite' or 'postgresql')
 * @param {Object} config - Database configuration
 * @returns {DatabaseAdapter} Database adapter instance
 */
function createAdapter(type, config = {}) {
  const adapterType = (type || 'sqlite').toLowerCase();

  logger.info(`Creating ${adapterType} database adapter`);

  switch (adapterType) {
    case 'sqlite':
      return new SQLiteAdapter();
    
    case 'postgresql':
    case 'postgres':
    case 'pg':
      return new PostgreSQLAdapter();
    
    default:
      throw new Error(
        `Unknown database adapter type: ${type}. Supported types: sqlite, postgresql`
      );
  }
}

/**
 * Create and connect a database adapter
 * @param {string} type - Adapter type
 * @param {Object} config - Database configuration
 * @returns {Promise<DatabaseAdapter>} Connected adapter instance
 */
async function createAndConnect(type, config = {}) {
  const adapter = createAdapter(type, config);
  
  try {
    await adapter.connect(config);
    logger.info(`Connected to ${adapter.getType()} database`);
    return adapter;
  } catch (error) {
    logger.error(`Failed to connect to ${type} database: ${error.message}`);
    throw error;
  }
}

/**
 * Parse database configuration from environment variables
 * @param {Object} env - Environment variables (defaults to process.env)
 * @returns {Object} Parsed database configuration
 */
function parseConfig(env = process.env) {
  const type = (env.ORCA_DB_TYPE || 'sqlite').toLowerCase();

  if (type === 'sqlite') {
    return {
      type: 'sqlite',
      filename: env.ORCA_DB_PATH || env.ORCA_DB_URL?.replace('file:', '') || null,
      readonly: env.ORCA_DB_READONLY === 'true',
      fileMustExist: env.ORCA_DB_FILE_MUST_EXIST === 'true'
    };
  }

  if (type === 'postgresql' || type === 'postgres' || type === 'pg') {
    // Support connection string or individual components
    if (env.ORCA_DB_URL && env.ORCA_DB_URL.startsWith('postgresql://')) {
      return {
        type: 'postgresql',
        connectionString: env.ORCA_DB_URL,
        ssl: env.ORCA_DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
        pool: {
          min: parseInt(env.ORCA_DB_POOL_MIN || '2', 10),
          max: parseInt(env.ORCA_DB_POOL_MAX || '10', 10),
          idleTimeoutMillis: parseInt(env.ORCA_DB_POOL_IDLE_TIMEOUT || '30000', 10),
          acquireTimeoutMillis: parseInt(env.ORCA_DB_POOL_ACQUIRE_TIMEOUT || '60000', 10)
        },
        debug: env.ORCA_DB_DEBUG === 'true'
      };
    }

    // Individual connection components
    return {
      type: 'postgresql',
      host: env.ORCA_DB_HOST || 'localhost',
      port: parseInt(env.ORCA_DB_PORT || '5432', 10),
      database: env.ORCA_DB_NAME || 'orca',
      user: env.ORCA_DB_USER,
      password: env.ORCA_DB_PASSWORD,
      ssl: env.ORCA_DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      pool: {
        min: parseInt(env.ORCA_DB_POOL_MIN || '2', 10),
        max: parseInt(env.ORCA_DB_POOL_MAX || '10', 10),
        idleTimeoutMillis: parseInt(env.ORCA_DB_POOL_IDLE_TIMEOUT || '30000', 10),
        acquireTimeoutMillis: parseInt(env.ORCA_DB_POOL_ACQUIRE_TIMEOUT || '60000', 10)
      },
      debug: env.ORCA_DB_DEBUG === 'true'
    };
  }

  throw new Error(`Unsupported database type: ${type}`);
}

/**
 * Validate database configuration
 * @param {Object} config - Database configuration
 * @throws {Error} If configuration is invalid
 */
function validateConfig(config) {
  if (!config.type) {
    throw new Error('Database type is required');
  }

  if (config.type === 'postgresql') {
    if (!config.connectionString) {
      // Validate individual components
      if (!config.user) {
        throw new Error('PostgreSQL user is required (ORCA_DB_USER)');
      }
      if (!config.password) {
        throw new Error('PostgreSQL password is required (ORCA_DB_PASSWORD)');
      }
      if (!config.database) {
        throw new Error('PostgreSQL database name is required (ORCA_DB_NAME)');
      }
    }
  }
}

/**
 * Create adapter from environment variables
 * @returns {Promise<DatabaseAdapter>} Connected adapter instance
 */
async function createFromEnv() {
  const config = parseConfig();
  validateConfig(config);
  return await createAndConnect(config.type, config);
}

module.exports = {
  createAdapter,
  createAndConnect,
  parseConfig,
  validateConfig,
  createFromEnv
};

// Made with Bob
