/**
 * Event Bus Architecture
 * 
 * Pub/sub event bus for internal communication.
 * Supports multiple subscribers, event persistence, and replay.
 * 
 * Built-in event types:
 *   - agent_start, agent_complete, agent_error
 *   - tool_call, tool_complete, tool_error
 *   - workflow_start, workflow_step, workflow_complete, workflow_error
 *   - cost_update, token_usage
 *   - skill_execute, skill_error
 *   - system: config_reload, health_check, shutdown
 */

const { EventEmitter } = require('events');
const { logger } = require('../utils/logger.js');
const { ValidationError } = require('../utils/errors.js');
const { FileEventStore, MemoryEventStore } = require('./store.js');

const BUILTIN_EVENTS = [
  'agent_start',
  'agent_complete',
  'agent_error',
  'tool_call',
  'tool_complete',
  'tool_error',
  'workflow_start',
  'workflow_step',
  'workflow_complete',
  'workflow_error',
  'workflow_cancelled',
  'cost_update',
  'token_usage',
  'skill_execute',
  'skill_error',
  'system_config_reload',
  'system_health_check',
  'system_shutdown'
];

/**
 * Event Bus with persistence and replay
 */
class EventBus extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.persistenceEnabled = options.persistenceEnabled !== false;
    this.name = options.name || 'default';
    this.store = options.store || (
      this.persistenceEnabled ? new FileEventStore() : new MemoryEventStore()
    );
    this.maxListeners = options.maxListeners || 100;
    
    this.setMaxListeners(this.maxListeners);
    
    // Statistics
    this.stats = {
      totalPublished: 0,
      totalSubscribers: 0,
      eventsByType: {}
    };
    
    // Wildcard subscribers
    this.wildcardSubscribers = [];
    
    // Subscribe to all events for persistence via wildcard
    if (this.persistenceEnabled) {
      this.wildcardSubscribers.push((event) => {
        this._persistEvent(event);
      });
    }
    
    logger.info({ bus: this.name }, 'Event bus initialized');
  }

  /**
   * Publish an event
   * @param {string} type - Event type
   * @param {Object} data - Event data
   * @param {Object} options - Publish options
   * @param {string} options.source - Source of the event (module/component name)
   * @param {string} options.correlationId - Trace/correlation ID
   */
  publish(type, data = {}, options = {}) {
    if (!type || typeof type !== 'string') {
      throw new ValidationError('Event type must be a non-empty string');
    }
    
    const event = {
      type,
      timestamp: Date.now(),
      source: options.source || 'unknown',
      correlationId: options.correlationId || this._generateCorrelationId(),
      data: data || {}
    };
    
    // Update stats
    this.stats.totalPublished++;
    this.stats.eventsByType[type] = (this.stats.eventsByType[type] || 0) + 1;
    
    // Emit to specific type listeners
    this.emit(type, event.data, event);
    
    // Emit to wildcard listeners
    for (const handler of this.wildcardSubscribers) {
      try {
        handler(event);
      } catch (error) {
        logger.error({ error: error.message }, 'Wildcard subscriber error');
      }
    }
    
    // Emit to 'all' listeners
    this.emit('*', event);
    
    logger.debug({ type, source: event.source }, 'Event published');
    
    return event;
  }

  /**
   * Subscribe to events
   * @param {string|Array<string>} types - Event type(s) to subscribe to
   * @param {Function} handler - Event handler
   * @param {Object} options - Subscription options
   * @param {boolean} options.once - Only handle once
   * @returns {Function} Unsubscribe function
   */
  subscribe(types, handler, options = {}) {
    if (typeof handler !== 'function') {
      throw new ValidationError('Handler must be a function');
    }
    
    const eventTypes = Array.isArray(types) ? types : [types];
    const once = options.once || false;
    
    const unsubscribers = [];
    
    for (const eventType of eventTypes) {
      if (eventType === '*') {
        // Wildcard subscription
        this.wildcardSubscribers.push(handler);
        unsubscribers.push(() => {
          const index = this.wildcardSubscribers.indexOf(handler);
          if (index !== -1) {
            this.wildcardSubscribers.splice(index, 1);
          }
        });
      } else {
        if (once) {
          super.once(eventType, handler);
        } else {
          this.on(eventType, handler);
        }
        
        unsubscribers.push(() => {
          if (once) {
            this.off(eventType, handler);
          } else {
            this.off(eventType, handler);
          }
        });
      }
    }
    
    this.stats.totalSubscribers++;
    
    // Return unsubscribe function
    return () => {
      for (const unsub of unsubscribers) {
        unsub();
      }
      this.stats.totalSubscribers--;
    };
  }

  /**
   * Subscribe once to an event
   */
  once(type, handler) {
    return this.subscribe(type, handler, { once: true });
  }

  /**
   * Replay events from the store
   * @param {Object} options - Replay options
   * @param {string|Array<string>} options.types - Event types to replay
   * @param {number} options.startFrom - Start from timestamp or index
   * @param {Function} options.filter - Custom filter function
   */
  replay(options = {}) {
    const events = this.store.query({
      types: Array.isArray(options.types) ? options.types : options.types ? [options.types] : undefined,
      after: options.startFrom,
      filter: options.filter
    });
    
    logger.info({ count: events.length }, 'Replaying events');
    
    for (const event of events) {
      this.emit(event.type, event.data, event);
    }
    
    return events.length;
  }

  /**
   * Get events from store
   */
  query(options = {}) {
    return this.store.query(options);
  }

  /**
   * Get event statistics
   */
  getStats() {
    return {
      name: this.name,
      totalPublished: this.stats.totalPublished,
      totalSubscribers: this.stats.totalSubscribers,
      activeListeners: this.listenerCount(),
      eventsByType: { ...this.stats.eventsByType },
      storeCount: this.store.count(),
      storeByType: this.store.countByType()
    };
  }

  /**
   * Get event counts by type from store
   */
  getEventCounts() {
    return this.store.countByType();
  }

  /**
   * Clear all subscribers (useful for testing)
   */
  clearSubscribers() {
    this.removeAllListeners();
    this.wildcardSubscribers = [];
  }

  /**
   * Clear event store
   */
  clearStore() {
    this.store.clear();
  }

  /**
   * Stop the event bus
   */
  stop() {
    this.store.stop();
    this.removeAllListeners();
    this.wildcardSubscribers = [];
    logger.info({ bus: this.name }, 'Event bus stopped');
  }

  /**
   * Persist event to store
   */
  _persistEvent(event) {
    try {
      this.store.append(event);
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to persist event');
    }
  }

  /**
   * Generate a correlation ID
   */
  _generateCorrelationId() {
    return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }
}

/**
 * Create a global event bus instance
 */
let globalBus = null;

function getEventBus(options = {}) {
  if (!globalBus) {
    globalBus = new EventBus({ name: 'global', ...options });
  }
  return globalBus;
}

function resetEventBus() {
  if (globalBus) {
    globalBus.stop();
    globalBus = null;
  }
}

module.exports = {
  EventBus,
  BUILTIN_EVENTS,
  getEventBus,
  resetEventBus
};
