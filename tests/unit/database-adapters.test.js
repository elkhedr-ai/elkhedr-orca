/**
 * Unit tests for database adapters
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { SQLiteAdapter } = require('../../src/db/adapters/sqlite.js');
const { PostgreSQLAdapter } = require('../../src/db/adapters/postgresql.js');
const { createAdapter, parseConfig, validateConfig } = require('../../src/db/adapters/factory.js');
const fs = require('fs');
const path = require('path');

describe('Database Adapters', () => {
  describe('SQLite Adapter', () => {
    let adapter;
    const testDbPath = path.join(__dirname, '../fixtures/test.db');

    before(async () => {
      // Clean up any existing test database
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });

    after(async () => {
      if (adapter) {
        await adapter.disconnect();
      }
      // Clean up test database
      if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
      }
    });

    it('should create SQLite adapter', () => {
      adapter = new SQLiteAdapter();
      assert.strictEqual(adapter.getType(), 'sqlite');
    });

    it('should connect to SQLite database', async () => {
      await adapter.connect({ filename: testDbPath });
      assert.strictEqual(adapter.isConnected(), true);
    });

    it('should execute CREATE TABLE', async () => {
      await adapter.raw(`
        CREATE TABLE test_users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL
        )
      `);
      
      const tables = await adapter.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='test_users'"
      );
      assert.strictEqual(tables.length, 1);
      assert.strictEqual(tables[0].name, 'test_users');
    });

    it('should insert data', async () => {
      const result = await adapter.execute(
        'INSERT INTO test_users (name, email) VALUES (?, ?)',
        ['John Doe', 'john@example.com']
      );
      assert.ok(result.lastInsertRowid);
      assert.strictEqual(result.changes, 1);
    });

    it('should query data', async () => {
      const users = await adapter.query('SELECT * FROM test_users');
      assert.strictEqual(users.length, 1);
      assert.strictEqual(users[0].name, 'John Doe');
      assert.strictEqual(users[0].email, 'john@example.com');
    });

    it('should use prepared statements', async () => {
      const stmt = adapter.prepare('SELECT * FROM test_users WHERE email = ?');
      const user = await stmt.get('john@example.com');
      assert.strictEqual(user.name, 'John Doe');
    });

    it('should execute transactions', async () => {
      await adapter.transaction(async () => {
        await adapter.execute(
          'INSERT INTO test_users (name, email) VALUES (?, ?)',
          ['Jane Doe', 'jane@example.com']
        );
        await adapter.execute(
          'INSERT INTO test_users (name, email) VALUES (?, ?)',
          ['Bob Smith', 'bob@example.com']
        );
      });

      const users = await adapter.query('SELECT * FROM test_users');
      assert.strictEqual(users.length, 3);
    });

    it('should update data', async () => {
      const result = await adapter.execute(
        'UPDATE test_users SET name = ? WHERE email = ?',
        ['John Updated', 'john@example.com']
      );
      assert.strictEqual(result.changes, 1);

      const user = await adapter.query(
        'SELECT * FROM test_users WHERE email = ?',
        ['john@example.com']
      );
      assert.strictEqual(user[0].name, 'John Updated');
    });

    it('should delete data', async () => {
      const result = await adapter.execute(
        'DELETE FROM test_users WHERE email = ?',
        ['bob@example.com']
      );
      assert.strictEqual(result.changes, 1);

      const users = await adapter.query('SELECT * FROM test_users');
      assert.strictEqual(users.length, 2);
    });

    it('should return null for pool stats', () => {
      const stats = adapter.getPoolStats();
      assert.strictEqual(stats, null);
    });

    it('should disconnect', async () => {
      await adapter.disconnect();
      assert.strictEqual(adapter.isConnected(), false);
    });
  });

  describe('PostgreSQL Adapter', () => {
    it('should create PostgreSQL adapter', () => {
      const adapter = new PostgreSQLAdapter();
      assert.strictEqual(adapter.getType(), 'postgresql');
    });

    it('should convert placeholders', () => {
      const adapter = new PostgreSQLAdapter();
      const sql = 'SELECT * FROM users WHERE id = ? AND email = ?';
      const converted = adapter._convertPlaceholders(sql);
      assert.strictEqual(converted, 'SELECT * FROM users WHERE id = $1 AND email = $2');
    });

    it('should handle multiple placeholders', () => {
      const adapter = new PostgreSQLAdapter();
      const sql = 'INSERT INTO users (name, email, age) VALUES (?, ?, ?)';
      const converted = adapter._convertPlaceholders(sql);
      assert.strictEqual(converted, 'INSERT INTO users (name, email, age) VALUES ($1, $2, $3)');
    });
  });

  describe('Adapter Factory', () => {
    it('should create SQLite adapter by default', () => {
      const adapter = createAdapter('sqlite');
      assert.strictEqual(adapter.getType(), 'sqlite');
    });

    it('should create PostgreSQL adapter', () => {
      const adapter = createAdapter('postgresql');
      assert.strictEqual(adapter.getType(), 'postgresql');
    });

    it('should accept postgres alias', () => {
      const adapter = createAdapter('postgres');
      assert.strictEqual(adapter.getType(), 'postgresql');
    });

    it('should accept pg alias', () => {
      const adapter = createAdapter('pg');
      assert.strictEqual(adapter.getType(), 'postgresql');
    });

    it('should throw error for unknown type', () => {
      assert.throws(() => {
        createAdapter('mysql');
      }, /Unknown database adapter type/);
    });
  });

  describe('Configuration Parser', () => {
    it('should parse SQLite config', () => {
      const env = {
        ORCA_DB_TYPE: 'sqlite',
        ORCA_DB_PATH: './data/test.db'
      };
      const config = parseConfig(env);
      assert.strictEqual(config.type, 'sqlite');
      assert.strictEqual(config.filename, './data/test.db');
    });

    it('should parse PostgreSQL connection string', () => {
      const env = {
        ORCA_DB_TYPE: 'postgresql',
        ORCA_DB_URL: 'postgresql://user:pass@localhost:5432/testdb'
      };
      const config = parseConfig(env);
      assert.strictEqual(config.type, 'postgresql');
      assert.strictEqual(config.connectionString, 'postgresql://user:pass@localhost:5432/testdb');
    });

    it('should parse PostgreSQL individual components', () => {
      const env = {
        ORCA_DB_TYPE: 'postgresql',
        ORCA_DB_HOST: 'localhost',
        ORCA_DB_PORT: '5432',
        ORCA_DB_NAME: 'testdb',
        ORCA_DB_USER: 'testuser',
        ORCA_DB_PASSWORD: 'testpass'
      };
      const config = parseConfig(env);
      assert.strictEqual(config.type, 'postgresql');
      assert.strictEqual(config.host, 'localhost');
      assert.strictEqual(config.port, 5432);
      assert.strictEqual(config.database, 'testdb');
      assert.strictEqual(config.user, 'testuser');
      assert.strictEqual(config.password, 'testpass');
    });

    it('should parse pool settings', () => {
      const env = {
        ORCA_DB_TYPE: 'postgresql',
        ORCA_DB_URL: 'postgresql://user:pass@localhost:5432/testdb',
        ORCA_DB_POOL_MIN: '5',
        ORCA_DB_POOL_MAX: '20'
      };
      const config = parseConfig(env);
      assert.strictEqual(config.pool.min, 5);
      assert.strictEqual(config.pool.max, 20);
    });

    it('should default to SQLite', () => {
      const env = {};
      const config = parseConfig(env);
      assert.strictEqual(config.type, 'sqlite');
    });
  });

  describe('Configuration Validator', () => {
    it('should validate SQLite config', () => {
      const config = { type: 'sqlite', filename: './data/test.db' };
      assert.doesNotThrow(() => {
        validateConfig(config);
      });
    });

    it('should validate PostgreSQL with connection string', () => {
      const config = {
        type: 'postgresql',
        connectionString: 'postgresql://user:pass@localhost:5432/testdb'
      };
      assert.doesNotThrow(() => {
        validateConfig(config);
      });
    });

    it('should validate PostgreSQL with components', () => {
      const config = {
        type: 'postgresql',
        host: 'localhost',
        port: 5432,
        database: 'testdb',
        user: 'testuser',
        password: 'testpass'
      };
      assert.doesNotThrow(() => {
        validateConfig(config);
      });
    });

    it('should throw error for missing type', () => {
      const config = {};
      assert.throws(() => {
        validateConfig(config);
      }, /Database type is required/);
    });

    it('should throw error for PostgreSQL without credentials', () => {
      const config = {
        type: 'postgresql',
        host: 'localhost',
        database: 'testdb'
      };
      assert.throws(() => {
        validateConfig(config);
      }, /PostgreSQL user is required/);
    });

    it('should throw error for PostgreSQL without password', () => {
      const config = {
        type: 'postgresql',
        host: 'localhost',
        database: 'testdb',
        user: 'testuser'
      };
      assert.throws(() => {
        validateConfig(config);
      }, /PostgreSQL password is required/);
    });

    it('should throw error for PostgreSQL without database', () => {
      const config = {
        type: 'postgresql',
        host: 'localhost',
        user: 'testuser',
        password: 'testpass'
      };
      assert.throws(() => {
        validateConfig(config);
      }, /PostgreSQL database name is required/);
    });
  });
});

// Made with Bob
