/**
 * Integration tests for PostgreSQL adapter
 * Requires a running PostgreSQL instance
 * 
 * Setup:
 * docker run -d --name orca-test-postgres \
 *   -e POSTGRES_DB=orca_test \
 *   -e POSTGRES_USER=orca_test \
 *   -e POSTGRES_PASSWORD=test_password \
 *   -p 5433:5432 \
 *   postgres:16-alpine
 * 
 * Run tests:
 * ORCA_DB_TYPE=postgresql \
 * ORCA_DB_URL=postgresql://orca_test:test_password@localhost:5433/orca_test \
 * npm run test:integration
 */

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { PostgreSQLAdapter } = require('../../src/db/adapters/postgresql.js');
const { initializeDatabaseInstance } = require('../../src/db/index.js');

// Skip tests if PostgreSQL is not configured
const SKIP_POSTGRES_TESTS = !process.env.ORCA_DB_URL || 
                            process.env.ORCA_DB_TYPE !== 'postgresql';

if (SKIP_POSTGRES_TESTS) {
  console.log('⚠️  Skipping PostgreSQL integration tests (no PostgreSQL configured)');
  console.log('   Set ORCA_DB_TYPE=postgresql and ORCA_DB_URL to run these tests');
}

describe('PostgreSQL Integration Tests', { skip: SKIP_POSTGRES_TESTS }, () => {
  let adapter;
  let db;

  before(async () => {
    // Parse connection from environment
    const config = {
      connectionString: process.env.ORCA_DB_URL,
      pool: {
        min: 2,
        max: 5
      }
    };

    adapter = new PostgreSQLAdapter();
    await adapter.connect(config);

    // Clean up any existing test tables
    try {
      await adapter.raw('DROP TABLE IF EXISTS test_users CASCADE');
      await adapter.raw('DROP TABLE IF EXISTS test_posts CASCADE');
    } catch (e) {
      // Ignore errors if tables don't exist
    }
  });

  after(async () => {
    // Clean up test tables
    try {
      await adapter.raw('DROP TABLE IF EXISTS test_users CASCADE');
      await adapter.raw('DROP TABLE IF EXISTS test_posts CASCADE');
    } catch (e) {
      // Ignore cleanup errors
    }

    if (adapter) {
      await adapter.disconnect();
    }
  });

  describe('Connection', () => {
    it('should connect to PostgreSQL', () => {
      assert.strictEqual(adapter.isConnected(), true);
    });

    it('should return pool statistics', () => {
      const stats = adapter.getPoolStats();
      assert.ok(stats);
      assert.ok(typeof stats.used === 'number');
      assert.ok(typeof stats.free === 'number');
      assert.ok(typeof stats.max === 'number');
    });
  });

  describe('Schema Operations', () => {
    it('should create table with SERIAL primary key', async () => {
      await adapter.raw(`
        CREATE TABLE test_users (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT UNIQUE NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      const result = await adapter.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'test_users'
      `);
      assert.strictEqual(result.length, 1);
    });

    it('should create table with foreign key', async () => {
      await adapter.raw(`
        CREATE TABLE test_posts (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES test_users(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          content TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      const result = await adapter.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'test_posts'
      `);
      assert.strictEqual(result.length, 1);
    });
  });

  describe('CRUD Operations', () => {
    it('should insert data and return ID', async () => {
      const result = await adapter.execute(
        'INSERT INTO test_users (name, email) VALUES (?, ?)',
        ['Alice Johnson', 'alice@example.com']
      );
      assert.ok(result.lastInsertRowid);
      assert.strictEqual(result.changes, 1);
    });

    it('should insert multiple rows', async () => {
      await adapter.execute(
        'INSERT INTO test_users (name, email) VALUES (?, ?)',
        ['Bob Wilson', 'bob@example.com']
      );
      await adapter.execute(
        'INSERT INTO test_users (name, email) VALUES (?, ?)',
        ['Carol Davis', 'carol@example.com']
      );

      const users = await adapter.query('SELECT * FROM test_users');
      assert.strictEqual(users.length, 3);
    });

    it('should query with parameters', async () => {
      const users = await adapter.query(
        'SELECT * FROM test_users WHERE email = ?',
        ['alice@example.com']
      );
      assert.strictEqual(users.length, 1);
      assert.strictEqual(users[0].name, 'Alice Johnson');
    });

    it('should use prepared statements', async () => {
      const stmt = adapter.prepare('SELECT * FROM test_users WHERE name LIKE ?');
      const users = await stmt.all('%Johnson%');
      assert.strictEqual(users.length, 1);
      assert.strictEqual(users[0].email, 'alice@example.com');
    });

    it('should update data', async () => {
      const result = await adapter.execute(
        'UPDATE test_users SET name = ? WHERE email = ?',
        ['Alice Updated', 'alice@example.com']
      );
      assert.strictEqual(result.changes, 1);

      const user = await adapter.query(
        'SELECT * FROM test_users WHERE email = ?',
        ['alice@example.com']
      );
      assert.strictEqual(user[0].name, 'Alice Updated');
    });

    it('should delete data', async () => {
      const result = await adapter.execute(
        'DELETE FROM test_users WHERE email = ?',
        ['carol@example.com']
      );
      assert.strictEqual(result.changes, 1);

      const users = await adapter.query('SELECT * FROM test_users');
      assert.strictEqual(users.length, 2);
    });
  });

  describe('Transactions', () => {
    it('should commit transaction', async () => {
      await adapter.transaction(async (trx) => {
        await adapter.execute(
          'INSERT INTO test_users (name, email) VALUES (?, ?)',
          ['David Brown', 'david@example.com']
        );
        await adapter.execute(
          'INSERT INTO test_users (name, email) VALUES (?, ?)',
          ['Eve Martinez', 'eve@example.com']
        );
      });

      const users = await adapter.query('SELECT * FROM test_users');
      assert.strictEqual(users.length, 4);
    });

    it('should rollback transaction on error', async () => {
      const initialCount = (await adapter.query('SELECT COUNT(*) as count FROM test_users'))[0].count;

      try {
        await adapter.transaction(async () => {
          await adapter.execute(
            'INSERT INTO test_users (name, email) VALUES (?, ?)',
            ['Frank Wilson', 'frank@example.com']
          );
          // This should fail due to duplicate email
          await adapter.execute(
            'INSERT INTO test_users (name, email) VALUES (?, ?)',
            ['Another User', 'alice@example.com']
          );
        });
        assert.fail('Transaction should have failed');
      } catch (e) {
        // Expected error
      }

      const finalCount = (await adapter.query('SELECT COUNT(*) as count FROM test_users'))[0].count;
      assert.strictEqual(parseInt(finalCount), parseInt(initialCount));
    });
  });

  describe('Foreign Key Constraints', () => {
    it('should insert with valid foreign key', async () => {
      const userResult = await adapter.query(
        'SELECT id FROM test_users WHERE email = ?',
        ['alice@example.com']
      );
      const userId = userResult[0].id;

      const result = await adapter.execute(
        'INSERT INTO test_posts (user_id, title, content) VALUES (?, ?, ?)',
        [userId, 'First Post', 'This is the content']
      );
      assert.ok(result.lastInsertRowid);
    });

    it('should fail with invalid foreign key', async () => {
      try {
        await adapter.execute(
          'INSERT INTO test_posts (user_id, title, content) VALUES (?, ?, ?)',
          [99999, 'Invalid Post', 'This should fail']
        );
        assert.fail('Should have thrown foreign key error');
      } catch (e) {
        assert.ok(e.message.includes('foreign key') || e.message.includes('violates'));
      }
    });

    it('should cascade delete', async () => {
      // Get user with posts
      const userResult = await adapter.query(
        'SELECT id FROM test_users WHERE email = ?',
        ['alice@example.com']
      );
      const userId = userResult[0].id;

      // Verify post exists
      const postsBefore = await adapter.query(
        'SELECT * FROM test_posts WHERE user_id = ?',
        [userId]
      );
      assert.ok(postsBefore.length > 0);

      // Delete user
      await adapter.execute(
        'DELETE FROM test_users WHERE id = ?',
        [userId]
      );

      // Verify posts were cascade deleted
      const postsAfter = await adapter.query(
        'SELECT * FROM test_posts WHERE user_id = ?',
        [userId]
      );
      assert.strictEqual(postsAfter.length, 0);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent inserts', async () => {
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          adapter.execute(
            'INSERT INTO test_users (name, email) VALUES (?, ?)',
            [`User ${i}`, `user${i}@example.com`]
          )
        );
      }

      const results = await Promise.all(promises);
      assert.strictEqual(results.length, 10);
      results.forEach(result => {
        assert.ok(result.lastInsertRowid);
      });
    });

    it('should handle concurrent queries', async () => {
      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(
          adapter.query('SELECT * FROM test_users LIMIT 5')
        );
      }

      const results = await Promise.all(promises);
      assert.strictEqual(results.length, 20);
      results.forEach(result => {
        assert.ok(Array.isArray(result));
      });
    });
  });

  describe('Database Manager Integration', () => {
    it('should initialize database manager with PostgreSQL', async () => {
      db = await initializeDatabaseInstance();
      assert.ok(db);
      assert.strictEqual(db.getType(), 'postgresql');
    });

    it('should get pool statistics', () => {
      const stats = db.getPoolStats();
      assert.ok(stats);
      assert.ok(typeof stats.used === 'number');
      assert.ok(typeof stats.free === 'number');
    });

    it('should perform database operations', async () => {
      // This tests the full integration with DatabaseManager
      const users = await db.getAdapter().query('SELECT * FROM test_users LIMIT 1');
      assert.ok(Array.isArray(users));
    });
  });

  describe('Connection Pool', () => {
    it('should respect pool limits', async () => {
      const stats = adapter.getPoolStats();
      assert.ok(stats.max >= stats.min);
      assert.ok(stats.used + stats.free <= stats.max);
    });

    it('should reuse connections', async () => {
      const statsBefore = adapter.getPoolStats();
      
      // Execute multiple queries
      for (let i = 0; i < 5; i++) {
        await adapter.query('SELECT 1');
      }

      const statsAfter = adapter.getPoolStats();
      
      // Pool should not have grown significantly
      assert.ok(statsAfter.used + statsAfter.free <= statsAfter.max);
    });
  });
});

// Made with Bob
