/**
 * Zod schema for environment variable validation
 */

const { z } = require('zod');

const envSchema = z.object({
  // Required
  OPENROUTER_API_KEY: z.string()
    .min(1, 'OPENROUTER_API_KEY is required')
    .startsWith('sk-', 'OPENROUTER_API_KEY should start with "sk-"'),

  // Optional with defaults
  ORCA_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  
  // Database configuration
  ORCA_DB_TYPE: z.enum(['sqlite', 'postgresql', 'postgres', 'pg']).default('sqlite'),
  ORCA_DB_URL: z.string().optional(),
  ORCA_DB_PATH: z.string().optional(),
  ORCA_DB_HOST: z.string().optional(),
  ORCA_DB_PORT: z.string().optional(),
  ORCA_DB_NAME: z.string().optional(),
  ORCA_DB_USER: z.string().optional(),
  ORCA_DB_PASSWORD: z.string().optional(),
  ORCA_DB_SSL: z.string().optional(),
  ORCA_DB_POOL_MIN: z.string().default('2'),
  ORCA_DB_POOL_MAX: z.string().default('10'),
  ORCA_DB_POOL_IDLE_TIMEOUT: z.string().default('30000'),
  ORCA_DB_POOL_ACQUIRE_TIMEOUT: z.string().default('60000'),
  ORCA_DB_DEBUG: z.string().optional(),
  ORCA_DB_READONLY: z.string().optional(),
  ORCA_DB_FILE_MUST_EXIST: z.string().optional(),
  
  ORCA_REDIS_URL: z.string().optional(),
  ORCA_PORT: z.string().default('3000'),
  ORCA_HOST: z.string().default('0.0.0.0'),
  ORCA_JWT_SECRET: z.string().min(32).optional(),
  ORCA_SANDBOX: z.string().default('true'),
  ORCA_MAX_RETRIES: z.string().default('3'),
  ORCA_TIMEOUT: z.string().default('60000'),

  // OpenRouter settings
  ORCA_OPENROUTER_BASE_URL: z.string().default('https://openrouter.ai/api/v1'),

  // Model registry and routing
  ORCA_MODEL_HEALTH_INTERVAL_MS: z.string().default('60000'),
  ORCA_MODEL_ROUTING_STRATEGY: z.enum(['balanced', 'cost', 'quality', 'latency']).default('balanced'),
  ORCA_MODEL_MAX_FALLBACKS: z.string().default('3'),
  ORCA_MODEL_LATENCY_BUDGET_MS: z.string().default('30000'),
  ORCA_MODEL_FAILURE_THRESHOLD: z.string().default('1'),

  // RAG / vector search
  ORCA_RAG_ENABLED: z.string().default('true'),
  ORCA_EMBEDDING_MODEL: z.string().default('local-hashing-v1'),
  ORCA_VECTOR_DIMENSIONS: z.string().default('256'),
  ORCA_RAG_LIMIT: z.string().default('3'),
  ORCA_RAG_THRESHOLD: z.string().default('0.15'),
  ORCA_RAG_MIN_CONFIDENCE: z.string().default('0.2'),
  ORCA_RAG_AGENT_SCOPED: z.string().default('false'),

  // Analytics
  ORCA_ANALYTICS_ENABLED: z.string().default('true'),
  ORCA_ANALYTICS_RETENTION_DAYS: z.string().default('30'),

  // Features
  ORCA_MCP_ENABLED: z.string().default('true'),
  ORCA_SWARM_ENABLED: z.string().default('true'),

  // OAuth (optional)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),

  // Encryption (required for production, auto-generated in dev)
  ORCA_MASTER_KEY: z.string().min(32).optional(),
  ORCA_KEY_ROTATION_ENABLED: z.string().default('false'),
  ORCA_KEY_ROTATION_INTERVAL_DAYS: z.string().default('90'),

  // TLS (optional, for HTTPS)
  ORCA_TLS_CERT_PATH: z.string().optional(),
  ORCA_TLS_KEY_PATH: z.string().optional(),
  ORCA_TLS_ENABLED: z.string().default('false'),

  // Sandbox
  ORCA_SANDBOX_TYPE: z.enum(['none', 'filesystem', 'docker', 'chroot']).default('none'),
  ORCA_SANDBOX_WORKSPACE: z.string().optional(),
  ORCA_DOCKER_IMAGE: z.string().default('node:20-alpine'),
  ORCA_SANDBOX_NETWORK_ENABLED: z.string().default('false'),
  ORCA_SANDBOX_CPU_LIMIT: z.string().default('1.0'),
  ORCA_SANDBOX_MEMORY_LIMIT: z.string().default('512m'),
});

module.exports = { envSchema };
