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
  ORCA_DB_URL: z.string().optional(),
  ORCA_REDIS_URL: z.string().optional(),
  ORCA_PORT: z.string().default('3000'),
  ORCA_HOST: z.string().default('0.0.0.0'),
  ORCA_JWT_SECRET: z.string().min(32).optional(),
  ORCA_SANDBOX: z.string().default('true'),
  ORCA_MAX_RETRIES: z.string().default('3'),
  ORCA_TIMEOUT: z.string().default('60000'),

  // OpenRouter settings
  ORCA_OPENROUTER_BASE_URL: z.string().default('https://openrouter.ai/api/v1'),

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
});

module.exports = { envSchema };
