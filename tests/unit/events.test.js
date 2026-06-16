/**
 * Tests for Event Bus Architecture
 */

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert');

// Mock pino to prevent transports from keeping process alive
const pinoPath = require.resolve('pino');
require.cache[pinoPath] = {
  id: pinoPath,
  filename: pinoPath,
  loaded: true,
  exports: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => ({
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {}
    })
  })
};

const { EventBus, BUILTIN_EVENTS, getEventBus, resetEventBus } = require('../../src/events/bus.js');
const { MemoryEventStore } = require('../../src/events/store.js');

describe('EventBus - Basic Operations', () => {
  let bus;

  beforeEach(() => {
    bus = new EventBus({ name: 'test', store: new MemoryEventStore() });
  });

  after(() => {
    if (bus) bus.stop();
  });

  it('should create event bus with default options', () => {
    const b = new EventBus({ store: new MemoryEventStore() });
    assert.strictEqual(b.name, 'default');
    b.stop();
  });

  it('should create event bus with custom options', () => {
    const b = new EventBus({ name: 'custom', maxListeners: 50, store: new MemoryEventStore() });
    assert.strictEqual(b.name, 'custom');
    b.stop();
  });

  it('should define builtin events', () => {
    assert.ok(BUILTIN_EVENTS.includes('agent_start'));
    assert.ok(BUILTIN_EVENTS.includes('agent_complete'));
    assert.ok(BUILTIN_EVENTS.includes('tool_call'));
    assert.ok(BUILTIN_EVENTS.includes('cost_update'));
    assert.ok(BUILTIN_EVENTS.includes('system_shutdown'));
  });
});

describe('EventBus - Publish and Subscribe', () => {
  let bus;

  beforeEach(() => {
    bus = new EventBus({ name: 'test', store: new MemoryEventStore() });
  });

  it('should publish an event', () => {
    const event = bus.publish('test-event', { foo: 'bar' });
    assert.ok(event.timestamp);
    assert.strictEqual(event.type, 'test-event');
    assert.strictEqual(event.data.foo, 'bar');
    assert.ok(event.correlationId);
  });

  it('should subscribe to events', () => {
    const received = [];
    const unsub = bus.subscribe('test-event', (data, event) => {
      received.push({ data, event });
    });

    bus.publish('test-event', { msg: 'hello' });

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].data.msg, 'hello');
    assert.ok(received[0].event.timestamp);

    unsub();
  });

  it('should unsubscribe from events', () => {
    const received = [];
    const unsub = bus.subscribe('test-event', (data) => {
      received.push(data);
    });

    bus.publish('test-event', { msg: 1 });
    unsub();
    bus.publish('test-event', { msg: 2 });

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].msg, 1);
  });

  it('should support multiple subscribers', () => {
    const received1 = [];
    const received2 = [];

    bus.subscribe('multi-event', (data) => received1.push(data));
    bus.subscribe('multi-event', (data) => received2.push(data));

    bus.publish('multi-event', { test: true });

    assert.strictEqual(received1.length, 1);
    assert.strictEqual(received2.length, 1);
  });

  it('should support wildcard subscription', () => {
    const received = [];
    bus.subscribe('*', (event) => {
      received.push(event.type);
    });

    bus.publish('event-a', {});
    bus.publish('event-b', {});

    assert.strictEqual(received.length, 2);
    assert.ok(received.includes('event-a'));
    assert.ok(received.includes('event-b'));
  });

  it('should support once subscription', () => {
    const received = [];
    bus.once('once-event', (data) => {
      received.push(data);
    });

    bus.publish('once-event', { n: 1 });
    bus.publish('once-event', { n: 2 });

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].n, 1);
  });

  it('should support array of event types', () => {
    const received = [];
    bus.subscribe(['event-a', 'event-b'], (data) => {
      received.push(data);
    });

    bus.publish('event-a', { letter: 'a' });
    bus.publish('event-b', { letter: 'b' });
    bus.publish('event-c', { letter: 'c' });

    assert.strictEqual(received.length, 2);
  });

  it('should throw for invalid event type', () => {
    assert.throws(() => bus.publish('', {}), /non-empty string/);
    assert.throws(() => bus.publish(123, {}), /non-empty string/);
  });

  it('should throw for invalid handler', () => {
    assert.throws(() => bus.subscribe('test', 'not-a-function'), /function/);
  });
});

describe('EventBus - Persistence', () => {
  let bus;

  beforeEach(() => {
    bus = new EventBus({ name: 'test', store: new MemoryEventStore() });
  });

  it('should persist events to store', () => {
    bus.publish('persist-event', { test: true });

    const events = bus.query({ type: 'persist-event' });
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'persist-event');
  });

  it('should query events by type', () => {
    bus.publish('type-a', {});
    bus.publish('type-a', {});
    bus.publish('type-b', {});

    const events = bus.query({ type: 'type-a' });
    assert.strictEqual(events.length, 2);
  });

  it('should query events by multiple types', () => {
    bus.publish('type-a', {});
    bus.publish('type-b', {});
    bus.publish('type-c', {});

    const events = bus.query({ types: ['type-a', 'type-b'] });
    assert.strictEqual(events.length, 2);
  });

  it('should query events by time range', () => {
    const now = Date.now();
    bus.publish('timed-event', {});

    const events = bus.query({ after: now - 1000 });
    assert.strictEqual(events.length, 1);

    const futureEvents = bus.query({ after: now + 1000 });
    assert.strictEqual(futureEvents.length, 0);
  });

  it('should query events with custom filter', () => {
    bus.publish('filtered-event', { status: 'active' });
    bus.publish('filtered-event', { status: 'inactive' });

    const activeEvents = bus.query({
      type: 'filtered-event',
      filter: (e) => e.data.status === 'active'
    });

    assert.strictEqual(activeEvents.length, 1);
  });
});

describe('EventBus - Replay', () => {
  let bus;

  beforeEach(() => {
    bus = new EventBus({ name: 'test', store: new MemoryEventStore() });
  });

  it('should replay events', () => {
    const received = [];
    bus.subscribe('replay-event', (data) => {
      received.push(data);
    });

    bus.publish('replay-event', { n: 1 });
    bus.publish('replay-event', { n: 2 });
    bus.publish('replay-event', { n: 3 });

    // Clear and replay
    received.length = 0;
    const count = bus.replay({ types: ['replay-event'] });

    assert.strictEqual(count, 3);
    assert.strictEqual(received.length, 3);
  });

  it('should replay events from timestamp', () => {
    const received = [];
    bus.subscribe('time-event', (data) => {
      received.push(data.n);
    });

    bus.publish('time-event', { n: 1 });
    bus.publish('time-event', { n: 2 });

    const afterTime = Date.now();

    received.length = 0;
    bus.replay({ types: ['time-event'], startFrom: afterTime - 1000 });

    assert.strictEqual(received.length, 2);
  });
});

describe('EventBus - Statistics', () => {
  let bus;

  beforeEach(() => {
    bus = new EventBus({ name: 'test', store: new MemoryEventStore() });
  });

  it('should track publish statistics', () => {
    bus.publish('stat-a', {});
    bus.publish('stat-a', {});
    bus.publish('stat-b', {});

    const stats = bus.getStats();
    assert.strictEqual(stats.totalPublished, 3);
    assert.strictEqual(stats.eventsByType['stat-a'], 2);
    assert.strictEqual(stats.eventsByType['stat-b'], 1);
  });

  it('should track subscriber statistics', () => {
    const unsub1 = bus.subscribe('sub-event', () => {});
    const unsub2 = bus.subscribe('sub-event', () => {});

    const stats = bus.getStats();
    assert.strictEqual(stats.totalSubscribers, 2);

    unsub1();
    unsub2();
  });

  it('should return store counts', () => {
    bus.publish('count-event', {});

    const stats = bus.getStats();
    assert.strictEqual(stats.storeCount, 1);
  });
});

describe('EventBus - Global Instance', () => {
  beforeEach(() => {
    resetEventBus();
  });

  after(() => {
    resetEventBus();
  });

  it('should return singleton instance', () => {
    const bus1 = getEventBus();
    const bus2 = getEventBus();

    assert.strictEqual(bus1, bus2);
  });

  it('should reset global instance', () => {
    const bus1 = getEventBus();
    resetEventBus();
    const bus2 = getEventBus();

    assert.notStrictEqual(bus1, bus2);
  });
});

describe('EventBus - Cleanup', () => {
  let bus;

  beforeEach(() => {
    bus = new EventBus({ name: 'test', store: new MemoryEventStore() });
  });

  it('should clear subscribers', () => {
    let called = false;
    bus.subscribe('clear-event', () => { called = true; });

    bus.clearSubscribers();
    bus.publish('clear-event', {});

    assert.strictEqual(called, false);
  });

  it('should clear store', () => {
    bus.publish('store-event', {});
    assert.strictEqual(bus.query({}).length, 1);

    bus.clearStore();
    assert.strictEqual(bus.query({}).length, 0);
  });

  it('should stop event bus', () => {
    let called = false;
    bus.subscribe('stop-event', () => { called = true; });

    bus.stop();
    bus.publish('stop-event', {});

    assert.strictEqual(called, false);
  });
});

describe('EventStore - Memory', () => {
  let store;

  beforeEach(() => {
    store = new MemoryEventStore();
  });

  it('should append and read events', () => {
    store.append({ type: 'test', timestamp: Date.now(), data: {} });
    assert.strictEqual(store.count(), 1);
  });

  it('should query events', () => {
    store.append({ type: 'a', timestamp: Date.now(), data: {} });
    store.append({ type: 'b', timestamp: Date.now(), data: {} });

    const result = store.query({ type: 'a' });
    assert.strictEqual(result.length, 1);
  });

  it('should count by type', () => {
    store.append({ type: 'a', timestamp: Date.now(), data: {} });
    store.append({ type: 'a', timestamp: Date.now(), data: {} });
    store.append({ type: 'b', timestamp: Date.now(), data: {} });

    const counts = store.countByType();
    assert.strictEqual(counts['a'], 2);
    assert.strictEqual(counts['b'], 1);
  });

  it('should support replay', () => {
    store.append({ type: 'test', timestamp: Date.now(), data: { n: 1 } });
    store.append({ type: 'test', timestamp: Date.now(), data: { n: 2 } });

    const replayed = store.getReplayStream(0);
    assert.strictEqual(replayed.length, 2);
  });

  it('should support replay from index', () => {
    store.append({ type: 'test', timestamp: Date.now(), data: { n: 1 } });
    store.append({ type: 'test', timestamp: Date.now(), data: { n: 2 } });

    const replayed = store.getReplayStream(1);
    assert.strictEqual(replayed.length, 1);
    assert.strictEqual(replayed[0].data.n, 2);
  });

  it('should clear events', () => {
    store.append({ type: 'test', timestamp: Date.now(), data: {} });
    store.clear();
    assert.strictEqual(store.count(), 0);
  });
});

describe('EventStore - File', () => {
  const fs = require('fs');
  const testFile = '/tmp/test-events.jsonl';
  let fileStore;

  beforeEach(() => {
    try { fs.unlinkSync(testFile); } catch {}
    if (fileStore) {
      fileStore.stop();
      fileStore = null;
    }
  });

  it('should persist to file and read', () => {
    const { FileEventStore } = require('../../src/events/store.js');
    fileStore = new FileEventStore({ filePath: testFile, bufferSize: 1, flushInterval: 0 });

    fileStore.append({ type: 'file-test', timestamp: Date.now(), data: { msg: 'hello' } });

    const events = fileStore.readAll();
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].data.msg, 'hello');
  });

  it('should buffer and flush events', () => {
    const { FileEventStore } = require('../../src/events/store.js');
    fileStore = new FileEventStore({ filePath: testFile, bufferSize: 5, flushInterval: 0 });

    fileStore.append({ type: 'buff', timestamp: Date.now(), data: {} });
    assert.strictEqual(fileStore.buffer.length, 1); // Still in buffer
    assert.strictEqual(fileStore.readAll().length, 1); // readAll flushes
  });

  it('should query file store', () => {
    const { FileEventStore } = require('../../src/events/store.js');
    fileStore = new FileEventStore({ filePath: testFile, bufferSize: 1, flushInterval: 0 });

    fileStore.append({ type: 'query-a', timestamp: Date.now(), data: {} });
    fileStore.append({ type: 'query-b', timestamp: Date.now(), data: {} });

    const result = fileStore.query({ type: 'query-a' });
    assert.strictEqual(result.length, 1);
  });

  it('should archive old events', () => {
    const { FileEventStore } = require('../../src/events/store.js');
    fileStore = new FileEventStore({ filePath: testFile, bufferSize: 1, flushInterval: 0 });

    fileStore.append({ type: 'old', timestamp: Date.now() - 100000, data: {} });
    fileStore.append({ type: 'new', timestamp: Date.now(), data: {} });

    const archived = fileStore.archive(50000); // 50s max age
    assert.strictEqual(archived, 1);
    assert.strictEqual(fileStore.count(), 1);
  });

  after(() => {
    try { fs.unlinkSync(testFile); } catch {}
  });
});
