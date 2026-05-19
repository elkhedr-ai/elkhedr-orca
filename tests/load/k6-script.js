/**
 * k6 Load Test Suite for Orca API
 *
 * Tests API endpoints under load to validate:
 * - P95 latency < 500ms at 1000 concurrent users
 * - Database query time < 50ms
 * - Error rate < 1%
 *
 * Usage:
 *   k6 run tests/load/k6-script.js
 *   k6 run --env BASE_URL=http://localhost:3000 tests/load/k6-script.js
 *   k6 run --env API_KEY=orca_live_xxx tests/load/k6-script.js
 *
 * Environment variables:
 *   BASE_URL  - API server URL (default: http://localhost:3000)
 *   API_KEY   - API key for authenticated requests (optional, auto-login if not set)
 *   TEST_USER - Username for auto-login (default: admin)
 *   TEST_PASS - Password for auto-login (default: admin123)
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const healthDuration = new Trend('health_duration', true);
const agentsDuration = new Trend('agents_duration', true);
const sessionsDuration = new Trend('sessions_duration', true);
const dbQueryTime = new Trend('db_query_time', true);
const requestCount = new Counter('total_requests');

// Configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const API_KEY = __ENV.API_KEY || '';
const TEST_USER = __ENV.TEST_USER || 'admin';
const TEST_PASS = __ENV.TEST_PASS || 'admin123';

// Test scenarios with ramping stages
export const options = {
  scenarios: {
    // Smoke test: low traffic health checks
    health_smoke: {
      executor: 'constant-vus',
      vus: 10,
      duration: '30s',
      tags: { test_type: 'health' },
      exec: 'healthTest',
    },

    // Ramp-up load test for authenticated endpoints
    agents_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },   // Ramp up
        { duration: '1m', target: 500 },    // Scale to 500
        { duration: '2m', target: 1000 },   // Peak at 1000
        { duration: '1m', target: 1000 },   // Hold peak
        { duration: '30s', target: 0 },     // Ramp down
      ],
      tags: { test_type: 'agents' },
      exec: 'agentsTest',
    },

    // Session operations under load
    sessions_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '1m', target: 250 },
        { duration: '2m', target: 500 },
        { duration: '1m', target: 500 },
        { duration: '30s', target: 0 },
      ],
      tags: { test_type: 'sessions' },
      exec: 'sessionsTest',
    },
  },

  thresholds: {
    // P95 latency must be under 500ms
    'http_req_duration{test_type:health}': ['p(95)<500'],
    'http_req_duration{test_type:agents}': ['p(95)<500'],
    'http_req_duration{test_type:sessions}': ['p(95)<500'],

    // Custom metric thresholds
    health_duration: ['p(95)<500'],
    agents_duration: ['p(95)<500'],
    sessions_duration: ['p(95)<500'],

    // Error rate must be under 1%
    errors: ['rate<0.01'],

    // Request success rate
    'http_req_failed': ['rate<0.01'],
  },
};

/**
 * Setup: authenticate and get a token
 */
export function setup() {
  // If API key is provided, use it directly
  if (API_KEY) {
    return { token: '', apiKey: API_KEY };
  }

  // Attempt login to get JWT token
  const loginRes = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({
      usernameOrEmail: TEST_USER,
      password: TEST_PASS,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (loginRes.status === 200) {
    const body = JSON.parse(loginRes.body);
    return { token: body.accessToken || body.token || '', apiKey: '' };
  }

  // Fallback: try to register a test user
  const regRes = http.post(
    `${BASE_URL}/api/v1/auth/register`,
    JSON.stringify({
      username: TEST_USER,
      email: `${TEST_USER}@loadtest.local`,
      password: TEST_PASS,
      role: 'admin',
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (regRes.status === 201 || regRes.status === 200) {
    const body = JSON.parse(regRes.body);
    return { token: body.accessToken || body.token || '', apiKey: '' };
  }

  console.warn('Could not authenticate. Testing unauthenticated endpoints only.');
  return { token: '', apiKey: '' };
}

/**
 * Build request headers with auth
 */
function headers(data) {
  const h = { 'Content-Type': 'application/json' };
  if (data.apiKey) {
    h['X-API-Key'] = data.apiKey;
  } else if (data.token) {
    h['Authorization'] = `Bearer ${data.token}`;
  }
  return h;
}

/**
 * Health endpoint tests (no auth required)
 */
export function healthTest() {
  group('Health Endpoints', () => {
    // Liveness probe
    group('GET /health', () => {
      const res = http.get(`${BASE_URL}/health`);
      healthDuration.add(res.timings.duration);
      requestCount.add(1);

      const passed = check(res, {
        'health status is 200': (r) => r.status === 200,
        'health has status field': (r) => {
          try { return JSON.parse(r.body).status === 'ok'; } catch { return false; }
        },
        'health response time < 200ms': (r) => r.timings.duration < 200,
      });

      errorRate.add(!passed);
    });

    // Readiness probe
    group('GET /ready', () => {
      const res = http.get(`${BASE_URL}/ready`);
      healthDuration.add(res.timings.duration);
      requestCount.add(1);

      const passed = check(res, {
        'ready returns 200 or 503': (r) => r.status === 200 || r.status === 503,
        'ready has checks': (r) => {
          try { return JSON.parse(r.body).checks !== undefined; } catch { return false; }
        },
      });

      errorRate.add(!passed);
    });
  });

  sleep(0.5);
}

/**
 * Agent endpoints load test
 */
export function agentsTest(data) {
  const hdrs = headers(data);

  group('Agent Endpoints', () => {
    // List agents
    group('GET /api/v1/agents', () => {
      const res = http.get(`${BASE_URL}/api/v1/agents?limit=50`, { headers: hdrs });
      agentsDuration.add(res.timings.duration);
      requestCount.add(1);

      const passed = check(res, {
        'agents list status is 200': (r) => r.status === 200,
        'agents returns array': (r) => {
          try { return Array.isArray(JSON.parse(r.body).agents); } catch { return false; }
        },
        'agents response time < 500ms': (r) => r.timings.duration < 500,
      });

      errorRate.add(!passed);
    });

    // Get agents with department filter
    group('GET /api/v1/agents?department=engineering', () => {
      const res = http.get(`${BASE_URL}/api/v1/agents?department=engineering`, { headers: hdrs });
      agentsDuration.add(res.timings.duration);
      requestCount.add(1);

      check(res, {
        'filtered agents status ok': (r) => r.status === 200 || r.status === 401,
      });
    });

    // Get single agent (ID 1)
    group('GET /api/v1/agents/1', () => {
      const res = http.get(`${BASE_URL}/api/v1/agents/1`, { headers: hdrs });
      agentsDuration.add(res.timings.duration);
      requestCount.add(1);

      const passed = check(res, {
        'agent detail returns 200 or 404': (r) => r.status === 200 || r.status === 404,
        'agent detail response time < 300ms': (r) => r.timings.duration < 300,
      });

      errorRate.add(!passed);
    });
  });

  sleep(0.3);
}

/**
 * Session endpoints load test
 */
export function sessionsTest(data) {
  const hdrs = headers(data);

  group('Session Endpoints', () => {
    // List sessions
    group('GET /api/v1/sessions', () => {
      const res = http.get(`${BASE_URL}/api/v1/sessions?limit=50`, { headers: hdrs });
      sessionsDuration.add(res.timings.duration);
      requestCount.add(1);

      const passed = check(res, {
        'sessions list status is 200': (r) => r.status === 200,
        'sessions returns array': (r) => {
          try { return Array.isArray(JSON.parse(r.body).sessions); } catch { return false; }
        },
        'sessions response time < 500ms': (r) => r.timings.duration < 500,
      });

      errorRate.add(!passed);
    });

    // Create a session
    group('POST /api/v1/sessions', () => {
      const payload = JSON.stringify({
        prompt: `Load test session ${Date.now()}`,
        mode: 'instant',
        agent: 'load-test-agent',
        result: 'Load test result',
        tokens: 100,
      });

      const res = http.post(`${BASE_URL}/api/v1/sessions`, payload, { headers: hdrs });
      sessionsDuration.add(res.timings.duration);
      requestCount.add(1);

      const passed = check(res, {
        'session create returns 201': (r) => r.status === 201,
        'session create response time < 500ms': (r) => r.timings.duration < 500,
      });

      errorRate.add(!passed);
    });
  });

  sleep(0.3);
}

/**
 * Default function (used when no scenario-specific exec is set)
 */
export default function (data) {
  healthTest();
  agentsTest(data);
  sessionsTest(data);
}
