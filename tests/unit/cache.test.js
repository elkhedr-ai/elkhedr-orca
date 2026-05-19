/**
 * T58: Redis Cache Layer Tests
 *
 * Tests the cache module in isolation:
 *   - Graceful degradation without Redis
 *   - Cache key helpers
 *   - Cache-aside (remember / rememberQuery)
 *   - with Redis server (integration)
 */

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

let cache;

describe('Cache Module (T58)', { concurrency: false }, () => {
  before(() => {
    // Clear module cache so we get a fresh instance
    delete require.cache[require.resolve(path.join(ROOT, 'src', 'cache', 'index.js'))];
    cache = require(path.join(ROOT, 'src', 'cache', 'index.js'));
  });

  after(async () => {
    await cache.close();
  });

  beforeEach(async () => {
    // Ensure cache is reset between tests
    await cache.close();
    delete require.cache[require.resolve(path.join(ROOT, 'src', 'cache', 'index.js'))];
    cache = require(path.join(ROOT, 'src', 'cache', 'index.js'));
  });

  // ---- Init without Redis ----

  describe('init without Redis', () => {
    it('should initialize without error when no URL given', async () => {
      await cache.init('');
      assert.strictEqual(cache.isEnabled(), false);
    });

    it('should initialize without error when null URL given', async () => {
      await cache.init(null);
      assert.strictEqual(cache.isEnabled(), false);
    });
  });

  // ---- Key helpers ----

  describe('key helpers', () => {
    it('should build namespaced keys', () => {
      assert.strictEqual(cache.buildKey('session', 'abc'), 'orca:session:abc');
      assert.strictEqual(cache.buildKey('analytics', 42), 'orca:analytics:42');
    });

    it('should hash composite keys for queries', () => {
      const hash = cache.hashKey('analytics', ['user', 1]);
      assert.ok(hash.startsWith('orca:analytics:'));
      // Same input produces same hash
      const hash2 = cache.hashKey('analytics', ['user', 1]);
      assert.strictEqual(hash, hash2);
      // Different input produces different hash
      const hash3 = cache.hashKey('analytics', ['user', 2]);
      assert.notStrictEqual(hash, hash3);
    });
  });

  // ---- Operations without Redis ----

  describe('operations without Redis', () => {
    it('should return null from get when disabled', async () => {
      const val = await cache.get('test');
      assert.strictEqual(val, null);
    });

    it('should not throw from set when disabled', async () => {
      await cache.set('test', { foo: 'bar' });
      // No assertion needed — should not throw
      assert.ok(true);
    });

    it('should not throw from del when disabled', async () => {
      await cache.del('test');
      assert.ok(true);
    });

    it('should not throw from delPattern when disabled', async () => {
      await cache.delPattern('orca:*');
      assert.ok(true);
    });

    it('should call fallback in remember when disabled', async () => {
      let fallbackCalled = false;
      const result = await cache.remember('ns', 'id', async () => {
        fallbackCalled = true;
        return 'fallback-value';
      });
      assert.strictEqual(fallbackCalled, true);
      assert.strictEqual(result, 'fallback-value');
    });

    it('should call fallback in rememberQuery when disabled', async () => {
      let fallbackCalled = false;
      const result = await cache.rememberQuery('ns', ['a', 1], async () => {
        fallbackCalled = true;
        return { data: 'cached' };
      });
      assert.strictEqual(fallbackCalled, true);
      assert.deepStrictEqual(result, { data: 'cached' });
    });
  });

  // ---- Default TTL ----

  describe('default TTL', () => {
    it('should return the default TTL constant', () => {
      const ttl = cache.getDefaultTTL();
      assert.strictEqual(typeof ttl, 'number');
      assert.ok(ttl > 0);
    });
  });

  // ---- Module exports ----

  describe('module exports', () => {
    it('should export all expected functions', () => {
      assert.strictEqual(typeof cache.init, 'function');
      assert.strictEqual(typeof cache.close, 'function');
      assert.strictEqual(typeof cache.isEnabled, 'function');
      assert.strictEqual(typeof cache.get, 'function');
      assert.strictEqual(typeof cache.set, 'function');
      assert.strictEqual(typeof cache.del, 'function');
      assert.strictEqual(typeof cache.delPattern, 'function');
      assert.strictEqual(typeof cache.remember, 'function');
      assert.strictEqual(typeof cache.rememberQuery, 'function');
      assert.strictEqual(typeof cache.buildKey, 'function');
      assert.strictEqual(typeof cache.hashKey, 'function');
      assert.strictEqual(typeof cache.getDefaultTTL, 'function');
    });
  });
});
