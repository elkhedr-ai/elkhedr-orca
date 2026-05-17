/**
 * Workflow State Persistence
 * 
 * Pluggable persistence layer for workflow state.
 * Default: JSON file storage (MVP)
 * Future: SQLite/PostgreSQL adapters (T20, T21)
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger.js');
const { ValidationError } = require('../utils/errors.js');

// Default storage directory
const DATA_DIR = path.join(__dirname, '../../data');
const WORKFLOWS_FILE = path.join(DATA_DIR, 'workflows.json');

/**
 * File-based state adapter (default MVP implementation)
 */
class FileStateAdapter {
  constructor(options = {}) {
    this.filePath = options.filePath || WORKFLOWS_FILE;
    this.ensureStorage();
  }

  ensureStorage() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, JSON.stringify({ workflows: [] }));
    }
  }

  _loadData() {
    try {
      const content = fs.readFileSync(this.filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to load workflow state');
      return { workflows: [] };
    }
  }

  _saveData(data) {
    try {
      // Atomic write: write to temp file, then rename
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
      fs.renameSync(tempPath, this.filePath);
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to save workflow state');
      throw new ValidationError('Failed to persist workflow state');
    }
  }

  /**
   * Load all workflows
   */
  loadAll() {
    const data = this._loadData();
    return data.workflows || [];
  }

  /**
   * Load a single workflow by ID
   */
  load(id) {
    const workflows = this.loadAll();
    return workflows.find(w => w.id === id) || null;
  }

  /**
   * Save a workflow (create or update)
   */
  save(workflow) {
    if (!workflow.id) {
      throw new ValidationError('Workflow must have an id');
    }

    const data = this._loadData();
    const index = data.workflows.findIndex(w => w.id === workflow.id);

    if (index >= 0) {
      data.workflows[index] = workflow;
    } else {
      data.workflows.push(workflow);
    }

    this._saveData(data);
    logger.debug({ workflowId: workflow.id }, 'Workflow state saved');
    return workflow;
  }

  /**
   * Delete a workflow
   */
  delete(id) {
    const data = this._loadData();
    const before = data.workflows.length;
    data.workflows = data.workflows.filter(w => w.id !== id);
    this._saveData(data);

    const deleted = before - data.workflows.length;
    logger.debug({ workflowId: id, deleted }, 'Workflow deleted from storage');
    return deleted > 0;
  }

  /**
   * List all workflow IDs
   */
  list() {
    const workflows = this.loadAll();
    return workflows.map(w => ({
      id: w.id,
      name: w.name,
      status: w.status,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt
    }));
  }

  /**
   * Get count of workflows by status
   */
  countByStatus() {
    const workflows = this.loadAll();
    const counts = {
      pending: 0,
      running: 0,
      paused: 0,
      completed: 0,
      failed: 0
    };

    for (const w of workflows) {
      if (counts[w.status] !== undefined) {
        counts[w.status]++;
      }
    }

    return counts;
  }

  /**
   * Archive completed workflows older than maxAge
   */
  archive(maxAge = 86400000) { // Default: 24 hours
    const now = Date.now();
    const data = this._loadData();
    const before = data.workflows.length;

    data.workflows = data.workflows.filter(w => {
      if (w.status === 'completed' || w.status === 'failed') {
        const age = now - (w.completedAt || w.updatedAt);
        return age < maxAge;
      }
      return true;
    });

    this._saveData(data);

    const archived = before - data.workflows.length;
    if (archived > 0) {
      logger.info({ archived }, 'Archived old workflows');
    }
    return archived;
  }
}

/**
 * In-memory state adapter (for testing)
 */
class MemoryStateAdapter {
  constructor() {
    this.workflows = new Map();
  }

  loadAll() {
    return Array.from(this.workflows.values());
  }

  load(id) {
    return this.workflows.get(id) || null;
  }

  save(workflow) {
    if (!workflow.id) {
      throw new ValidationError('Workflow must have an id');
    }
    this.workflows.set(workflow.id, workflow);
    return workflow;
  }

  delete(id) {
    return this.workflows.delete(id);
  }

  list() {
    return this.loadAll().map(w => ({
      id: w.id,
      name: w.name,
      status: w.status,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt
    }));
  }

  countByStatus() {
    const counts = {
      pending: 0,
      running: 0,
      paused: 0,
      completed: 0,
      failed: 0
    };

    for (const w of this.workflows.values()) {
      if (counts[w.status] !== undefined) {
        counts[w.status]++;
      }
    }

    return counts;
  }

  archive() {
    // No-op for memory adapter
    return 0;
  }
}

module.exports = {
  FileStateAdapter,
  MemoryStateAdapter
};
