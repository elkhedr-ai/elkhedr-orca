/**
 * Zod schema for skill plugin manifests
 */

const { z } = require('zod');

const permissionSchema = z.enum([
  'read',
  'write',
  'execute',
  'network',
  'filesystem'
]);

const skillManifestSchema = z.object({
  name: z.string()
    .min(1, 'Skill name is required')
    .max(50, 'Skill name too long')
    .regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/, 'Skill name must start with letter and contain only alphanumeric, underscore, hyphen'),
  
  version: z.string()
    .regex(/^\d+\.\d+\.\d+$/, 'Version must be semver (e.g., 1.0.0)'),
  
  description: z.string()
    .min(1, 'Description is required')
    .max(500, 'Description too long'),
  
  author: z.string().optional(),
  
  permissions: z.array(permissionSchema)
    .default([]),
  
  entryPoint: z.string()
    .default('index.js'),
  
  config: z.record(z.any())
    .default({}),
  
  dependencies: z.array(z.string())
    .default([]),
  
  enabled: z.boolean()
    .default(true),
  
  category: z.enum([
    'terminal',
    'web',
    'file',
    'data',
    'communication',
    'custom'
  ]).default('custom')
});

module.exports = {
  skillManifestSchema,
  permissionSchema
};
