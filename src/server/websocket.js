/**
 * WebSocket & SSE Server
 * 
 * Standalone real-time streaming server for events.
 * Serves both WebSocket and SSE endpoints until T34 (API Server) is built.
 */

const http = require('http');
const WebSocket = require('ws');
const { logger } = require('../utils/logger.js');
const { EventStreamHub } = require('../events/stream.js');

class StreamingServer {
  constructor(options = {}) {
    this.port = options.port || 3001;
    this.host = options.host || 'localhost';
    this.hub = new EventStreamHub(options.hubOptions);
    
    this.httpServer = null;
    this.wss = null;
    this.running = false;
  }

  /**
   * Start the streaming server
   */
  start() {
    if (this.running) {
      logger.warn('Streaming server already running');
      return;
    }

    // Create HTTP server for SSE
    this.httpServer = http.createServer((req, res) => {
      this._handleHttpRequest(req, res);
    });

    // Create WebSocket server attached to HTTP server
    this.wss = new WebSocket.Server({ server: this.httpServer });
    
    this.wss.on('connection', (ws, req) => {
      logger.info({ url: req.url }, 'WebSocket connection');
      this.hub.addWebSocketClient(ws);
    });

    this.wss.on('error', (error) => {
      logger.error({ error: error.message }, 'WebSocket server error');
    });

    // Start listening
    this.httpServer.listen(this.port, this.host, () => {
      this.running = true;
      logger.info({ host: this.host, port: this.port }, 'Streaming server started');
    });

    this.httpServer.on('error', (error) => {
      logger.error({ error: error.message }, 'HTTP server error');
    });
  }

  /**
   * Handle HTTP requests (SSE endpoint and health check)
   */
  _handleHttpRequest(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/events/stream') {
      // SSE endpoint
      const filterTypes = url.searchParams.get('types')?.split(',').filter(Boolean);
      this.hub.addSSEClient(res, { filterTypes });
    } else if (url.pathname === '/health') {
      // Health check
      const stats = this.hub.getStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'streaming-server',
        clients: stats.totalClients,
        uptime: process.uptime()
      }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  }

  /**
   * Stop the server
   */
  stop() {
    if (!this.running) {
      this.hub.stop();
      return;
    }

    this.running = false;

    // Close all WebSocket connections
    if (this.wss) {
      this.wss.clients.forEach(ws => {
        try {
          ws.terminate();
        } catch {
          // Ignore
        }
      });
      this.wss.close();
    }

    // Stop the hub
    this.hub.stop();

    // Close HTTP server
    if (this.httpServer) {
      this.httpServer.close(() => {
        logger.info('Streaming server stopped');
      });
    }
  }

  /**
   * Get server status
   */
  getStatus() {
    return {
      running: this.running,
      address: this.running ? `${this.host}:${this.port}` : null,
      hub: this.hub.getStats()
    };
  }
}

module.exports = {
  StreamingServer
};
