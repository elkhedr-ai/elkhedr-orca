/**
 * Node.js Load Test Benchmark (no k6 dependency)
 *
 * Quick benchmark for API endpoints using native Node.js HTTP.
 * For full load testing, use k6-script.js instead.
 *
 * Usage:
 *   node tests/load/benchmark.js
 *   BASE_URL=http://localhost:3000 node tests/load/benchmark.js
 *   API_KEY=orca_live_xxx node tests/load/benchmark.js
 *   CONCURRENCY=200 REQUESTS=2000 node tests/load/benchmark.js
 */

const http = require('http');
const https = require('https');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const API_KEY = process.env.API_KEY || '';
const CONCURRENCY = parseInt(process.env.CONCURRENCY, 10) || 100;
const TOTAL_REQUESTS = parseInt(process.env.REQUESTS, 10) || 1000;

// Endpoints to benchmark
const ENDPOINTS = [
  { name: 'GET /health', method: 'GET', path: '/health', auth: false },
  { name: 'GET /ready', method: 'GET', path: '/ready', auth: false },
  { name: 'GET /api/v1/agents', method: 'GET', path: '/api/v1/agents?limit=50', auth: true },
  { name: 'GET /api/v1/agents/1', method: 'GET', path: '/api/v1/agents/1', auth: true },
  { name: 'GET /api/v1/sessions', method: 'GET', path: '/api/v1/sessions?limit=50', auth: true },
];

function makeRequest(endpoint) {
  return new Promise((resolve) => {
    const url = new URL(endpoint.path, BASE_URL);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const headers = { 'Content-Type': 'application/json' };
    if (endpoint.auth && API_KEY) {
      headers['X-API-Key'] = API_KEY;
    }

    const start = process.hrtime.bigint();
    const req = client.request(url, { method: endpoint.method, headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        const duration = Number(process.hrtime.bigint() - start) / 1e6; // ms
        resolve({
          status: res.statusCode,
          duration,
          size: body.length,
          error: res.statusCode >= 400 ? `HTTP ${res.statusCode}` : null,
        });
      });
    });

    req.on('error', (err) => {
      const duration = Number(process.hrtime.bigint() - start) / 1e6;
      resolve({ status: 0, duration, size: 0, error: err.message });
    });

    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ status: 0, duration: 10000, size: 0, error: 'timeout' });
    });

    req.end();
  });
}

async function runConcurrent(endpoint, count, concurrency) {
  const results = [];
  const latencies = [];
  let errors = 0;
  let completed = 0;

  const worker = async () => {
    while (completed < count) {
      const idx = completed++;
      if (idx >= count) break;
      const result = await makeRequest(endpoint);
      results.push(result);
      latencies.push(result.duration);
      if (result.error) errors++;
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, count) }, () => worker());
  await Promise.all(workers);

  latencies.sort((a, b) => a - b);
  const sum = latencies.reduce((a, b) => a + b, 0);

  return {
    endpoint: endpoint.name,
    total: count,
    errors,
    errorRate: ((errors / count) * 100).toFixed(2) + '%',
    latency: {
      min: latencies[0]?.toFixed(2) || 0,
      max: latencies[latencies.length - 1]?.toFixed(2) || 0,
      avg: (sum / latencies.length).toFixed(2) || 0,
      p50: latencies[Math.floor(count * 0.5)]?.toFixed(2) || 0,
      p90: latencies[Math.floor(count * 0.9)]?.toFixed(2) || 0,
      p95: latencies[Math.floor(count * 0.95)]?.toFixed(2) || 0,
      p99: latencies[Math.floor(count * 0.99)]?.toFixed(2) || 0,
    },
    throughput: (count / (sum / 1000 / 1000)).toFixed(0) + ' req/s',
  };
}

async function main() {
  console.log('='.repeat(70));
  console.log('Orca API Load Test Benchmark');
  console.log('='.repeat(70));
  console.log(`Target:      ${BASE_URL}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Requests:    ${TOTAL_REQUESTS} per endpoint`);
  console.log(`Auth:        ${API_KEY ? 'API Key' : 'None (unauthenticated only)'}`);
  console.log('='.repeat(70));
  console.log('');

  // Check server
  try {
    await makeRequest({ method: 'GET', path: '/health', auth: false });
  } catch {
    console.error(`Error: Cannot reach ${BASE_URL}. Is the server running?`);
    process.exit(1);
  }

  const summary = [];

  for (const endpoint of ENDPOINTS) {
    if (endpoint.auth && !API_KEY) {
      console.log(`Skipping ${endpoint.name} (no API key)`);
      continue;
    }

    process.stdout.write(`Testing ${endpoint.name}... `);
    const result = await runConcurrent(endpoint, TOTAL_REQUESTS, CONCURRENCY);
    summary.push(result);

    const p95 = parseFloat(result.latency.p95);
    const status = p95 < 500 ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    console.log(`P95: ${result.latency.p95}ms [${status}]`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('Results Summary');
  console.log('='.repeat(70));

  for (const r of summary) {
    const p95 = parseFloat(r.latency.p95);
    const status = p95 < 500 ? 'PASS' : 'FAIL';
    console.log(`\n${r.endpoint} [${status}]`);
    console.log(`  Requests:  ${r.total} (${r.errors} errors, ${r.errorRate})`);
    console.log(`  Latency:   avg=${r.latency.avg}ms  p50=${r.latency.p50}ms  p95=${r.latency.p95}ms  p99=${r.latency.p99}ms`);
    console.log(`  Range:     min=${r.latency.min}ms  max=${r.latency.max}ms`);
  }

  // Check thresholds
  console.log('\n' + '='.repeat(70));
  console.log('Threshold Check (P95 < 500ms)');
  console.log('='.repeat(70));

  let allPassed = true;
  for (const r of summary) {
    const p95 = parseFloat(r.latency.p95);
    const status = p95 < 500 ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
    console.log(`  ${r.endpoint}: ${r.latency.p95}ms [${status}]`);
    if (p95 >= 500) allPassed = false;
  }

  console.log('');
  if (allPassed) {
    console.log('\x1b[32mAll thresholds passed!\x1b[0m');
  } else {
    console.log('\x1b[31mSome thresholds failed.\x1b[0m');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
