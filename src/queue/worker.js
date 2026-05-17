/**
 * Queue Worker
 * 
 * Standalone worker that can process jobs from a TaskQueue.
 * Supports graceful shutdown and health checks.
 */

const { logger } = require('../utils/logger.js');
const { TaskQueue } = require('./index.js');

class QueueWorker {
  constructor(queue, options = {}) {
    this.queue = queue;
    this.running = false;
    this.processInterval = options.processInterval || 100;
    this.healthCheckInterval = options.healthCheckInterval || 30000;
    
    this._processTimer = null;
    this._healthTimer = null;
    this._shutdownPromise = null;
    
    this.stats = {
      jobsProcessed: 0,
      startedAt: null,
      lastActivity: null
    };
  }

  /**
   * Start the worker
   */
  start() {
    if (this.running) {
      logger.warn('Worker already running');
      return;
    }
    
    this.running = true;
    this.stats.startedAt = Date.now();
    
    // Listen for queue events
    this.queue.on('job:completed', (job) => {
      this.stats.jobsProcessed++;
      this.stats.lastActivity = Date.now();
    });
    
    this.queue.on('job:dead', (job) => {
      this.stats.lastActivity = Date.now();
    });
    
    // Start processing loop
    this._processLoop();
    
    // Start health checks
    if (this.healthCheckInterval > 0) {
      this._healthTimer = setInterval(() => {
        this._healthCheck();
      }, this.healthCheckInterval);
    }
    
    logger.info({ queue: this.queue.name }, 'Queue worker started');
  }

  /**
   * Stop the worker gracefully
   */
  async stop(timeout = 5000) {
    if (!this.running) return;
    
    logger.info({ queue: this.queue.name }, 'Stopping worker...');
    this.running = false;
    
    // Clear timers
    if (this._processTimer) {
      clearTimeout(this._processTimer);
      this._processTimer = null;
    }
    
    if (this._healthTimer) {
      clearInterval(this._healthTimer);
      this._healthTimer = null;
    }
    
    // Wait for active jobs to finish (with timeout)
    const startTime = Date.now();
    while (this.queue.active.size > 0 && (Date.now() - startTime) < timeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (this.queue.active.size > 0) {
      logger.warn({ activeJobs: this.queue.active.size }, 'Worker stopped with active jobs');
    } else {
      logger.info('Worker stopped gracefully');
    }
  }

  /**
   * Processing loop
   */
  _processLoop() {
    if (!this.running) return;
    
    // The queue handles its own processing, but we ensure it stays active
    if (!this.queue.processing) {
      this.queue._process().catch(() => {});
    }
    
    this._processTimer = setTimeout(() => {
      this._processLoop();
    }, this.processInterval);
  }

  /**
   * Health check
   */
  _healthCheck() {
    const stats = this.queue.getStats();
    const uptime = this.stats.startedAt ? Date.now() - this.stats.startedAt : 0;
    
    logger.debug({
      queue: this.queue.name,
      uptime,
      jobsProcessed: this.stats.jobsProcessed,
      pending: stats.pending,
      active: stats.active,
      dead: stats.dead
    }, 'Worker health check');
  }

  /**
   * Get worker health status
   */
  getHealth() {
    const queueStats = this.queue.getStats();
    const uptime = this.stats.startedAt ? Date.now() - this.stats.startedAt : 0;
    
    return {
      status: this.running ? 'running' : 'stopped',
      uptime,
      queue: this.queue.name,
      jobsProcessed: this.stats.jobsProcessed,
      isHealthy: this.running && queueStats.active <= this.queue.concurrency,
      queueStats
    };
  }
}

module.exports = {
  QueueWorker
};
