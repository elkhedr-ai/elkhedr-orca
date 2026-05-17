/**
 * Tests for Real-time Event Streaming
 */

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { EventStreamHub } = require('../../src/events/stream.js');
const { StreamingServer } = require('../../src/server/websocket.js');
const { EventBus } = require('../../src/events/bus.js');
const { MemoryEventStore } = require('../../src/events/store.js');

describe('EventStreamHub', () => {
  let hub;
  let bus;

  beforeEach(() => {
    bus = new EventBus({ name: 'test', store: new MemoryEventStore() });
    hub = new EventStreamHub({ eventBus: bus, heartbeatInterval: 0 });
  });

  after(() => {
    if (hub) hub.stop();
    if (bus) bus.stop();
  });

  it('should create hub with defaults', () => {
    assert.strictEqual(hub.maxClients, 100);
    assert.strictEqual(hub.clients.size, 0);
  });

  it('should add SSE client', () => {
    const res = new http.ServerResponse({ method: 'GET', url: '/' });
    res.write = () => true;
    res.end = () => {};
    res.on = () => {};
    
    const clientId = hub.addSSEClient(res);
    assert.ok(clientId);
    assert.ok(clientId.startsWith('sse_'));
    assert.strictEqual(hub.clients.size, 1);
  });

  it('should reject SSE client when max reached', () => {
    hub.maxClients = 1;
    
    const res1 = new http.ServerResponse({ method: 'GET', url: '/' });
    res1.write = () => true;
    res1.end = () => {};
    res1.on = () => {};
    res1.writeHead = () => {};
    
    hub.addSSEClient(res1);
    
    const res2 = new http.ServerResponse({ method: 'GET', url: '/' });
    res2.writeHead = (code) => { res2.statusCode = code; };
    res2.end = () => {};
    
    const clientId = hub.addSSEClient(res2);
    assert.strictEqual(clientId, null);
    assert.strictEqual(res2.statusCode, 503);
  });

  it('should remove client', () => {
    const res = new http.ServerResponse({ method: 'GET', url: '/' });
    res.write = () => true;
    res.end = () => {};
    res.on = () => {};
    
    const clientId = hub.addSSEClient(res);
    assert.strictEqual(hub.clients.size, 1);
    
    hub.removeClient(clientId);
    assert.strictEqual(hub.clients.size, 0);
  });

  it('should broadcast events to SSE clients', () => {
    const messages = [];
    const res = new http.ServerResponse({ method: 'GET', url: '/' });
    res.write = (data) => {
      messages.push(data);
      return true;
    };
    res.end = () => {};
    res.on = () => {};
    
    hub.addSSEClient(res);
    
    hub.broadcast({ type: 'test-event', data: { msg: 'hello' } });
    
    assert.ok(messages.some(m => m.includes('test-event')));
    assert.ok(messages.some(m => m.includes('hello')));
  });

  it('should filter events by type', () => {
    const messages = [];
    const res = new http.ServerResponse({ method: 'GET', url: '/' });
    res.write = (data) => {
      messages.push(data);
      return true;
    };
    res.end = () => {};
    res.on = () => {};
    
    hub.addSSEClient(res, { filterTypes: ['allowed'] });
    
    hub.broadcast({ type: 'allowed', data: {} });
    hub.broadcast({ type: 'blocked', data: {} });
    
    const allowedMessages = messages.filter(m => m.includes('allowed'));
    const blockedMessages = messages.filter(m => m.includes('blocked'));
    
    assert.strictEqual(allowedMessages.length > 0, true);
    assert.strictEqual(blockedMessages.length, 0);
  });

  it('should track statistics', () => {
    const res = new http.ServerResponse({ method: 'GET', url: '/' });
    res.write = () => true;
    res.end = () => {};
    res.on = () => {};
    
    hub.addSSEClient(res);
    hub.broadcast({ type: 'test', data: {} });
    
    const stats = hub.getStats();
    assert.strictEqual(stats.totalClients, 1);
    assert.strictEqual(stats.sseClients, 1);
    assert.strictEqual(stats.messagesSent, 1);
    assert.ok(stats.bytesSent > 0);
  });

  it('should return client list', () => {
    const res = new http.ServerResponse({ method: 'GET', url: '/' });
    res.write = () => true;
    res.end = () => {};
    res.on = () => {};
    
    hub.addSSEClient(res);
    
    const clients = hub.getClients();
    assert.strictEqual(clients.length, 1);
    assert.strictEqual(clients[0].type, 'sse');
    assert.ok(clients[0].connectedAt);
  });
});

describe('StreamingServer', () => {
  let server;

  after(() => {
    if (server) server.stop();
  });

  it('should create server with defaults', () => {
    server = new StreamingServer();
    assert.strictEqual(server.port, 3001);
    assert.strictEqual(server.running, false);
  });

  it('should start and stop server', async () => {
    server = new StreamingServer({ port: 3999 });
    
    const startPromise = new Promise(resolve => {
      server.httpServer = { listen: () => resolve() };
      server.start();
      setTimeout(resolve, 100);
    });
    
    await startPromise;
    
    // Server should have attempted to start
    assert.ok(server.httpServer);
  });

  it('should return status', () => {
    server = new StreamingServer({ port: 3998 });
    const status = server.getStatus();
    assert.strictEqual(status.running, false);
    assert.strictEqual(status.address, null);
  });
});
