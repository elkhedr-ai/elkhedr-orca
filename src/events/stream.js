/**
 * Event Streaming Hub
 * 
 * Bridges EventBus to real-time clients via SSE and WebSockets.
 * Supports filtering, connection management, and backpressure.
 */

const http = require('http');
const { EventEmitter } = require('events');
const { logger } = require('../utils/logger.js');
const { getEventBus } = require('../events/bus.js');

/**
 * Event Stream Hub - manages SSE and WebSocket connections
 */
class EventStreamHub extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.eventBus = options.eventBus || getEventBus({ persistenceEnabled: false });
    this.maxClients = options.maxClients || 100;
    this.heartbeatInterval = options.heartbeatInterval || 30000;
    this.clients = new Map(); // clientId -> { type, response/ws, filters, connectedAt }
    this.clientCounter = 0;
    this.stats = {
      totalConnections: 0,
      messagesSent: 0,
      bytesSent: 0
    };
    
    // Subscribe to all events and forward to clients
    this._setupEventForwarding();
    
    // Start heartbeat
    if (this.heartbeatInterval > 0) {
      this._heartbeatTimer = setInterval(() => this._sendHeartbeats(), this.heartbeatInterval);
    }
    
    logger.info('Event stream hub initialized');
  }

  /**
   * Subscribe to EventBus and forward to connected clients
   */
  _setupEventForwarding() {
    this.eventBus.subscribe('*', (event) => {
      this.broadcast(event);
    });
  }

  /**
   * Add an SSE client
   * @param {http.ServerResponse} response - HTTP response object
   * @param {Object} options - Client options
   * @param {string[]} options.filterTypes - Event types to filter for
   */
  addSSEClient(response, options = {}) {
    if (this.clients.size >= this.maxClients) {
      logger.warn('Max clients reached, rejecting SSE connection');
      response.writeHead(503, { 'Content-Type': 'text/plain' });
      response.end('Service Unavailable: Max clients reached');
      return null;
    }

    const clientId = `sse_${++this.clientCounter}_${Date.now()}`;
    
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no' // Disable nginx buffering
    });

    // Send initial connection event
    response.write(`event: connected\n`);
    response.write(`data: ${JSON.stringify({ clientId, timestamp: Date.now() })}\n\n`);

    const client = {
      id: clientId,
      type: 'sse',
      response,
      filters: options.filterTypes || null,
      connectedAt: Date.now()
    };

    this.clients.set(clientId, client);
    this.stats.totalConnections++;

    // Handle client disconnect
    response.on('close', () => {
      this.removeClient(clientId);
    });

    response.on('error', (error) => {
      logger.error({ clientId, error: error.message }, 'SSE client error');
      this.removeClient(clientId);
    });

    logger.info({ clientId }, 'SSE client connected');
    return clientId;
  }

  /**
   * Add a WebSocket client
   * @param {WebSocket} ws - WebSocket instance
   * @param {Object} options - Client options
   */
  addWebSocketClient(ws, options = {}) {
    if (this.clients.size >= this.maxClients) {
      logger.warn('Max clients reached, rejecting WebSocket connection');
      ws.close(1013, 'Max clients reached');
      return null;
    }

    const clientId = `ws_${++this.clientCounter}_${Date.now()}`;

    const client = {
      id: clientId,
      type: 'websocket',
      ws,
      filters: options.filterTypes || null,
      connectedAt: Date.now()
    };

    this.clients.set(clientId, client);
    this.stats.totalConnections++;

    // Send initial connection confirmation
    this._sendToClient(client, {
      type: 'system',
      event: 'connected',
      data: { clientId, timestamp: Date.now() }
    });

    // Handle messages from client (e.g., filter changes)
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        if (message.action === 'filter' && Array.isArray(message.types)) {
          client.filters = message.types;
          logger.info({ clientId, filters: message.types }, 'Client updated filters');
        }
      } catch {
        // Ignore invalid messages
      }
    });

    // Handle disconnect
    ws.on('close', () => {
      this.removeClient(clientId);
    });

    ws.on('error', (error) => {
      logger.error({ clientId, error: error.message }, 'WebSocket client error');
      this.removeClient(clientId);
    });

    logger.info({ clientId }, 'WebSocket client connected');
    return clientId;
  }

  /**
   * Remove a client
   */
  removeClient(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;

    if (client.type === 'sse') {
      try {
        client.response.end();
      } catch {
        // Already closed
      }
    } else if (client.type === 'websocket') {
      try {
        if (client.ws.readyState === 1) { // OPEN
          client.ws.close();
        }
      } catch {
        // Already closed
      }
    }

    this.clients.delete(clientId);
    logger.info({ clientId, duration: Date.now() - client.connectedAt }, 'Client disconnected');
  }

  /**
   * Broadcast event to all matching clients
   */
  broadcast(event) {
    const eventType = event.type || 'unknown';
    
    for (const client of this.clients.values()) {
      // Check filters
      if (client.filters && !client.filters.includes(eventType)) {
        continue;
      }

      this._sendToClient(client, event);
    }
  }

  /**
   * Send event to a specific client
   */
  _sendToClient(client, event) {
    try {
      if (client.type === 'sse') {
        const data = JSON.stringify(event);
        client.response.write(`event: ${event.type || 'message'}\n`);
        client.response.write(`data: ${data}\n\n`);
        
        this.stats.messagesSent++;
        this.stats.bytesSent += data.length;
      } else if (client.type === 'websocket') {
        if (client.ws.readyState === 1) { // OPEN
          const data = JSON.stringify(event);
          client.ws.send(data);
          
          this.stats.messagesSent++;
          this.stats.bytesSent += data.length;
        }
      }
    } catch (error) {
      logger.error({ clientId: client.id, error: error.message }, 'Failed to send to client');
      this.removeClient(client.id);
    }
  }

  /**
   * Send heartbeat to all clients
   */
  _sendHeartbeats() {
    const heartbeat = {
      type: 'system',
      event: 'heartbeat',
      timestamp: Date.now()
    };

    for (const client of this.clients.values()) {
      this._sendToClient(client, heartbeat);
    }
  }

  /**
   * Get hub statistics
   */
  getStats() {
    const sseClients = Array.from(this.clients.values()).filter(c => c.type === 'sse').length;
    const wsClients = Array.from(this.clients.values()).filter(c => c.type === 'websocket').length;

    return {
      totalClients: this.clients.size,
      sseClients,
      wsClients,
      totalConnections: this.stats.totalConnections,
      messagesSent: this.stats.messagesSent,
      bytesSent: this.stats.bytesSent,
      uptime: process.uptime()
    };
  }

  /**
   * Get list of connected clients
   */
  getClients() {
    return Array.from(this.clients.values()).map(c => ({
      id: c.id,
      type: c.type,
      filters: c.filters,
      connectedAt: c.connectedAt,
      duration: Date.now() - c.connectedAt
    }));
  }

  /**
   * Stop the hub
   */
  stop() {
    // Close all clients
    for (const clientId of this.clients.keys()) {
      this.removeClient(clientId);
    }

    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }

    logger.info('Event stream hub stopped');
  }
}

module.exports = {
  EventStreamHub
};
