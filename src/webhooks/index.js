/**
 * Webhook System
 * Manage webhook subscriptions, route events, track delivery status.
 */

const crypto = require('crypto');
const { logger } = require('../utils/logger.js');
const { getDatabaseInstance } = require('../db');
const { getEventBus } = require('../events/bus.js');
const { deliverWebhook, verifySignature } = require('./delivery.js');

class WebhookManager {
  constructor() {
    this.initialized = false;
    this.eventBus = null;
    this.activeDeliveries = new Map();
  }

  async initialize() {
    if (this.initialized) return;
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        url TEXT NOT NULL,
        secret TEXT NOT NULL,
        events TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        description TEXT,
        headers TEXT,
        max_retries INTEGER NOT NULL DEFAULT 3,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        webhook_id INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        status_code INTEGER,
        response_body TEXT,
        error TEXT,
        attempt INTEGER NOT NULL DEFAULT 1,
        latency_ms INTEGER,
        delivery_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
      )
    `);

    await adapter.execute(`
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id)
    `);
    await adapter.execute(`
      CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status)
    `);

    this.initialized = true;
    logger.info('Webhook system initialized');
  }

  async createWebhook(userId, config) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const secret = config.secret || `whsec_${crypto.randomBytes(32).toString('hex')}`;
    const events = Array.isArray(config.events) ? config.events.join(',') : config.events;
    const headers = config.headers ? JSON.stringify(config.headers) : null;

    const result = await adapter.execute(
      `INSERT INTO webhooks (user_id, url, secret, events, description, headers, max_retries)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, config.url, secret, events, config.description || null, headers, config.maxRetries || 3]
    );

    const webhookId = result.lastInsertRowid || result.insertId;
    logger.info({ webhookId, userId, url: config.url }, 'Webhook created');

    return {
      id: webhookId,
      userId,
      url: config.url,
      secret,
      events: events.split(','),
      active: true,
      description: config.description,
      headers: config.headers,
      maxRetries: config.maxRetries || 3
    };
  }

  async getWebhook(webhookId, userId) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const rows = await adapter.execute(
      'SELECT * FROM webhooks WHERE id = ? AND user_id = ?',
      [webhookId, userId]
    );

    const row = Array.isArray(rows) ? rows[0] : (rows.rows ? rows.rows[0] : null);
    if (!row) return null;

    return {
      id: row.id,
      userId: row.user_id,
      url: row.url,
      events: row.events.split(','),
      active: !!row.active,
      description: row.description,
      headers: row.headers ? JSON.parse(row.headers) : null,
      maxRetries: row.max_retries,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async listWebhooks(userId) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const rows = await adapter.execute(
      'SELECT * FROM webhooks WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );

    const webhooks = Array.isArray(rows) ? rows : (rows.rows || []);
    return webhooks.map(row => ({
      id: row.id,
      userId: row.user_id,
      url: row.url,
      events: row.events.split(','),
      active: !!row.active,
      description: row.description,
      maxRetries: row.max_retries,
      createdAt: row.created_at
    }));
  }

  async updateWebhook(webhookId, userId, updates) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const existing = await this.getWebhook(webhookId, userId);
    if (!existing) return null;

    const fields = [];
    const values = [];

    if (updates.url !== undefined) { fields.push('url = ?'); values.push(updates.url); }
    if (updates.events !== undefined) {
      fields.push('events = ?');
      values.push(Array.isArray(updates.events) ? updates.events.join(',') : updates.events);
    }
    if (updates.active !== undefined) { fields.push('active = ?'); values.push(updates.active ? 1 : 0); }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
    if (updates.headers !== undefined) { fields.push('headers = ?'); values.push(JSON.stringify(updates.headers)); }
    if (updates.maxRetries !== undefined) { fields.push('max_retries = ?'); values.push(updates.maxRetries); }

    if (fields.length === 0) return existing;

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(webhookId, userId);

    await adapter.execute(
      `UPDATE webhooks SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
      values
    );

    return this.getWebhook(webhookId, userId);
  }

  async deleteWebhook(webhookId, userId) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const result = await adapter.execute(
      'DELETE FROM webhooks WHERE id = ? AND user_id = ?',
      [webhookId, userId]
    );

    const deleted = (result.changes || result.affectedRows || 0) > 0;
    if (deleted) {
      logger.info({ webhookId, userId }, 'Webhook deleted');
    }
    return deleted;
  }

  async getDeliveries(webhookId, userId, options = {}) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    // Verify ownership
    const webhook = await this.getWebhook(webhookId, userId);
    if (!webhook) return null;

    const limit = options.limit || 50;
    const offset = options.offset || 0;

    const rows = await adapter.execute(
      `SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [webhookId, limit, offset]
    );

    const deliveries = Array.isArray(rows) ? rows : (rows.rows || []);
    return deliveries.map(row => ({
      id: row.id,
      webhookId: row.webhook_id,
      eventType: row.event_type,
      status: row.status,
      statusCode: row.status_code,
      error: row.error,
      attempt: row.attempt,
      latencyMs: row.latency_ms,
      deliveryId: row.delivery_id,
      createdAt: row.created_at,
      completedAt: row.completed_at
    }));
  }

  async dispatchEvent(eventType, payload) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    // Find all active webhooks subscribed to this event
    const rows = await adapter.execute(
      `SELECT * FROM webhooks WHERE active = 1 AND (events LIKE ? OR events LIKE ?)`,
      [`%${eventType}%`, '%*%']
    );

    const webhooks = Array.isArray(rows) ? rows : (rows.rows || []);
    if (webhooks.length === 0) return 0;

    logger.info({ eventType, webhookCount: webhooks.length }, 'Dispatching event to webhooks');

    let dispatched = 0;
    for (const webhook of webhooks) {
      const events = webhook.events.split(',');
      if (!events.includes(eventType) && !events.includes('*')) continue;

      const deliveryId = crypto.randomUUID();
      const fullPayload = {
        event: eventType,
        deliveryId,
        timestamp: Date.now(),
        data: payload
      };

      // Record delivery attempt
      await adapter.execute(
        `INSERT INTO webhook_deliveries (webhook_id, event_type, payload, status, delivery_id, attempt)
         VALUES (?, ?, ?, 'pending', ?, 0)`,
        [webhook.id, eventType, JSON.stringify(fullPayload), deliveryId]
      );

      // Deliver asynchronously
      this._deliverAsync(webhook, fullPayload, deliveryId);
      dispatched++;
    }

    return dispatched;
  }

  async _deliverAsync(webhook, payload, deliveryId) {
    const headers = webhook.headers ? JSON.parse(webhook.headers) : {};

    try {
      const result = await deliverWebhook({
        url: webhook.url,
        payload,
        secret: webhook.secret,
        headers,
        maxRetries: webhook.max_retries
      });

      // Update delivery record
      const db = await getDatabaseInstance();
      const adapter = db.getAdapter();

      await adapter.execute(
        `UPDATE webhook_deliveries
         SET status = ?, status_code = ?, error = ?, attempt = ?, latency_ms = ?, completed_at = CURRENT_TIMESTAMP
         WHERE delivery_id = ?`,
        [
          result.success ? 'delivered' : 'failed',
          result.statusCode,
          result.error || null,
          result.attempt,
          result.latencyMs,
          deliveryId
        ]
      );

      logger.info({
        deliveryId,
        webhookId: webhook.id,
        success: result.success,
        statusCode: result.statusCode,
        attempt: result.attempt
      }, 'Webhook delivery completed');

    } catch (error) {
      logger.error({ deliveryId, webhookId: webhook.id, error: error.message }, 'Webhook delivery error');

      const db = await getDatabaseInstance();
      const adapter = db.getAdapter();
      await adapter.execute(
        `UPDATE webhook_deliveries SET status = 'failed', error = ?, completed_at = CURRENT_TIMESTAMP WHERE delivery_id = ?`,
        [error.message, deliveryId]
      );
    }
  }

  async getStats(userId) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const webhookCount = await adapter.execute(
      'SELECT COUNT(*) as count FROM webhooks WHERE user_id = ?',
      [userId]
    );

    const recentDeliveries = await adapter.execute(
      `SELECT status, COUNT(*) as count FROM webhook_deliveries wd
       JOIN webhooks w ON wd.webhook_id = w.id
       WHERE w.user_id = ? AND wd.created_at > datetime('now', '-24 hours')
       GROUP BY status`,
      [userId]
    );

    return {
      totalWebhooks: Array.isArray(webhookCount) ? webhookCount[0]?.count : webhookCount.rows?.[0]?.count || 0,
      last24h: Array.isArray(recentDeliveries) ? recentDeliveries : (recentDeliveries?.rows || [])
    };
  }
}

let instance = null;

function getWebhookManager() {
  if (!instance) {
    instance = new WebhookManager();
  }
  return instance;
}

function resetWebhookManager() {
  instance = null;
}

module.exports = {
  WebhookManager,
  getWebhookManager,
  resetWebhookManager
};
