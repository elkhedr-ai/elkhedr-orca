/**
 * Webhook Delivery Engine
 * Handles HTTP delivery with HMAC signing, retry with exponential backoff, and idempotency.
 */

const crypto = require('crypto');
const { logger } = require('../utils/logger.js');

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_DELAY_MS = 1000;
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Generate HMAC-SHA256 signature for webhook payload
 * @param {string} payload - JSON stringified payload
 * @param {string} secret - Webhook signing secret
 * @returns {string} Signature in format "sha256=<hex>"
 */
function signPayload(payload, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload, 'utf8');
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Verify HMAC-SHA256 signature
 * @param {string} payload - JSON stringified payload
 * @param {string} secret - Webhook signing secret
 * @param {string} signature - Signature to verify
 * @returns {boolean} Whether signature is valid
 */
function verifySignature(payload, secret, signature) {
  const expected = signPayload(payload, secret);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const signatureBuf = Buffer.from(signature, 'utf8');

  // timingSafeEqual requires same-length buffers
  if (expectedBuf.length !== signatureBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

/**
 * Deliver a webhook with retry logic
 * @param {Object} options
 * @param {string} options.url - Target URL
 * @param {Object} options.payload - Event payload
 * @param {string} options.secret - HMAC signing secret
 * @param {Object} options.headers - Additional headers
 * @param {number} options.maxRetries - Max retry attempts
 * @param {number} options.timeoutMs - Request timeout
 * @returns {Object} Delivery result
 */
async function deliverWebhook(options) {
  const {
    url,
    payload,
    secret,
    headers = {},
    maxRettries = DEFAULT_MAX_RETRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = options;

  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const body = JSON.stringify(payload);
  const signature = signPayload(body, secret);
  const deliveryId = payload.deliveryId || crypto.randomUUID();

  const requestHeaders = {
    'Content-Type': 'application/json',
    'User-Agent': 'Orca-Webhooks/1.0',
    'X-Orca-Delivery-Id': deliveryId,
    'X-Orca-Signature-256': signature,
    'X-Orca-Event': payload.event || 'unknown',
    'X-Orca-Timestamp': String(payload.timestamp || Date.now()),
    ...headers
  };

  let lastError = null;
  let delay = DEFAULT_INITIAL_DELAY_MS;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const startTime = Date.now();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        method: 'POST',
        headers: requestHeaders,
        body,
        signal: controller.signal
      });

      clearTimeout(timeout);
      const latencyMs = Date.now() - startTime;

      const result = {
        deliveryId,
        url,
        attempt: attempt + 1,
        statusCode: response.status,
        latencyMs,
        success: response.status >= 200 && response.status < 300,
        timestamp: Date.now()
      };

      if (result.success) {
        logger.info({ deliveryId, url, statusCode: response.status, attempt: attempt + 1 }, 'Webhook delivered');
        return result;
      }

      // Non-retryable client errors (4xx except 429)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        result.error = `HTTP ${response.status}: Non-retryable client error`;
        logger.warn({ deliveryId, url, statusCode: response.status }, 'Webhook delivery failed (non-retryable)');
        return result;
      }

      lastError = `HTTP ${response.status}`;
      result.error = lastError;
      result.retryable = true;

      // Respect Retry-After header
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter) {
        const retryAfterMs = parseInt(retryAfter, 10) * 1000;
        if (!isNaN(retryAfterMs)) {
          delay = Math.max(delay, retryAfterMs);
        }
      }

    } catch (error) {
      const latencyMs = Date.now() - startTime;
      lastError = error.name === 'AbortError' ? 'Timeout' : error.message;

      if (attempt >= maxRetries) {
        logger.error({ deliveryId, url, error: lastError, attempt: attempt + 1 }, 'Webhook delivery failed after retries');
        return {
          deliveryId,
          url,
          attempt: attempt + 1,
          statusCode: 0,
          latencyMs,
          success: false,
          error: lastError,
          timestamp: Date.now()
        };
      }
    }

    // Wait before retry (exponential backoff)
    if (attempt < maxRetries) {
      logger.debug({ deliveryId, attempt: attempt + 1, delayMs: delay }, 'Webhook retry scheduled');
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 30000); // Cap at 30s
    }
  }

  return {
    deliveryId,
    url,
    attempt: maxRetries + 1,
    statusCode: 0,
    success: false,
    error: lastError || 'Max retries exceeded',
    timestamp: Date.now()
  };
}

module.exports = {
  signPayload,
  verifySignature,
  deliverWebhook,
  DEFAULT_MAX_RETRIES,
  DEFAULT_INITIAL_DELAY_MS,
  DEFAULT_TIMEOUT_MS
};
