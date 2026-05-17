/**
 * Centralized error handling for Orca
 * Provides custom error classes for different failure modes
 */

class OrcaError extends Error {
  constructor(message, code, statusCode = 500, details = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.timestamp = new Date().toISOString();
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      statusCode: this.statusCode,
      details: this.details,
      timestamp: this.timestamp,
      stack: process.env.NODE_ENV === 'development' ? this.stack : undefined
    };
  }
}

class APIError extends OrcaError {
  constructor(message, details = {}) {
    super(message, 'API_ERROR', 502, details);
  }
}

class ValidationError extends OrcaError {
  constructor(message, details = {}) {
    super(message, 'VALIDATION_ERROR', 400, details);
  }
}

class AuthenticationError extends OrcaError {
  constructor(message, details = {}) {
    super(message, 'AUTH_ERROR', 401, details);
  }
}

class ConfigError extends OrcaError {
  constructor(message, details = {}) {
    super(message, 'CONFIG_ERROR', 500, details);
  }
}

class ToolExecutionError extends OrcaError {
  constructor(message, details = {}) {
    super(message, 'TOOL_ERROR', 500, details);
  }
}

class AgentError extends OrcaError {
  constructor(message, details = {}) {
    super(message, 'AGENT_ERROR', 500, details);
  }
}

module.exports = {
  OrcaError,
  APIError,
  ValidationError,
  AuthenticationError,
  ConfigError,
  ToolExecutionError,
  AgentError
};
