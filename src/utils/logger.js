/**
 * Structured logging with Pino
 */

const pino = require('pino');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const logger = pino({
  level: process.env.ORCA_LOG_LEVEL || 'info',
  transport: {
    targets: [
      {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname'
        },
        level: process.env.NODE_ENV === 'development' ? 'debug' : 'info'
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
