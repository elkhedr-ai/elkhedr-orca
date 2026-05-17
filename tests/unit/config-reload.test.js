/**
 * Tests for Hot Config Reload
 */

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { 
  subscribe, 
  unsubscribe, 
  diffConfig, 
  reload,
  getSubscriberCount,
  isWatchingActive
} = require('../../src/config/loader.js');

describe('Config Reload - diffConfig', () => {
  it('should detect added keys', () => {
    const old = { a: 1 };
    const next = { a: 1, b: 2 };
    const changes = diffConfig(old, next);
    
    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].key, 'b');
    assert.strictEqual(changes[0].old, undefined);
    assert.strictEqual(changes[0].new, 2);
  });

  it('should detect removed keys', () => {
    const old = { a: 1, b: 2 };
    const next = { a: 1 };
    const changes = diffConfig(old, next);
    
    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].key, 'b');
    assert.strictEqual(changes[0].old, 2);
    assert.strictEqual(changes[0].new, undefined);
  });

  it('should detect changed values', () => {
    const old = { a: 1 };
    const next = { a: 2 };
    const changes = diffConfig(old, next);
    
    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].key, 'a');
    assert.strictEqual(changes[0].old, 1);
    assert.strictEqual(changes[0].new, 2);
  });

  it('should return empty array for identical configs', () => {
    const old = { a: 1, b: 'test' };
    const next = { a: 1, b: 'test' };
    const changes = diffConfig(old, next);
    
    assert.deepStrictEqual(changes, []);
  });

  it('should handle nested objects via JSON stringify', () => {
    const old = { a: { nested: 1 } };
    const next = { a: { nested: 2 } };
    const changes = diffConfig(old, next);
    
    assert.strictEqual(changes.length, 1);
    assert.strictEqual(changes[0].key, 'a');
  });
});

describe('Config Reload - Subscribers', () => {
  beforeEach(() => {
    // Clear all subscribers between tests
    const subs = getSubscriberCount();
    // We can't directly clear, but we track unsubscribers
  });

  it('should register and call subscriber', () => {
    let called = false;
    let receivedNew = null;
    
    const unsub = subscribe((newConfig, oldConfig, changes) => {
      called = true;
      receivedNew = newConfig;
    });
    
    assert.strictEqual(getSubscriberCount(), 1);
    
    reload({
      reloadFn: () => ({ foo: 'bar' }),
      getConfigFn: () => ({ foo: 'baz' })
    });
    
    assert.strictEqual(called, true);
    assert.deepStrictEqual(receivedNew, { foo: 'bar' });
    
    unsub();
  });

  it('should remove subscriber on unsubscribe', () => {
    const callback = () => {};
    const unsub = subscribe(callback);
    
    assert.strictEqual(getSubscriberCount(), 1);
    
    unsubscribe(callback);
    assert.strictEqual(getSubscriberCount(), 0);
  });

  it('should handle multiple subscribers', () => {
    const calls = [];
    
    const unsub1 = subscribe((newConfig) => calls.push('sub1'));
    const unsub2 = subscribe((newConfig) => calls.push('sub2'));
    
    reload({
      reloadFn: () => ({ changed: true }),
      getConfigFn: () => ({ changed: false })
    });
    
    assert.strictEqual(calls.length, 2);
    assert.ok(calls.includes('sub1'));
    assert.ok(calls.includes('sub2'));
    
    unsub1();
    unsub2();
  });

  it('should not break when subscriber throws', () => {
    const goodSub = { called: false };
    
    const unsub1 = subscribe(() => {
      throw new Error('Subscriber error');
    });
    
    const unsub2 = subscribe(() => {
      goodSub.called = true;
    });
    
    reload({
      reloadFn: () => ({ a: 1 }),
      getConfigFn: () => ({ a: 2 })
    });
    
    assert.strictEqual(goodSub.called, true);
    
    unsub1();
    unsub2();
  });

  it('should throw for non-function subscriber', () => {
    assert.throws(() => subscribe('not-a-function'), /function/);
  });
});

describe('Config Reload - reload', () => {
  it('should return diff on reload', () => {
    const result = reload({
      reloadFn: () => ({ key: 'new-value', added: true }),
      getConfigFn: () => ({ key: 'old-value' })
    });
    
    assert.strictEqual(result.changes.length, 2);
    assert.ok(result.newConfig);
    assert.ok(result.oldConfig);
  });

  it('should not notify when no changes', () => {
    let called = false;
    
    const unsub = subscribe(() => { called = true; });
    
    reload({
      reloadFn: () => ({ same: true }),
      getConfigFn: () => ({ same: true })
    });
    
    assert.strictEqual(called, false);
    
    unsub();
  });

  it('should throw without required options', () => {
    assert.throws(() => reload({}), /required/);
    assert.throws(() => reload({ reloadFn: () => {} }), /required/);
  });
});

describe('Config Reload - Watching State', () => {
  it('should report watching status', () => {
    // Before starting any watcher
    assert.strictEqual(typeof isWatchingActive(), 'boolean');
  });
});
