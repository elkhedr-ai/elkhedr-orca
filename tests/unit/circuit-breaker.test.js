/**
 * Unit tests for Circuit Breaker
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { CircuitBreaker, createCircuitBreaker, STATES } = require('../../src/utils/circuit-breaker.js');

describe('Circuit Breaker', () => {
  let breaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      name: 'TestBreaker',
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 1000,
      resetTimeout: 100
    });
  });

  describe('Initial State', () => {
    it('should start in CLOSED state', () => {
      assert.strictEqual(breaker.state, STATES.CLOSED);
      assert.strictEqual(breaker.failureCount, 0);
      assert.strictEqual(breaker.successCount, 0);
    });

    it('should have correct configuration', () => {
      assert.strictEqual(breaker.failureThreshold, 3);
      assert.strictEqual(breaker.successThreshold, 2);
      assert.strictEqual(breaker.timeout, 1000);
      assert.strictEqual(breaker.resetTimeout, 100);
    });
  });

  describe('Successful Execution', () => {
    it('should execute function successfully', async () => {
      const result = await breaker.execute(async () => 'success');
      assert.strictEqual(result, 'success');
      assert.strictEqual(breaker.state, STATES.CLOSED);
      assert.strictEqual(breaker.failureCount, 0);
    });

    it('should reset failure count on success', async () => {
      // Simulate one failure
      try {
        await breaker.execute(async () => { throw new Error('fail'); });
      } catch (e) {}
      
      assert.strictEqual(breaker.failureCount, 1);
      
      // Success should reset count
      await breaker.execute(async () => 'success');
      assert.strictEqual(breaker.failureCount, 0);
    });
  });

  describe('Failure Handling', () => {
    it('should track failures', async () => {
      try {
        await breaker.execute(async () => { throw new Error('fail'); });
      } catch (e) {}
      
      assert.strictEqual(breaker.failureCount, 1);
      assert.strictEqual(breaker.state, STATES.CLOSED);
    });

    it('should open circuit after threshold failures', async () => {
      // Trigger 3 failures
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch (e) {}
      }
      
      assert.strictEqual(breaker.state, STATES.OPEN);
      assert.strictEqual(breaker.failureCount, 3);
    });

    it('should reject requests when circuit is OPEN', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch (e) {}
      }
      
      // Next request should be rejected immediately
      try {
        await breaker.execute(async () => 'success');
        assert.fail('Should have thrown error');
      } catch (e) {
        assert.ok(e.message.includes('Circuit breaker is OPEN'));
        assert.strictEqual(e.code, 'API_ERROR');
      }
    });
  });

  describe('Recovery (HALF_OPEN)', () => {
    it('should transition to HALF_OPEN after reset timeout', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch (e) {}
      }
      
      assert.strictEqual(breaker.state, STATES.OPEN);
      
      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Next request should transition to HALF_OPEN
      await breaker.execute(async () => 'success');
      assert.strictEqual(breaker.successCount, 1);
    });

    it('should close circuit after success threshold in HALF_OPEN', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch (e) {}
      }
      
      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Execute 2 successful requests (success threshold)
      await breaker.execute(async () => 'success1');
      await breaker.execute(async () => 'success2');
      
      assert.strictEqual(breaker.state, STATES.CLOSED);
      assert.strictEqual(breaker.failureCount, 0);
      assert.strictEqual(breaker.successCount, 0);
    });

    it('should reopen circuit if failure occurs in HALF_OPEN', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch (e) {}
      }
      
      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Fail during recovery
      try {
        await breaker.execute(async () => { throw new Error('fail again'); });
      } catch (e) {}
      
      assert.strictEqual(breaker.state, STATES.OPEN);
    });
  });

  describe('Status and Control', () => {
    it('should return correct status', () => {
      const status = breaker.getStatus();
      
      assert.strictEqual(status.name, 'TestBreaker');
      assert.strictEqual(status.state, STATES.CLOSED);
      assert.strictEqual(status.failureCount, 0);
      assert.strictEqual(status.isHealthy, true);
      assert.strictEqual(status.failureThreshold, 3);
      assert.strictEqual(status.successThreshold, 2);
    });

    it('should show unhealthy when circuit is OPEN', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch (e) {}
      }
      
      const status = breaker.getStatus();
      assert.strictEqual(status.isHealthy, false);
      assert.strictEqual(status.state, STATES.OPEN);
      assert.ok(status.nextAttempt);
    });

    it('should reset circuit manually', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await breaker.execute(async () => { throw new Error('fail'); });
        } catch (e) {}
      }
      
      assert.strictEqual(breaker.state, STATES.OPEN);
      
      breaker.reset();
      
      assert.strictEqual(breaker.state, STATES.CLOSED);
      assert.strictEqual(breaker.failureCount, 0);
      assert.strictEqual(breaker.successCount, 0);
    });

    it('should force circuit OPEN', () => {
      assert.strictEqual(breaker.state, STATES.CLOSED);
      
      breaker.forceOpen();
      
      assert.strictEqual(breaker.state, STATES.OPEN);
      assert.ok(breaker.nextAttempt > Date.now());
    });
  });

  describe('Factory Function', () => {
    it('should create circuit breaker with factory', () => {
      const cb = createCircuitBreaker('FactoryTest', {
        failureThreshold: 5
      });
      
      assert.ok(cb instanceof CircuitBreaker);
      assert.strictEqual(cb.name, 'FactoryTest');
      assert.strictEqual(cb.failureThreshold, 5);
    });
  });

  describe('Edge Cases', () => {
    it('should handle async errors correctly', async () => {
      try {
        await breaker.execute(async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          throw new Error('async fail');
        });
        assert.fail('Should have thrown');
      } catch (e) {
        assert.strictEqual(e.message, 'async fail');
        assert.strictEqual(breaker.failureCount, 1);
      }
    });

    it('should handle promise rejections', async () => {
      try {
        await breaker.execute(async () => Promise.reject(new Error('rejected')));
        assert.fail('Should have thrown');
      } catch (e) {
        assert.strictEqual(e.message, 'rejected');
        assert.strictEqual(breaker.failureCount, 1);
      }
    });

    it('should track last failure time', async () => {
      try {
        await breaker.execute(async () => { throw new Error('fail'); });
      } catch (e) {}
      
      assert.ok(breaker.lastFailureTime);
      assert.ok(breaker.lastFailureTime <= Date.now());
    });
  });
});

// Made with Bob
