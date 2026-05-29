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
  // Use env var directly to avoid circular dependency with config module
  return process.env.ORCA_LOG_LEVEL || 'info';
}

// Check if running in TUI mode
function isTuiMode() {
  return process.env.ORCA_TUI_MODE === '1' ||
    (require.main && (require.main.filename.includes('tui.js') || require.main.filename.includes('index.js')));
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

const tuiMode = isTuiMode();

// Create stderr stream for TUI mode (only errors)
const stderrStream = tuiMode ? pino.destination(2) : null; // 2 = stderr

const logger = pino({
  level: getLogLevel(),
  mixin: tracingMixin,
  transport: {
    targets: [
      // Console: only show errors in TUI mode, or info+ in non-TUI mode
      {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname'
        },
        level: tuiMode ? 'error' : (getLogLevel() === 'debug' ? 'debug' : 'info')
      },
      // File: always log everything
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
