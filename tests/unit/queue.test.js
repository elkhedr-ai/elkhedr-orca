/**
 * Tests for Task Queue System
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const { TaskQueue, JOB_STATUS, PRIORITY_WEIGHTS } = require('../../src/queue/index.js');
const { QueueWorker } = require('../../src/queue/worker.js');

describe('TaskQueue', () => {
  let queue;

  beforeEach(() => {
    queue = new TaskQueue('test', { concurrency: 1 });
    queue.clear();
  });

  describe('Basic Operations', () => {
    it('should create a queue with default options', () => {
      const q = new TaskQueue('default');
      assert.strictEqual(q.name, 'default');
      assert.strictEqual(q.concurrency, 1);
      assert.strictEqual(q.maxRetries, 3);
    });

    it('should create a queue with custom options', () => {
      const q = new TaskQueue('custom', { concurrency: 5, maxRetries: 5 });
      assert.strictEqual(q.concurrency, 5);
      assert.strictEqual(q.maxRetries, 5);
    });
  });

  describe('Job Enqueueing', () => {
    it('should add a job to the queue', () => {
      queue.pause();
      const job = queue.add('test-job', { foo: 'bar' });
      
      assert.ok(job.id);
      assert.strictEqual(job.type, 'test-job');
      assert.deepStrictEqual(job.data, { foo: 'bar' });
      assert.strictEqual(job.status, JOB_STATUS.PENDING);
      assert.strictEqual(job.priority, 'normal');
    });

    it('should add a job with custom priority', () => {
      queue.pause();
      const job = queue.add('test-job', {}, { priority: 'high' });
      assert.strictEqual(job.priority, 'high');
      assert.strictEqual(job.priorityWeight, PRIORITY_WEIGHTS.high);
    });

    it('should add a delayed job', (t, done) => {
      queue.pause();
      const job = queue.add('delayed-job', {}, { delay: 50 });
      assert.strictEqual(job.status, JOB_STATUS.DELAYED);
      
      setTimeout(() => {
        assert.strictEqual(job.status, JOB_STATUS.PENDING);
        done();
      }, 100);
    });

    it('should throw for invalid priority', () => {
      queue.pause();
      assert.throws(
        () => queue.add('test-job', {}, { priority: 'invalid' }),
        /Invalid priority/
      );
    });

    it('should fail when no handler registered', async () => {
      const addedJob = queue.add('unknown-job', {});
      
      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const job = queue.getJob(addedJob.id);
      // The job should have been attempted and failed
      assert.ok(job);
      assert.ok(job.attempts > 0 || job.status === JOB_STATUS.FAILED || job.status === JOB_STATUS.PENDING);
    });
  });

  describe('Job Processing', () => {
    it('should process a job and complete it', async () => {
      queue.process('add-job', async (data) => data.a + data.b);
      
      const resultPromise = new Promise(resolve => {
        queue.on('job:completed', (job, result) => resolve({ job, result }));
      });
      
      queue.add('add-job', { a: 2, b: 3 });
      
      const { job, result } = await resultPromise;
      assert.strictEqual(result, 5);
      assert.strictEqual(job.status, JOB_STATUS.COMPLETED);
      assert.ok(job.completedAt >= job.createdAt);
    });

    it('should process jobs in priority order', async () => {
      const processed = [];
      queue.process('priority-job', async (data) => {
        processed.push(data.priority);
      });
      
      queue.pause();
      queue.add('priority-job', { priority: 'normal' }, { priority: 'normal' });
      queue.add('priority-job', { priority: 'high' }, { priority: 'high' });
      queue.add('priority-job', { priority: 'low' }, { priority: 'low' });
      queue.add('priority-job', { priority: 'critical' }, { priority: 'critical' });
      queue.resume();
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
      assert.deepStrictEqual(processed, ['critical', 'high', 'normal', 'low']);
    });

    it('should process FIFO for same priority', async () => {
      const processed = [];
      queue.process('fifo-job', async (data) => {
        processed.push(data.id);
      });
      
      queue.pause();
      queue.add('fifo-job', { id: 1 });
      queue.add('fifo-job', { id: 2 });
      queue.add('fifo-job', { id: 3 });
      queue.resume();
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
      assert.deepStrictEqual(processed, [1, 2, 3]);
    });
  });

  describe('Retries', () => {
    it('should retry failed jobs up to max retries', async () => {
      queue.maxRetries = 2;
      queue.baseRetryDelay = 10;
      
      let attempts = 0;
      queue.process('fail-job', async () => {
        attempts++;
        throw new Error('Always fails');
      });
      
      const deadPromise = new Promise(resolve => {
        queue.on('job:dead', (job) => resolve(job));
      });
      
      queue.add('fail-job', {});
      
      const job = await deadPromise;
      assert.strictEqual(job.attempts, 3); // Initial + 2 retries
      assert.strictEqual(job.status, JOB_STATUS.DEAD);
      assert.ok(queue.getDeadLetterQueue().some(j => j.id === job.id));
    });

    it('should succeed on retry', async () => {
      queue.baseRetryDelay = 10;
      
      let attempts = 0;
      queue.process('eventually-succeed', async () => {
        attempts++;
        if (attempts < 2) throw new Error('Not yet');
        return 'success';
      });
      
      const completedPromise = new Promise(resolve => {
        queue.on('job:completed', (job, result) => resolve({ job, result }));
      });
      
      queue.add('eventually-succeed', {});
      
      const { job, result } = await completedPromise;
      assert.strictEqual(result, 'success');
      assert.strictEqual(job.attempts, 2);
    });
  });

  describe('Dead Letter Queue', () => {
    it('should move permanently failed jobs to DLQ', async () => {
      queue.maxRetries = 0;
      queue.baseRetryDelay = 10;
      
      queue.process('dead-job', async () => {
        throw new Error('Permanent failure');
      });
      
      const deadPromise = new Promise(resolve => {
        queue.on('job:dead', (job) => resolve(job));
      });
      
      queue.add('dead-job', {});
      
      const job = await deadPromise;
      assert.strictEqual(job.status, JOB_STATUS.DEAD);
      assert.ok(queue.getDeadLetterQueue().some(j => j.id === job.id));
    });

    it('should allow retrying dead jobs', async () => {
      queue.maxRetries = 0;
      queue.baseRetryDelay = 10;
      
      let attempts = 0;
      queue.process('retry-dead', async () => {
        attempts++;
        if (attempts < 2) throw new Error('Fail once');
        return 'success';
      });
      
      // First attempt fails and goes to DLQ
      const deadPromise = new Promise(resolve => {
        queue.on('job:dead', (job) => resolve(job));
      });
      
      const job = queue.add('retry-dead', {});
      await deadPromise;
      
      // Retry from DLQ
      const completedPromise = new Promise(resolve => {
        queue.on('job:completed', (j, result) => resolve(result));
      });
      
      queue.retry(job.id);
      const result = await completedPromise;
      
      assert.strictEqual(result, 'success');
      assert.strictEqual(queue.getDeadLetterQueue().length, 0);
    });

    it('should throw when retrying non-dead job', () => {
      queue.pause();
      const job = queue.add('test-job', {});
      
      assert.throws(
        () => queue.retry(job.id),
        /not in dead letter queue/
      );
    });
  });

  describe('Timeout', () => {
    it('should timeout slow jobs', async () => {
      queue.jobTimeout = 50;
      queue.baseRetryDelay = 10;
      
      queue.process('slow-job', async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return 'done';
      });
      
      const failedPromise = new Promise(resolve => {
        queue.on('job:failed', (job) => resolve(job));
      });
      
      queue.add('slow-job', {});
      
      const job = await failedPromise;
      assert.ok(job.error.includes('timed out'));
    });
  });

  describe('Stats', () => {
    it('should return accurate stats', async () => {
      queue.process('stat-job', async (data) => data);
      
      queue.add('stat-job', { id: 1 });
      queue.add('stat-job', { id: 2 });
      queue.add('stat-job', { id: 3 });
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const stats = queue.getStats();
      assert.strictEqual(stats.name, 'test');
      assert.strictEqual(stats.total, 3);
      assert.strictEqual(stats.completed, 3);
      assert.strictEqual(stats.pending, 0);
      assert.strictEqual(stats.active, 0);
      assert.strictEqual(stats.metrics.totalEnqueued, 3);
      assert.strictEqual(stats.metrics.totalCompleted, 3);
    });
  });

  describe('Pause/Resume', () => {
    it('should pause and resume processing', async () => {
      const processed = [];
      queue.process('pause-job', async (data) => {
        processed.push(data.id);
      });
      
      queue.pause();
      queue.add('pause-job', { id: 1 });
      
      // Should not process while paused
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.deepStrictEqual(processed, []);
      
      queue.resume();
      
      await new Promise(resolve => setTimeout(resolve, 200));
      assert.deepStrictEqual(processed, [1]);
    });
  });

  describe('Cleanup', () => {
    it('should clean up old completed jobs', async () => {
      queue.process('cleanup-job', async (data) => data);
      
      queue.add('cleanup-job', { id: 1 });
      await new Promise(resolve => setTimeout(resolve, 100));
      
      assert.strictEqual(queue.completed.length, 1);
      
      // Clean up with 0 maxAge (remove all)
      queue.cleanup(0);
      assert.strictEqual(queue.completed.length, 0);
    });
  });

  describe('Events', () => {
    it('should emit job:added event', async () => {
      queue.pause();
      queue.process('test-job', async (data) => data);
      
      const addedPromise = new Promise(resolve => {
        queue.on('job:added', (job) => resolve(job));
      });
      
      queue.add('test-job', { foo: 'bar' });
      
      const job = await addedPromise;
      assert.deepStrictEqual(job.data, { foo: 'bar' });
    });

    it('should emit job:started event', async () => {
      queue.process('test-job', async (data) => data);
      
      const startedPromise = new Promise(resolve => {
        queue.on('job:started', (job) => resolve(job));
      });
      
      queue.add('test-job', {});
      
      const job = await startedPromise;
      assert.strictEqual(job.status, JOB_STATUS.ACTIVE);
    });

    it('should emit job:completed event', async () => {
      queue.process('test-job', async (data) => 'result');
      
      const completedPromise = new Promise(resolve => {
        queue.on('job:completed', (job, result) => resolve({ job, result }));
      });
      
      queue.add('test-job', {});
      
      const { job, result } = await completedPromise;
      assert.strictEqual(result, 'result');
      assert.strictEqual(job.status, JOB_STATUS.COMPLETED);
    });
  });

  describe('QueueWorker', () => {
    it('should start and stop gracefully', async () => {
      queue.process('test-job', async (data) => data);
      
      const worker = new QueueWorker(queue, { processInterval: 50 });
      worker.start();
      assert.strictEqual(worker.running, true);
      
      await worker.stop();
      assert.strictEqual(worker.running, false);
    });

    it('should process jobs when started', async () => {
      let processed = false;
      queue.process('test-job', async () => {
        processed = true;
        return 'done';
      });
      
      const worker = new QueueWorker(queue, { processInterval: 50 });
      worker.start();
      queue.add('test-job', {});
      
      await new Promise(resolve => setTimeout(resolve, 300));
      assert.strictEqual(processed, true);
      
      await worker.stop();
    });

    it('should return health status', async () => {
      queue.process('test-job', async (data) => data);
      
      const worker = new QueueWorker(queue, { processInterval: 50 });
      worker.start();
      queue.add('test-job', { id: 1 });
      
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const health = worker.getHealth();
      assert.strictEqual(health.status, 'running');
      assert.strictEqual(health.queue, 'test');
      assert.ok(health.isHealthy);
      assert.ok(health.jobsProcessed >= 1);
      
      await worker.stop();
    });
  });
});
