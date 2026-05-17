/**
 * Task Queue System
 * 
 * In-memory priority queue with retries, delays, and dead-letter queue.
 * Designed to be swappable with BullMQ/Redis in production.
 */

const { EventEmitter } = require('events');
const { logger } = require('../utils/logger.js');
const { ValidationError } = require('../utils/errors.js');

const PRIORITY_WEIGHTS = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3
};

const JOB_STATUS = {
  PENDING: 'pending',
  DELAYED: 'delayed',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  FAILED: 'failed',
  DEAD: 'dead'
};

let jobIdCounter = 0;

function generateJobId() {
  return `job_${++jobIdCounter}_${Date.now()}`;
}

function computeRetryDelay(attempt, baseDelay = 1000) {
  const exponential = baseDelay * Math.pow(2, attempt - 1);
  const jitter = Math.random() * exponential * 0.1; // 10% jitter
  return Math.min(exponential + jitter, 30000); // Max 30s
}

class TaskQueue extends EventEmitter {
  constructor(name = 'default', options = {}) {
    super();
    this.name = name;
    this.concurrency = options.concurrency || 1;
    this.maxRetries = options.maxRetries || 3;
    this.baseRetryDelay = options.baseRetryDelay || 1000;
    this.jobTimeout = options.jobTimeout || 30000;
    
    this.jobs = new Map();
    this.pending = []; // Sorted by priority + enqueue time
    this.delayed = new Map(); // Job ID -> timeout handle
    this.active = new Set();
    this.completed = [];
    this.failed = [];
    this.dead = []; // Dead letter queue
    
    this.processing = false;
    this.workerCount = 0;
    this.handlers = new Map(); // jobType -> handler
    
    // Metrics
    this.metrics = {
      totalEnqueued: 0,
      totalCompleted: 0,
      totalFailed: 0,
      totalDead: 0,
      totalRetries: 0
    };
  }

  /**
   * Register a handler for a job type
   */
  process(jobType, handler) {
    if (typeof handler !== 'function') {
      throw new ValidationError('Handler must be a function');
    }
    this.handlers.set(jobType, handler);
    logger.info({ queue: this.name, jobType }, 'Registered job handler');
  }

  /**
   * Add a job to the queue
   */
  add(jobType, data, options = {}) {
    const priority = options.priority || 'normal';
    const delay = options.delay || 0;
    const retries = options.retries !== undefined ? options.retries : this.maxRetries;
    const jobId = options.jobId || generateJobId();
    
    if (!PRIORITY_WEIGHTS.hasOwnProperty(priority)) {
      throw new ValidationError(`Invalid priority: ${priority}. Valid: ${Object.keys(PRIORITY_WEIGHTS).join(', ')}`);
    }
    
    const job = {
      id: jobId,
      type: jobType,
      data,
      priority,
      priorityWeight: PRIORITY_WEIGHTS[priority],
      status: delay > 0 ? JOB_STATUS.DELAYED : JOB_STATUS.PENDING,
      createdAt: Date.now(),
      attempts: 0,
      maxRetries: retries,
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
      logs: []
    };
    
    this.jobs.set(jobId, job);
    this.metrics.totalEnqueued++;
    
    if (delay > 0) {
      const timeoutId = setTimeout(() => {
        this.delayed.delete(jobId);
        job.status = JOB_STATUS.PENDING;
        this._enqueue(job);
        this._process().catch(() => {});
      }, delay);
      
      this.delayed.set(jobId, timeoutId);
      logger.debug({ jobId, delay }, 'Job scheduled with delay');
    } else {
      this._enqueue(job);
    }
    
    this.emit('job:added', job);
    logger.info({ jobId, type: jobType, priority }, 'Job enqueued');
    
    // Try to process immediately (fire and forget, errors handled internally)
    this._process().catch(() => {
      // Errors are already handled in _executeJob and emitted as events
    });
    
    return job;
  }

  /**
   * Get the next job to process (sorted by priority, then FIFO)
   */
  _dequeue() {
    if (this.pending.length === 0) return null;
    
    // Sort by priority weight, then by createdAt
    this.pending.sort((a, b) => {
      if (a.priorityWeight !== b.priorityWeight) {
        return a.priorityWeight - b.priorityWeight;
      }
      return a.createdAt - b.createdAt;
    });
    
    return this.pending.shift();
  }

  /**
   * Add job to pending queue
   */
  _enqueue(job) {
    this.pending.push(job);
  }

  /**
   * Process jobs from the queue
   */
  async _process() {
    if (this.processing) return;
    if (this.workerCount >= this.concurrency) return;
    
    const job = this._dequeue();
    if (!job) return;
    
    this.processing = true;
    this.workerCount++;
    
    try {
      await this._executeJob(job);
    } finally {
      this.workerCount--;
      this.processing = false;
      
      // Process next job if capacity available
      if (this.workerCount < this.concurrency && this.pending.length > 0) {
        this._process().catch(() => {});
      }
    }
  }

  /**
   * Execute a single job
   */
  async _executeJob(job) {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      throw new ValidationError(`No handler registered for job type: ${job.type}`);
    }
    
    job.status = JOB_STATUS.ACTIVE;
    job.startedAt = Date.now();
    job.attempts++;
    this.active.add(job.id);
    
    this.emit('job:started', job);
    logger.info({ jobId: job.id, attempt: job.attempts }, 'Job started');
    
    try {
      // Execute with timeout
      const result = await this._executeWithTimeout(handler, job.data, this.jobTimeout);
      
      job.status = JOB_STATUS.COMPLETED;
      job.completedAt = Date.now();
      job.result = result;
      this.active.delete(job.id);
      this.completed.push(job);
      this.metrics.totalCompleted++;
      
      this.emit('job:completed', job, result);
      logger.info({ jobId: job.id, duration: job.completedAt - job.startedAt }, 'Job completed');
      
    } catch (error) {
      this.active.delete(job.id);
      job.error = error.message;
      
      if (job.attempts <= job.maxRetries) {
        // Retry
        job.status = JOB_STATUS.FAILED;
        this.failed.push(job);
        this.metrics.totalFailed++;
        this.metrics.totalRetries++;
        
        const retryDelay = computeRetryDelay(job.attempts, this.baseRetryDelay);
        
        this.emit('job:failed', job, error);
        logger.warn({ 
          jobId: job.id, 
          attempt: job.attempts, 
          maxRetries: job.maxRetries,
          retryDelay,
          error: error.message 
        }, 'Job failed, will retry');
        
        // Schedule retry
        setTimeout(() => {
          job.status = JOB_STATUS.PENDING;
          this._enqueue(job);
          this._process().catch(() => {});
        }, retryDelay);
        
      } else {
        // Dead letter queue
        job.status = JOB_STATUS.DEAD;
        this.dead.push(job);
        this.metrics.totalDead++;
        
        this.emit('job:dead', job, error);
        logger.error({ 
          jobId: job.id, 
          attempts: job.attempts,
          error: error.message 
        }, 'Job permanently failed, moved to dead letter queue');
      }
    }
  }

  /**
   * Execute handler with timeout
   */
  _executeWithTimeout(handler, data, timeout) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Job timed out after ${timeout}ms`));
      }, timeout);
      
      Promise.resolve(handler(data))
        .then(resolve)
        .catch(reject)
        .finally(() => clearTimeout(timeoutId));
    });
  }

  /**
   * Pause processing (finish current jobs, don't start new ones)
   */
  pause() {
    this.processing = true; // Block new processing
    logger.info({ queue: this.name }, 'Queue paused');
  }

  /**
   * Resume processing
   */
  resume() {
    this.processing = false;
    this._process().catch(() => {});
    logger.info({ queue: this.name }, 'Queue resumed');
  }

  /**
   * Get job by ID
   */
  getJob(jobId) {
    return this.jobs.get(jobId);
  }

  /**
   * Retry a dead job
   */
  retry(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new ValidationError(`Job ${jobId} not found`);
    }
    if (job.status !== JOB_STATUS.DEAD) {
      throw new ValidationError(`Job ${jobId} is not in dead letter queue (status: ${job.status})`);
    }
    
    // Remove from dead queue
    const deadIndex = this.dead.findIndex(j => j.id === jobId);
    if (deadIndex !== -1) {
      this.dead.splice(deadIndex, 1);
    }
    
    job.status = JOB_STATUS.PENDING;
    job.attempts = 0;
    job.error = null;
    this._enqueue(job);
    this._process().catch(() => {});
    
    logger.info({ jobId }, 'Job retried from dead letter queue');
    return job;
  }

  /**
   * Clean up completed/failed jobs older than maxAge
   */
  cleanup(maxAge = 3600000) { // Default: 1 hour
    const now = Date.now();
    const cutoff = now - maxAge;
    
    const beforeCompleted = this.completed.length;
    const beforeFailed = this.failed.length;
    
    this.completed = this.completed.filter(j => j.completedAt > cutoff);
    this.failed = this.failed.filter(j => j.completedAt > cutoff || j.startedAt > cutoff);
    
    logger.info({ 
      queue: this.name,
      completedRemoved: beforeCompleted - this.completed.length,
      failedRemoved: beforeFailed - this.failed.length
    }, 'Queue cleanup completed');
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      name: this.name,
      pending: this.pending.length,
      delayed: this.delayed.size,
      active: this.active.size,
      completed: this.completed.length,
      failed: this.failed.length,
      dead: this.dead.length,
      total: this.jobs.size,
      concurrency: this.concurrency,
      activeWorkers: this.workerCount,
      isPaused: this.processing && this.workerCount > 0,
      metrics: { ...this.metrics }
    };
  }

  /**
   * Get dead letter queue contents
   */
  getDeadLetterQueue() {
    return this.dead.map(job => ({
      id: job.id,
      type: job.type,
      data: job.data,
      attempts: job.attempts,
      error: job.error,
      createdAt: job.createdAt,
      lastAttempt: job.startedAt
    }));
  }

  /**
   * Clear all jobs (useful for testing)
   */
  clear() {
    // Cancel delayed jobs
    for (const timeoutId of this.delayed.values()) {
      clearTimeout(timeoutId);
    }
    this.delayed.clear();
    
    this.jobs.clear();
    this.pending = [];
    this.active.clear();
    this.completed = [];
    this.failed = [];
    this.dead = [];
    
    this.metrics = {
      totalEnqueued: 0,
      totalCompleted: 0,
      totalFailed: 0,
      totalDead: 0,
      totalRetries: 0
    };
    
    this.removeAllListeners();
  }
}

module.exports = {
  TaskQueue,
  JOB_STATUS,
  PRIORITY_WEIGHTS
};
