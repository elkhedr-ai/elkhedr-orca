/**
 * Base Integration Adapter
 * Abstract class for all third-party integrations.
 */

class BaseIntegration {
  constructor(config = {}) {
    this.name = config.name || 'unknown';
    this.credentials = config.credentials || {};
    this.baseUrl = config.baseUrl || '';
    this.timeout = config.timeout || 10000;
    this.connected = false;
  }

  /**
   * Test the connection
   * @returns {Object} { success, error }
   */
  async testConnection() {
    throw new Error(`${this.name}.testConnection() not implemented`);
  }

  /**
   * Send a message/notification
   * @param {Object} options
   * @returns {Object} result
   */
  async sendMessage(options) {
    throw new Error(`${this.name}.sendMessage() not implemented`);
  }

  /**
   * Create an issue/ticket/task
   * @param {Object} options
   * @returns {Object} result
   */
  async createIssue(options) {
    throw new Error(`${this.name}.createIssue() not implemented`);
  }

  /**
   * Update an existing issue/ticket/task
   * @param {string} issueId
   * @param {Object} updates
   * @returns {Object} result
   */
  async updateIssue(issueId, updates) {
    throw new Error(`${this.name}.updateIssue() not implemented`);
  }

  /**
   * List available channels/projects/repos
   * @returns {Array} list
   */
  async listTargets() {
    throw new Error(`${this.name}.listTargets() not implemented`);
  }

  /**
   * Get integration status
   */
  getStatus() {
    return {
      name: this.name,
      connected: this.connected,
      hasCredentials: Object.keys(this.credentials).length > 0
    };
  }

  /**
   * Make an HTTP request with common headers
   */
  async request(path, options = {}) {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Orca-Integrations/1.0',
        ...this.getAuthHeaders(),
        ...options.headers
      };

      const response = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });

      clearTimeout(timeout);

      const data = await response.json().catch(() => null);

      return {
        ok: response.ok,
        status: response.status,
        data
      };
    } catch (error) {
      clearTimeout(timeout);
      if (error.name === 'AbortError') {
        return { ok: false, status: 0, error: 'Request timeout' };
      }
      return { ok: false, status: 0, error: error.message };
    }
  }

  /**
   * Get authentication headers (override in subclasses)
   */
  getAuthHeaders() {
    return {};
  }
}

module.exports = { BaseIntegration };
