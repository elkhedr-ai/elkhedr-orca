/**
 * Zod schemas for input validation
 */

const { z } = require('zod');

// User prompt validation
const promptSchema = z.string()
  .min(1, 'Prompt cannot be empty')
  .max(10000, 'Prompt too long (max 10000 characters)')
  .refine(val => !val.includes('<?php'), { 
    message: 'Potential injection attempt detected' 
  })
  .refine(val => !val.includes('<script'), { 
    message: 'Potential injection attempt detected' 
  });

// Agent configuration validation
const agentSchema = z.object({
  id: z.number().int().positive(),
  role: z.string().min(1).max(100),
  model: z.string().min(1),
  department: z.enum(['Engineering', 'Creative', 'Marketing', 'Sales', 'Operations']),
  fallbackModel: z.string().min(1)
});

// Orchestrator configuration
const orchestratorSchema = z.object({
  role: z.string(),
  model: z.string(),
  description: z.string(),
  prompt: z.string(),
  fallbackModel: z.string()
});

// Session configuration
const sessionSchema = z.object({
  level: z.enum(['Auto', 'Instant', 'Thinking', 'Swarm', 'Full']),
  sandbox: z.boolean(),
  currentAgent: z.number().int().positive().nullable().optional()
});

// Tool parameter schemas
const executeTerminalSchema = z.object({
  command: z.string()
    .min(1)
    .max(2000)
    .refine(cmd => !cmd.includes('rm -rf /'), {
      message: 'Dangerous command blocked'
    })
    .refine(cmd => !cmd.includes('> /dev/null'), {
      message: 'Suspicious redirection blocked'
    })
});

const webSearchSchema = z.object({
  query: z.string().min(1).max(500)
});

const fetchUrlSchema = z.object({
  url: z.string().url('Invalid URL format')
});

// Config file schema
const configFileSchema = z.object({
  openRouterApiKey: z.string().optional(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).optional(),
  defaultLevel: z.enum(['Auto', 'Instant', 'Thinking', 'Swarm', 'Full']).optional(),
  sandbox: z.boolean().optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  models: z.record(z.string()).optional()
});

// Image analysis schema
const imageAnalysisSchema = z.object({
  image_path: z.string().optional(),
  image_url: z.string().url().optional(),
  prompt: z.string().min(1).max(2000)
}).refine(data => data.image_path || data.image_url, {
  message: 'Either image_path or image_url is required'
});

// Audio transcription schema
const audioTranscribeSchema = z.object({
  audio_path: z.string().optional(),
  audio_url: z.string().url().optional(),
  language: z.string().max(10).optional()
}).refine(data => data.audio_path || data.audio_url, {
  message: 'Either audio_path or audio_url is required'
});

module.exports = {
  promptSchema,
  agentSchema,
  orchestratorSchema,
  sessionSchema,
  executeTerminalSchema,
  webSearchSchema,
  fetchUrlSchema,
  configFileSchema,
  imageAnalysisSchema,
  audioTranscribeSchema
};
