/**
 * Unit tests for error handling utilities
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  OrcaError,
  APIError,
  ValidationError,
  ConfigError,
  AgentError
} = require('../../src/utils/errors.js');

describe('Error Classes', () => {
  it('should create OrcaError with correct properties', () => {
    const error = new OrcaError('Test error', 'TEST_ERROR', 400, { detail: 'test' });
    assert.strictEqual(error.message, 'Test error');
    assert.strictEqual(error.code, 'TEST_ERROR');
    assert.strictEqual(error.statusCode, 400);
    assert.deepStrictEqual(error.details, { detail: 'test' });
    assert.ok(error.timestamp);
    assert.ok(error.stack);
  });

  it('should create APIError with default status code', () => {
    const error = new APIError('API failed');
    assert.strictEqual(error.code, 'API_ERROR');
    assert.strictEqual(error.statusCode, 502);
  });

  it('should create ValidationError with default status code', () => {
    const error = new ValidationError('Invalid input');
    assert.strictEqual(error.code, 'VALIDATION_ERROR');
    assert.strictEqual(error.statusCode, 400);
  });

  it('should serialize to JSON correctly', () => {
    const error = new OrcaError('Test', 'TEST', 500, { key: 'value' });
    const json = error.toJSON();
    assert.strictEqual(json.error, 'Test');
    assert.strictEqual(json.code, 'TEST');
    assert.strictEqual(json.statusCode, 500);
    assert.deepStrictEqual(json.details, { key: 'value' });
  });
});

describe('Retry Utility', () => {
  const { withRetry, sleep } = require('../../src/utils/retry.js');

  it('should execute function successfully', async () => {
    const result = await withRetry(async () => 'success');
    assert.strictEqual(result, 'success');
  });

  it('should retry on failure', async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('Temporary failure');
      }
      return 'success';
    }, { maxRetries: 3, baseDelay: 10 });
    assert.strictEqual(result, 'success');
    assert.strictEqual(attempts, 3);
  });

  it('should sleep for specified duration', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 40 && elapsed <= 100, `Elapsed: ${elapsed}ms`);
  });
});
