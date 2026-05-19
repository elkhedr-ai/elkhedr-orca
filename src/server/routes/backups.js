/**
 * Backup Routes
 * Database backup creation, listing, and management REST API.
 */

const { getBackupManager } = require('../../db/backup.js');

async function backupRoutes(fastify, options) {
  // Get backup status and stats
  fastify.get('/backups/status', {
    preHandler: [fastify.requireAuth, fastify.requireScope('admin')],
    schema: {
      description: 'Get backup system status',
      tags: ['Backups'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    const manager = getBackupManager();
    return { status: manager.getStatus() };
  });

  // List all available backups
  fastify.get('/backups', {
    preHandler: [fastify.requireAuth, fastify.requireScope('admin')],
    schema: {
      description: 'List available database backups',
      tags: ['Backups'],
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
        }
      }
    }
  }, async (request) => {
    const manager = getBackupManager();
    const backups = manager.listBackups();
    const limit = request.query.limit || 20;
    return {
      backups: backups.slice(0, limit),
      total: backups.length,
      backupDir: manager.backupDir
    };
  });

  // Create a new backup on demand
  fastify.post('/backups', {
    preHandler: [fastify.requireAuth, fastify.requireScope('admin')],
    schema: {
      description: 'Create a new database backup',
      tags: ['Backups'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['sqlite', 'postgresql'] }
        }
      }
    }
  }, async (request, reply) => {
    const manager = getBackupManager();
    try {
      const result = await manager.createBackup({
        type: request.body?.type
      });
      reply.code(201);
      return {
        backup: result,
        message: 'Backup created successfully'
      };
    } catch (error) {
      reply.code(500);
      return {
        error: 'BackupFailed',
        message: error.message
      };
    }
  });

  // Get backup details by filename
  fastify.get('/backups/:filename', {
    preHandler: [fastify.requireAuth, fastify.requireScope('admin')],
    schema: {
      description: 'Get backup details',
      tags: ['Backups'],
      security: [{ bearerAuth: [] }],
      params: {
        type: 'object',
        properties: { filename: { type: 'string' } },
        required: ['filename']
      }
    }
  }, async (request, reply) => {
    const manager = getBackupManager();
    const backups = manager.listBackups();
    const backup = backups.find(b => b.name === request.params.filename);
    if (!backup) {
      reply.code(404).send({ error: 'NotFound', message: 'Backup not found' });
      return;
    }
    return { backup };
  });

  // Trigger backup rotation
  fastify.post('/backups/rotate', {
    preHandler: [fastify.requireAuth, fastify.requireScope('admin')],
    schema: {
      description: 'Manually trigger backup rotation (remove expired backups)',
      tags: ['Backups'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    const manager = getBackupManager();
    const before = manager.listBackups().length;
    manager.rotateBackups();
    const after = manager.listBackups().length;
    return {
      removed: before - after,
      remaining: after,
      retentionDays: manager.retentionDays
    };
  });

  // Start/stop backup scheduler
  fastify.post('/backups/scheduler', {
    preHandler: [fastify.requireAuth, fastify.requireScope('admin')],
    schema: {
      description: 'Start or stop the backup scheduler',
      tags: ['Backups'],
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['start', 'stop'] },
          intervalHours: { type: 'integer', minimum: 1, maximum: 168, default: 24 }
        }
      }
    }
  }, async (request, reply) => {
    const manager = getBackupManager();
    if (request.body.action === 'start') {
      const intervalMs = (request.body.intervalHours || 24) * 60 * 60 * 1000;
      manager.startScheduler(intervalMs);
      return { scheduler: 'started', intervalHours: request.body.intervalHours || 24 };
    } else {
      manager.stopScheduler();
      return { scheduler: 'stopped' };
    }
  });
}

module.exports = backupRoutes;
