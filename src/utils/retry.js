/**
 * Retry utility with exponential backoff and jitter
 */

const { APIError } = require('./errors');

/**
 * Execute a function with retry logic
 * @param {Function} fn - Function to execute
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retries (default: 3)
 * @param {number} options.baseDelay - Base delay in ms (default: 1000)
 * @param {number} options.maxDelay - Maximum delay in ms (default: 30000)
 * @param {Function} options.shouldRetry - Function to determine if error is retryable
 * @returns {Promise} - Result of the function
 */
async function withRetry(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    shouldRetry = (error) => {
      // Retry on network errors, timeouts, and 5xx status codes
      if (!error.response) return true;
      if (error.response.status >= 500) return true;
      if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') return true;
      return false;
    }
  } = options;

  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries || !shouldRetry(error)) {
        throw error;
      }

      // Calculate delay with exponential backoff and jitter
      const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      const jitter = Math.random() * 0.3 * exponentialDelay; // 30% jitter
      const delay = exponentialDelay + jitter;

      console.log(`⚠️  Attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms...`);
      await sleep(delay);
    }
  }

  throw lastError;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { withRetry, sleep };
