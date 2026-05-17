/**
 * Circuit Breaker Pattern Implementation
 * Prevents cascading failures by stopping requests to failing services
 * 
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is failing, requests are blocked
 * - HALF_OPEN: Testing if service has recovered
 */

const { APIError } = require('./errors');
const { logger } = require('./logger');

const STATES = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN'
};

class CircuitBreaker {
  constructor(options = {}) {
    this.name = options.name || 'CircuitBreaker';
    this.failureThreshold = options.failureThreshold || 5;
    this.successThreshold = options.successThreshold || 2;
    this.timeout = options.timeout || 60000; // 60 seconds
    this.resetTimeout = options.resetTimeout || 30000; // 30 seconds
    
    this.state = STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = Date.now();
    this.lastFailureTime = null;
    
    this.log = logger.child({ component: 'CircuitBreaker', name: this.name });
  }

  /**
   * Execute a function with circuit breaker protection
   * @param {Function} fn - Async function to execute
   * @returns {Promise} - Result of the function
   */
  async execute(fn) {
    if (this.state === STATES.OPEN) {
      if (Date.now() < this.nextAttempt) {
        const waitTime = Math.ceil((this.nextAttempt - Date.now()) / 1000);
        this.log.warn({
          state: this.state,
          waitTime,
          failureCount: this.failureCount
        }, `Circuit breaker is OPEN. Retry in ${waitTime}s`);
        
        throw new APIError(
          `Circuit breaker is OPEN for ${this.name}. Service temporarily unavailable.`,
          { 
            circuitBreaker: this.name,
            state: this.state,
            retryAfter: waitTime
          }
        );
      }
      
      // Transition to HALF_OPEN to test recovery
      this.state = STATES.HALF_OPEN;
      this.log.info({ state: this.state }, 'Circuit breaker transitioning to HALF_OPEN');
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Handle successful execution
   */
  onSuccess() {
    this.failureCount = 0;
    this.lastFailureTime = null;

    if (this.state === STATES.HALF_OPEN) {
      this.successCount++;
      
      if (this.successCount >= this.successThreshold) {
        this.state = STATES.CLOSED;
        this.successCount = 0;
        this.log.info({ state: this.state }, 'Circuit breaker CLOSED - service recovered');
      }
    }
  }

  /**
   * Handle failed execution
   */
  onFailure(error) {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    this.log.warn({
      state: this.state,
      failureCount: this.failureCount,
      threshold: this.failureThreshold,
      error: error.message
    }, 'Circuit breaker recorded failure');

    if (this.state === STATES.HALF_OPEN) {
      // Failed during recovery test, go back to OPEN
      this.state = STATES.OPEN;
      this.successCount = 0;
      this.nextAttempt = Date.now() + this.resetTimeout;
      
      this.log.error({
        state: this.state,
        nextAttempt: new Date(this.nextAttempt).toISOString()
      }, 'Circuit breaker OPEN - recovery test failed');
    } else if (this.failureCount >= this.failureThreshold) {
      // Threshold exceeded, open the circuit
      this.state = STATES.OPEN;
      this.nextAttempt = Date.now() + this.resetTimeout;
      
      this.log.error({
        state: this.state,
        failureCount: this.failureCount,
        nextAttempt: new Date(this.nextAttempt).toISOString()
      }, 'Circuit breaker OPEN - failure threshold exceeded');
    }
  }

  /**
   * Get current circuit breaker status
   */
  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      failureThreshold: this.failureThreshold,
      successThreshold: this.successThreshold,
      lastFailureTime: this.lastFailureTime,
      nextAttempt: this.state === STATES.OPEN ? this.nextAttempt : null,
      isHealthy: this.state === STATES.CLOSED
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset() {
    this.state = STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = Date.now();
    this.lastFailureTime = null;
    
    this.log.info({ state: this.state }, 'Circuit breaker manually reset');
  }

  /**
   * Force the circuit breaker to OPEN state
   */
  forceOpen() {
    this.state = STATES.OPEN;
    this.nextAttempt = Date.now() + this.resetTimeout;
    
    this.log.warn({ state: this.state }, 'Circuit breaker manually forced OPEN');
  }
}

/**
 * Create a circuit breaker instance
 */
function createCircuitBreaker(name, options = {}) {
  return new CircuitBreaker({ name, ...options });
}

module.exports = {
  CircuitBreaker,
  createCircuitBreaker,
  STATES
};

// Made with Bob
