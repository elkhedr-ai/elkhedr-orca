/**
 * Database Initialization
 * Handles database setup, migrations, and schema creation
 */

const fs = require('fs');
const path = require('path');
const { createFromEnv, parseConfig } = require('./adapters/factory.js');
const { logger } = require('../utils/logger.js');

/**
 * Initialize SQLite database with schema
 * @param {DatabaseAdapter} adapter - SQLite adapter
 */
async function initSQLite(adapter) {
  const schemaPath = path.join(__dirname, 'schema.sql');
  
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Schema file not found: ${schemaPath}`);
  }

  const schema = fs.readFileSync(schemaPath, 'utf8');
  
  // Check if tables already exist
  const tables = await adapter.query(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
  `);

  if (tables.length > 0) {
    logger.info('SQLite database already initialized');
    return;
  }

  logger.info('Initializing SQLite database with schema...');
  await adapter.raw(schema);
  logger.info('SQLite database initialized successfully');
}

/**
 * Initialize PostgreSQL database with migrations
 * @param {DatabaseAdapter} adapter - PostgreSQL adapter
 */
async function initPostgreSQL(adapter) {
  const knex = adapter.getClient();

  // Check if migrations table exists
  const hasTable = await knex.schema.hasTable('knex_migrations');

  if (!hasTable) {
    logger.info('Running PostgreSQL migrations...');
  }

  // Configure migrations
  const migrationConfig = {
    directory: path.join(__dirname, 'migrations'),
    tableName: 'knex_migrations',
    schemaName: 'public'
  };

  try {
    // Run all pending migrations
    const [batchNo, migrations] = await knex.migrate.latest(migrationConfig);

    if (migrations.length === 0) {
      logger.info('PostgreSQL database is up to date');
    } else {
      logger.info(`Ran ${migrations.length} migrations (batch ${batchNo})`);
      migrations.forEach(migration => {
        logger.info(`  - ${migration}`);
      });
    }
  } catch (error) {
    logger.error(`Migration failed: ${error.message}`);
    throw error;
  }
}

/**
 * Initialize database based on adapter type
 * @param {DatabaseAdapter} adapter - Database adapter
 */
async function initDatabase(adapter) {
  const type = adapter.getType();

  logger.info(`Initializing ${type} database...`);

  try {
    if (type === 'sqlite') {
      await initSQLite(adapter);
    } else if (type === 'postgresql') {
      await initPostgreSQL(adapter);
    } else {
      throw new Error(`Unsupported database type: ${type}`);
    }

    logger.info('Database initialization complete');
  } catch (error) {
    logger.error(`Database initialization failed: ${error.message}`);
    throw error;
  }
}

/**
 * Initialize database from environment configuration
 */
async function initFromEnv() {
  const config = parseConfig();
  logger.info(`Initializing database (type: ${config.type})`);

  const adapter = await createFromEnv();

  try {
    await initDatabase(adapter);
    return adapter;
  } catch (error) {
    await adapter.disconnect();
    throw error;
  }
}

/**
 * Run migrations (for CLI usage)
 * @param {string} command - Migration command (latest, up, down, rollback)
 */
async function runMigrations(command = 'latest') {
  const config = parseConfig();

  if (config.type !== 'postgresql') {
    logger.warn('Migrations are only supported for PostgreSQL');
    logger.info('SQLite uses schema.sql for initialization');
    return;
  }

  const adapter = await createFromEnv();
  const knex = adapter.getClient();

  const migrationConfig = {
    directory: path.join(__dirname, 'migrations'),
    tableName: 'knex_migrations',
    schemaName: 'public'
  };

  try {
    let result;

    switch (command) {
      case 'latest':
      case 'up':
        result = await knex.migrate.latest(migrationConfig);
        logger.info(`Migrations complete: ${result[1].length} migrations run`);
        break;

      case 'down':
        result = await knex.migrate.down(migrationConfig);
        logger.info(`Rolled back: ${result[1].length} migrations`);
        break;

      case 'rollback':
        result = await knex.migrate.rollback(migrationConfig);
        logger.info(`Rolled back batch: ${result[1].length} migrations`);
        break;

      case 'status':
        result = await knex.migrate.list(migrationConfig);
        logger.info('Migration status:');
        logger.info(`  Completed: ${result[0].length}`);
        logger.info(`  Pending: ${result[1].length}`);
        break;

      default:
        throw new Error(`Unknown migration command: ${command}`);
    }
  } catch (error) {
    logger.error(`Migration command failed: ${error.message}`);
    throw error;
  } finally {
    await adapter.disconnect();
  }
}

/**
 * Create a new migration file
 * @param {string} name - Migration name
 */
async function createMigration(name) {
  const config = parseConfig();

  if (config.type !== 'postgresql') {
    logger.warn('Migrations are only supported for PostgreSQL');
    return;
  }

  const adapter = await createFromEnv();
  const knex = adapter.getClient();

  const migrationConfig = {
    directory: path.join(__dirname, 'migrations'),
    tableName: 'knex_migrations'
  };

  try {
    const filename = await knex.migrate.make(name, migrationConfig);
    logger.info(`Created migration: ${filename}`);
  } catch (error) {
    logger.error(`Failed to create migration: ${error.message}`);
    throw error;
  } finally {
    await adapter.disconnect();
  }
}

module.exports = {
  initDatabase,
  initFromEnv,
  initSQLite,
  initPostgreSQL,
  runMigrations,
  createMigration
};

// Made with Bob
