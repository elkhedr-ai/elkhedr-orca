/**
 * Integration Manager
 * Registry and management for all third-party integrations.
 */

const { logger } = require('../utils/logger.js');
const { getDatabaseInstance } = require('../db');
const { SlackIntegration } = require('./slack.js');
const { DiscordIntegration } = require('./discord.js');
const { GitHubIntegration } = require('./github.js');
const { JiraIntegration } = require('./jira.js');
const { NotionIntegration } = require('./notion.js');

const ADAPTERS = {
  slack: SlackIntegration,
  discord: DiscordIntegration,
  github: GitHubIntegration,
  jira: JiraIntegration,
  notion: NotionIntegration
};

class IntegrationManager {
  constructor() {
    this.initialized = false;
    this.adapters = new Map();
  }

  async initialize() {
    if (this.initialized) return;
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS integrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        provider TEXT NOT NULL,
        name TEXT NOT NULL,
        credentials TEXT NOT NULL,
        config TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        last_test_at DATETIME,
        last_test_status TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS integration_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        integration_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        request TEXT,
        response TEXT,
        error TEXT,
        latency_ms INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE
      )
    `);

    this.initialized = true;
    logger.info('Integration manager initialized');
  }

  getAdapterClass(provider) {
    return ADAPTERS[provider];
  }

  listProviders() {
    return Object.keys(ADAPTERS).map(key => ({
      id: key,
      name: key.charAt(0).toUpperCase() + key.slice(1),
      capabilities: this._getCapabilities(key)
    }));
  }

  _getCapabilities(provider) {
    const caps = {
      slack: ['sendMessage', 'listChannels', 'createIssue'],
      discord: ['sendMessage', 'listChannels', 'createIssue'],
      github: ['createIssue', 'createPR', 'comment', 'listRepos'],
      jira: ['createIssue', 'updateIssue', 'comment', 'listProjects'],
      notion: ['createPage', 'updatePage', 'comment', 'listDatabases']
    };
    return caps[provider] || [];
  }

  async registerIntegration(userId, config) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const AdapterClass = ADAPTERS[config.provider];
    if (!AdapterClass) {
      throw new Error(`Unknown provider: ${config.provider}`);
    }

    const result = await adapter.execute(
      `INSERT INTO integrations (user_id, provider, name, credentials, config)
       VALUES (?, ?, ?, ?, ?)`,
      [
        userId,
        config.provider,
        config.name || config.provider,
        JSON.stringify(config.credentials),
        config.config ? JSON.stringify(config.config) : null
      ]
    );

    const integrationId = result.lastInsertRowid || result.insertId;
    logger.info({ integrationId, userId, provider: config.provider }, 'Integration registered');

    return {
      id: integrationId,
      provider: config.provider,
      name: config.name || config.provider,
      active: true
    };
  }

  async getIntegration(integrationId, userId) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const rows = await adapter.execute(
      'SELECT * FROM integrations WHERE id = ? AND user_id = ?',
      [integrationId, userId]
    );

    const row = Array.isArray(rows) ? rows[0] : (rows.rows ? rows.rows[0] : null);
    if (!row) return null;

    return this._formatIntegration(row);
  }

  async listIntegrations(userId) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const rows = await adapter.execute(
      'SELECT * FROM integrations WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );

    const integrations = Array.isArray(rows) ? rows : (rows.rows || []);
    return integrations.map(row => this._formatIntegration(row));
  }

  async updateIntegration(integrationId, userId, updates) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const existing = await this.getIntegration(integrationId, userId);
    if (!existing) return null;

    const fields = [];
    const values = [];

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.credentials !== undefined) { fields.push('credentials = ?'); values.push(JSON.stringify(updates.credentials)); }
    if (updates.config !== undefined) { fields.push('config = ?'); values.push(JSON.stringify(updates.config)); }
    if (updates.active !== undefined) { fields.push('active = ?'); values.push(updates.active ? 1 : 0); }

    if (fields.length === 0) return existing;

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(integrationId, userId);

    await adapter.execute(
      `UPDATE integrations SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
      values
    );

    return this.getIntegration(integrationId, userId);
  }

  async deleteIntegration(integrationId, userId) {
    await this.initialize();
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();

    const result = await adapter.execute(
      'DELETE FROM integrations WHERE id = ? AND user_id = ?',
      [integrationId, userId]
    );

    return (result.changes || result.affectedRows || 0) > 0;
  }

  async testIntegration(integrationId, userId) {
    const integration = await this.getIntegration(integrationId, userId);
    if (!integration) return { success: false, error: 'Integration not found' };

    const AdapterClass = ADAPTERS[integration.provider];
    if (!AdapterClass) return { success: false, error: 'Unknown provider' };

    const instance = new AdapterClass({
      credentials: integration.credentials,
      baseUrl: integration.config?.baseUrl
    });

    const startTime = Date.now();
    const result = await instance.testConnection();
    const latencyMs = Date.now() - startTime;

    // Update last test status
    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();
    await adapter.execute(
      'UPDATE integrations SET last_test_at = CURRENT_TIMESTAMP, last_test_status = ? WHERE id = ?',
      [result.success ? 'success' : 'failed', integrationId]
    );

    // Log the test
    await this._logAction(integrationId, 'test_connection', result.success ? 'success' : 'failed', null, result, result.error, latencyMs);

    return result;
  }

  async executeAction(integrationId, userId, action, params) {
    const integration = await this.getIntegration(integrationId, userId);
    if (!integration) return { success: false, error: 'Integration not found' };

    const AdapterClass = ADAPTERS[integration.provider];
    if (!AdapterClass) return { success: false, error: 'Unknown provider' };

    const instance = new AdapterClass({
      credentials: integration.credentials,
      baseUrl: integration.config?.baseUrl
    });

    const startTime = Date.now();
    let result;

    try {
      switch (action) {
        case 'sendMessage':
          result = await instance.sendMessage(params);
          break;
        case 'createIssue':
          result = await instance.createIssue(params);
          break;
        case 'updateIssue':
          result = await instance.updateIssue(params.issueId, params.updates);
          break;
        case 'listTargets':
          result = await instance.listTargets();
          break;
        default:
          result = { success: false, error: `Unknown action: ${action}` };
      }
    } catch (error) {
      result = { success: false, error: error.message };
    }

    const latencyMs = Date.now() - startTime;
    await this._logAction(integrationId, action, result.success ? 'success' : 'failed', params, result, result.error, latencyMs);

    return result;
  }

  async _logAction(integrationId, action, status, request, response, error, latencyMs) {
    try {
      const db = await getDatabaseInstance();
      const adapter = db.getAdapter();
      await adapter.execute(
        `INSERT INTO integration_logs (integration_id, action, status, request, response, error, latency_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          integrationId,
          action,
          status,
          request ? JSON.stringify(request) : null,
          response ? JSON.stringify(response) : null,
          error || null,
          latencyMs
        ]
      );
    } catch (e) {
      logger.warn({ error: e.message }, 'Failed to log integration action');
    }
  }

  async getLogs(integrationId, userId, options = {}) {
    await this.initialize();

    // Verify ownership
    const integration = await this.getIntegration(integrationId, userId);
    if (!integration) return null;

    const db = await getDatabaseInstance();
    const adapter = db.getAdapter();
    const limit = options.limit || 50;

    const rows = await adapter.execute(
      'SELECT * FROM integration_logs WHERE integration_id = ? ORDER BY created_at DESC LIMIT ?',
      [integrationId, limit]
    );

    const logs = Array.isArray(rows) ? rows : (rows.rows || []);
    return logs.map(row => ({
      id: row.id,
      action: row.action,
      status: row.status,
      error: row.error,
      latencyMs: row.latency_ms,
      createdAt: row.created_at
    }));
  }

  _formatIntegration(row) {
    return {
      id: row.id,
      userId: row.user_id,
      provider: row.provider,
      name: row.name,
      credentials: JSON.parse(row.credentials),
      config: row.config ? JSON.parse(row.config) : null,
      active: !!row.active,
      lastTestAt: row.last_test_at,
      lastTestStatus: row.last_test_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}

let instance = null;

function getIntegrationManager() {
  if (!instance) {
    instance = new IntegrationManager();
  }
  return instance;
}

function resetIntegrationManager() {
  instance = null;
}

module.exports = {
  IntegrationManager,
  getIntegrationManager,
  resetIntegrationManager,
  ADAPTERS
};
