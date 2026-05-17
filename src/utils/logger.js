/**
 * Structured logging with Pino
 * Auto-includes trace context from AsyncLocalStorage
 */

const pino = require('pino');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

function getLogLevel() {
  try {
    const { getConfig } = require('../config/index.js');
    return getConfig().ORCA_LOG_LEVEL;
  } catch {
    return process.env.ORCA_LOG_LEVEL || 'info';
  }
}

// Mixin to auto-include trace context in every log entry
function tracingMixin() {
  try {
    const { getTraceContext } = require('./tracing.js');
    const context = getTraceContext();
    if (context) {
      return {
        traceId: context.traceId,
        spanId: context.spanId,
        parentTraceId: context.parentTraceId,
        operation: context.operation
      };
    }
  } catch {
    // Tracing not available yet
  }
  return {};
}

const logger = pino({
  level: getLogLevel(),
  mixin: tracingMixin,
  transport: {
    targets: [
      {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname'
        },
        level: getLogLevel() === 'debug' ? 'debug' : 'info'
      },
      {
        target: 'pino/file',
        options: {
          destination: path.join(logsDir, 'orca.log'),
          mkdir: true
        },
        level: 'info'
      },
      {
        target: 'pino/file',
        options: {
          destination: path.join(logsDir, 'error.log'),
          mkdir: true
        },
        level: 'error'
      }
    ]
  }
});

/**
 * Create a child logger with context
 */
function createChildLogger(bindings) {
  return logger.child(bindings);
}

module.exports = {
  logger,
  createChildLogger
};
