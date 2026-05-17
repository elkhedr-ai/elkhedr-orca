/**
 * Request Tracing & Correlation ID System
 * 
 * Uses Node.js AsyncLocalStorage to propagate trace context
 * across async operations without explicit passing.
 */

const { AsyncLocalStorage } = require('async_hooks');
const { randomBytes } = require('crypto');

const asyncLocalStorage = new AsyncLocalStorage();

/**
 * Generate a unique trace ID
 * Format: trace_<timestamp>_<randomhex>
 */
function generateTraceId() {
  const timestamp = Date.now();
  const random = randomBytes(4).toString('hex');
  return `trace_${timestamp}_${random}`;
}

/**
 * Generate a short span ID for sub-operations
 */
function generateSpanId() {
  return randomBytes(4).toString('hex');
}

/**
 * Get current trace context from AsyncLocalStorage
 */
function getTraceContext() {
  return asyncLocalStorage.getStore() || null;
}

/**
 * Get current trace ID
 */
function getTraceId() {
  const store = asyncLocalStorage.getStore();
  return store?.traceId || null;
}

/**
 * Run a function within a trace context
 * @param {Function} fn - Function to execute
 * @param {Object} options - Trace options
 * @param {string} options.traceId - Optional explicit trace ID
 * @param {string} options.parentTraceId - Parent trace ID for nesting
 * @param {string} options.operation - Operation name
 * @returns {Promise} - Result of fn
 */
async function withTrace(fn, options = {}) {
  const traceId = options.traceId || generateTraceId();
  const parentTraceId = options.parentTraceId || getTraceId();
  
  const store = {
    traceId,
    parentTraceId,
    spanId: generateSpanId(),
    operation: options.operation || 'unknown',
    startTime: Date.now(),
    metadata: options.metadata || {}
  };

  return asyncLocalStorage.run(store, async () => {
    try {
      return await fn(traceId);
    } finally {
      // Could add duration tracking here
    }
  });
}

/**
 * Create a child trace for nested operations
 * @param {Function} fn - Function to execute
 * @param {Object} options - Trace options
 */
async function withChildTrace(fn, options = {}) {
  const parentStore = asyncLocalStorage.getStore();
  const parentTraceId = parentStore?.traceId;
  
  return withTrace(fn, {
    ...options,
    parentTraceId,
    operation: options.operation || 'child-operation'
  });
}

/**
 * Add metadata to current trace context
 */
function addTraceMetadata(key, value) {
  const store = asyncLocalStorage.getStore();
  if (store) {
    store.metadata[key] = value;
  }
}

/**
 * Get full trace chain as array
 */
function getTraceChain() {
  const store = asyncLocalStorage.getStore();
  if (!store) return [];
  
  const chain = [store.traceId];
  let current = store;
  while (current.parentTraceId) {
    chain.unshift(current.parentTraceId);
    // Note: In a real system we'd look up parent in a store
    // For now we just track the immediate parent
    break;
  }
  return chain;
}

/**
 * Express/Fastify middleware to extract trace from headers
 */
function traceMiddleware(req, res, next) {
  const traceId = req.headers['x-trace-id'] || generateTraceId();
  const parentTraceId = req.headers['x-parent-trace-id'] || null;
  
  withTrace(async () => {
    req.traceId = traceId;
    next();
  }, { traceId, parentTraceId, operation: `http:${req.method}:${req.path}` });
}

/**
 * Format trace info for logging
 */
function formatTraceForLog() {
  const store = asyncLocalStorage.getStore();
  if (!store) return {};
  
  return {
    traceId: store.traceId,
    spanId: store.spanId,
    parentTraceId: store.parentTraceId,
    operation: store.operation
  };
}

module.exports = {
  generateTraceId,
  generateSpanId,
  getTraceContext,
  getTraceId,
  withTrace,
  withChildTrace,
  addTraceMetadata,
  getTraceChain,
  traceMiddleware,
  formatTraceForLog,
  asyncLocalStorage
};
