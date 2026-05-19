/**
 * WebSocket Collaboration Server
 * Multi-user real-time collaboration with Socket.io
 */

const { Server } = require('socket.io');
const { logger } = require('../utils/logger.js');

class CollaborationServer {
  constructor(httpServer, options = {}) {
    this.io = new Server(httpServer, {
      cors: {
        origin: process.env.ORCA_CORS_ORIGIN || '*',
        methods: ['GET', 'POST']
      },
      ...options.ioOptions
    });

    this.rooms = new Map(); // roomId -> { users: Map, messages: Array }
    this.setupHandlers();
    logger.info('Collaboration server initialized');
  }

  setupHandlers() {
    this.io.on('connection', (socket) => {
      logger.info({ socketId: socket.id }, 'Client connected to collaboration');

      // Join room
      socket.on('join-room', ({ roomId, user }) => {
        socket.join(roomId);
        socket.user = user;
        socket.roomId = roomId;

        if (!this.rooms.has(roomId)) {
          this.rooms.set(roomId, { users: new Map(), messages: [] });
        }

        const room = this.rooms.get(roomId);
        room.users.set(socket.id, user);

        // Notify others
        socket.to(roomId).emit('user-joined', { user, users: Array.from(room.users.values()) });

        // Send current state to new user
        socket.emit('room-state', {
          users: Array.from(room.users.values()),
          messages: room.messages.slice(-50),
        });

        logger.info({ roomId, userId: user.id }, 'User joined room');
      });

      // Leave room
      socket.on('leave-room', ({ roomId }) => {
        this.handleLeave(socket, roomId);
      });

      // Chat message
      socket.on('chat-message', ({ roomId, message }) => {
        const room = this.rooms.get(roomId);
        if (!room) return;

        const chatMessage = {
          id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          user: socket.user,
          text: message,
          timestamp: new Date().toISOString(),
        };

        room.messages.push(chatMessage);
        if (room.messages.length > 100) {
          room.messages = room.messages.slice(-100);
        }

        this.io.to(roomId).emit('chat-message', chatMessage);
      });

      // Cursor position (for presence indicators)
      socket.on('cursor-move', ({ roomId, x, y }) => {
        socket.to(roomId).emit('cursor-update', {
          userId: socket.user?.id,
          socketId: socket.id,
          x,
          y,
        });
      });

      // Session update (for real-time collaboration)
      socket.on('session-update', ({ roomId, update }) => {
        socket.to(roomId).emit('session-update', {
          userId: socket.user?.id,
          update,
        });
      });

      // Typing indicator
      socket.on('typing', ({ roomId, isTyping }) => {
        socket.to(roomId).emit('typing', {
          userId: socket.user?.id,
          username: socket.user?.username,
          isTyping,
        });
      });

      // Disconnect
      socket.on('disconnect', () => {
        if (socket.roomId) {
          this.handleLeave(socket, socket.roomId);
        }
        logger.info({ socketId: socket.id }, 'Client disconnected');
      });
    });
  }

  handleLeave(socket, roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;

    room.users.delete(socket.id);
    socket.leave(roomId);

    socket.to(roomId).emit('user-left', {
      userId: socket.user?.id,
      users: Array.from(room.users.values()),
    });

    // Clean up empty rooms
    if (room.users.size === 0) {
      this.rooms.delete(roomId);
    }

    logger.info({ roomId, userId: socket.user?.id }, 'User left room');
  }

  // Get room statistics
  getRoomStats(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return {
      userCount: room.users.size,
      messageCount: room.messages.length,
      users: Array.from(room.users.values()),
    };
  }

  // Get all active rooms
  getActiveRooms() {
    return Array.from(this.rooms.entries()).map(([roomId, room]) => ({
      roomId,
      userCount: room.users.size,
    }));
  }

  // Broadcast to all clients in a room
  broadcastToRoom(roomId, event, data) {
    this.io.to(roomId).emit(event, data);
  }
}

module.exports = { CollaborationServer };
