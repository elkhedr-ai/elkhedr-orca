const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const { buildServer } = require('../../src/server/index.js');

describe('API Server', () => {
  let app;

  before(async () => {
    process.env.ORCA_DB_URL = ':memory:';
    const { initializeDatabaseInstance } = require('../../src/db');
    await initializeDatabaseInstance();
    app = await buildServer();
  });

  after(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('Health Routes', () => {
    it('should return health status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.status, 'ok');
      assert.ok(body.uptime);
      assert.ok(body.timestamp);
    });

    it('should return readiness status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/ready'
      });

      // May be 200 or 503 depending on DB state
      assert.ok([200, 503].includes(response.statusCode));
    });
  });

  describe('Auth Routes', () => {
    it('should register a new user', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username: `testuser_${Date.now()}`,
          email: `test_${Date.now()}@example.com`,
          password: 'Password123!'
        }
      });

      assert.strictEqual(response.statusCode, 201);
      const body = JSON.parse(response.body);
      assert.ok(body.user);
      assert.ok(body.tokens);
      assert.ok(body.tokens.accessToken);
    });

    it('should fail registration with short password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username: 'testuser',
          email: 'test@example.com',
          password: 'short'
        }
      });

      assert.strictEqual(response.statusCode, 400);
      const body = JSON.parse(response.body);
      assert.ok(body.error);
    });

    it('should login with valid credentials', async () => {
      // First register
      const username = `logintest_${Date.now()}`;
      const password = 'Password123!';

      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username,
          email: `${username}@example.com`,
          password
        }
      });

      // Then login
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          usernameOrEmail: username,
          password
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(body.tokens);
      assert.ok(body.tokens.accessToken);
    });

    it('should fail login with invalid credentials', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          usernameOrEmail: 'nonexistent',
          password: 'wrongpassword'
        }
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe('Agent Routes', () => {
    let authToken;

    before(async () => {
      // Register and login to get token
      const username = `agenttest_${Date.now()}`;
      const regResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username,
          email: `${username}@example.com`,
          password: 'Password123!'
        }
      });
      const regBody = JSON.parse(regResponse.body);
      authToken = regBody.tokens.accessToken;
    });

    it('should list agents', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/agents',
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body.agents));
    });

    it('should reject unauthenticated agent access', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/agents'
      });

      assert.strictEqual(response.statusCode, 401);
    });
  });

  describe('Session Routes', () => {
    let authToken;

    before(async () => {
      const username = `sessiontest_${Date.now()}`;
      const regResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username,
          email: `${username}@example.com`,
          password: 'Password123!'
        }
      });
      const regBody = JSON.parse(regResponse.body);
      authToken = regBody.tokens.accessToken;
    });

    it('should create a session', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/sessions',
        headers: {
          Authorization: `Bearer ${authToken}`
        },
        payload: {
          prompt: 'Test prompt',
          mode: 'instant',
          agent: 'test-agent',
          result: 'Test result',
          tokens: 100
        }
      });

      assert.strictEqual(response.statusCode, 201);
      const body = JSON.parse(response.body);
      assert.ok(body.session);
      assert.ok(body.session.id);
    });

    it('should list user sessions', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/sessions',
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body.sessions));
    });
  });

  describe('Analytics Routes', () => {
    let authToken;

    before(async () => {
      const username = `analyticstest_${Date.now()}`;
      const regResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          username,
          email: `${username}@example.com`,
          password: 'Password123!'
        }
      });
      const regBody = JSON.parse(regResponse.body);
      authToken = regBody.tokens.accessToken;
    });

    it('should get analytics summary', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/analytics',
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(body.analytics);
      assert.ok(typeof body.analytics.totalOperations === 'number');
    });

    it('should get daily analytics', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/analytics/daily',
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(Array.isArray(body.daily));
    });
  });

  describe('Rate Limiting', () => {
    it('should have rate limit headers', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health'
      });

      assert.ok(response.headers['x-ratelimit-limit']);
      assert.ok(response.headers['x-ratelimit-remaining']);
    });
  });

  describe('OpenAPI', () => {
    it('should serve swagger JSON', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/docs/json'
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.openapi, '3.0.3');
      assert.ok(body.paths);
    });
  });
});
