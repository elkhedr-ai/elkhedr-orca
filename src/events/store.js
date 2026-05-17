/**
 * Event Store
 * 
 * Persistent storage for events with replay capability.
 * File-based MVP (pluggable for Redis/database in production).
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger.js');
const { ValidationError } = require('../utils/errors.js');

const EVENTS_DIR = path.join(__dirname, '../../data');
const EVENTS_FILE = path.join(EVENTS_DIR, 'events.jsonl');

/**
 * File-based event store (JSON Lines format)
 */
class FileEventStore {
  constructor(options = {}) {
    this.filePath = options.filePath || EVENTS_FILE;
    this.ensureStorage();
    this.buffer = [];
    this.bufferSize = options.bufferSize || 100;
    this.flushInterval = options.flushInterval !== undefined ? options.flushInterval : 5000;
    
    // Auto-flush buffer periodically
    if (this.flushInterval > 0) {
      this._flushTimer = setInterval(() => this.flush(), this.flushInterval);
    }
  }

  ensureStorage() {
    if (!fs.existsSync(EVENTS_DIR)) {
      fs.mkdirSync(EVENTS_DIR, { recursive: true });
    }
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, '');
    }
  }

  /**
   * Append a single event to the store
   */
  append(event) {
    if (!event || typeof event !== 'object') {
      throw new ValidationError('Event must be an object');
    }
    
    if (!event.type || !event.timestamp) {
      throw new ValidationError('Event must have type and timestamp');
    }
    
    this.buffer.push(event);
    
    if (this.buffer.length >= this.bufferSize) {
      this.flush();
    }
  }

  /**
   * Flush buffered events to disk
   */
  flush() {
    if (this.buffer.length === 0) return;
    
    const lines = this.buffer.map(e => JSON.stringify(e)).join('\n') + '\n';
    
    try {
      fs.appendFileSync(this.filePath, lines);
      logger.debug({ count: this.buffer.length }, 'Events flushed to store');
      this.buffer = [];
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to flush events');
    }
  }

  /**
   * Read all events from store
   */
  readAll() {
    this.flush(); // Ensure buffer is written
    
    try {
      const content = fs.readFileSync(this.filePath, 'utf8');
      if (!content.trim()) return [];
      
      return content
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter(e => e !== null);
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to read events');
      return [];
    }
  }

  /**
   * Query events by criteria
   */
  query(options = {}) {
    const events = this.readAll();
    
    return events.filter(event => {
      if (options.type && event.type !== options.type) return false;
      if (options.types && !options.types.includes(event.type)) return false;
      if (options.after && event.timestamp <= options.after) return false;
      if (options.before && event.timestamp >= options.before) return false;
      if (options.source && event.source !== options.source) return false;
      if (options.filter && !options.filter(event)) return false;
      return true;
    });
  }

  /**
   * Get events for replay (from a starting point)
   */
  getReplayStream(startFrom = 0) {
    const events = this.readAll();
    return events.slice(startFrom);
  }

  /**
   * Get event count
   */
  count() {
    const events = this.readAll();
    return events.length;
  }

  /**
   * Get count by event type
   */
  countByType() {
    const events = this.readAll();
    const counts = {};
    
    for (const event of events) {
      counts[event.type] = (counts[event.type] || 0) + 1;
    }
    
    return counts;
  }

  /**
   * Clear all events (useful for testing)
   */
  clear() {
    this.buffer = [];
    try {
      fs.writeFileSync(this.filePath, '');
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to clear events');
    }
  }

  /**
   * Archive old events
   */
  archive(maxAge = 86400000) {
    const now = Date.now();
    const events = this.readAll();
    const before = events.length;
    
    const remaining = events.filter(e => (now - e.timestamp) < maxAge);
    
    if (remaining.length < before) {
      const lines = remaining.map(e => JSON.stringify(e)).join('\n') + '\n';
      fs.writeFileSync(this.filePath, lines);
      logger.info({ archived: before - remaining.length }, 'Events archived');
    }
    
    return before - remaining.length;
  }

  /**
   * Stop the store (flush buffer, clear timers)
   */
  stop() {
    this.flush();
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
  }
}

/**
 * In-memory event store (for testing)
 */
class MemoryEventStore {
  constructor() {
    this.events = [];
  }

  append(event) {
    this.events.push(event);
  }

  flush() {
    // No-op for memory store
  }

  readAll() {
    return [...this.events];
  }

  query(options = {}) {
    return this.events.filter(event => {
      if (options.type && event.type !== options.type) return false;
      if (options.types && !options.types.includes(event.type)) return false;
      if (options.after && event.timestamp <= options.after) return false;
      if (options.before && event.timestamp >= options.before) return false;
      if (options.source && event.source !== options.source) return false;
      if (options.filter && !options.filter(event)) return false;
      return true;
    });
  }

  getReplayStream(startFrom = 0) {
    return this.events.slice(startFrom);
  }

  count() {
    return this.events.length;
  }

  countByType() {
    const counts = {};
    for (const event of this.events) {
      counts[event.type] = (counts[event.type] || 0) + 1;
    }
    return counts;
  }

  clear() {
    this.events = [];
  }

  archive() {
    return 0;
  }

  stop() {
    // No-op
  }
}

module.exports = {
  FileEventStore,
  MemoryEventStore
};
