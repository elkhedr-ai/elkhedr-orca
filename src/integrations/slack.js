/**
 * Slack Integration
 * Send messages, create posts via Slack API.
 */

const { BaseIntegration } = require('./base.js');

class SlackIntegration extends BaseIntegration {
  constructor(config = {}) {
    super({
      name: 'slack',
      baseUrl: 'https://slack.com/api',
      ...config
    });
    this.botToken = config.credentials?.botToken || config.credentials?.SLACK_BOT_TOKEN;
    this.webhookUrl = config.credentials?.webhookUrl || config.credentials?.SLACK_WEBHOOK_URL;
  }

  getAuthHeaders() {
    if (this.botToken) {
      return { Authorization: `Bearer ${this.botToken}` };
    }
    return {};
  }

  async testConnection() {
    if (this.webhookUrl) {
      // Incoming webhooks don't have a test endpoint; assume valid if configured
      this.connected = true;
      return { success: true, method: 'webhook' };
    }

    if (!this.botToken) {
      return { success: false, error: 'No bot token or webhook URL configured' };
    }

    const result = await this.request('/auth.test');
    this.connected = result.ok;
    return {
      success: result.ok,
      team: result.data?.team,
      user: result.data?.user,
      error: result.data?.error
    };
  }

  async sendMessage(options) {
    const { channel, text, blocks, threadTs } = options;

    // Use incoming webhook if no bot token
    if (this.webhookUrl && !this.botToken) {
      return this._sendViaWebhook({ text, blocks });
    }

    const body = {
      channel,
      text,
      ...(blocks && { blocks }),
      ...(threadTs && { thread_ts: threadTs })
    };

    const result = await this.request('/chat.postMessage', {
      method: 'POST',
      body
    });

    return {
      success: result.ok,
      messageId: result.data?.ts,
      channel: result.data?.channel,
      error: result.data?.error
    };
  }

  async _sendViaWebhook(payload) {
    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return { success: response.ok, status: response.status };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async listTargets() {
    if (!this.botToken) return [];

    const result = await this.request('/conversations.list?types=public_channel,private_channel&limit=100');
    if (!result.ok) return [];

    return (result.data?.channels || []).map(ch => ({
      id: ch.id,
      name: ch.name,
      type: ch.is_private ? 'private' : 'public'
    }));
  }

  async createIssue(options) {
    // Slack doesn't have native issues; create a message with issue-like formatting
    const { channel, title, description, priority } = options;
    const text = `*${title}*\n${description}${priority ? `\nPriority: ${priority}` : ''}`;
    return this.sendMessage({ channel, text });
  }

  getStatus() {
    const base = super.getStatus();
    return {
      ...base,
      method: this.webhookUrl ? 'webhook' : 'bot_token'
    };
  }
}

module.exports = { SlackIntegration };
