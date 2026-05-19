/**
 * Discord Integration
 * Send messages via Discord webhook or bot token.
 */

const { BaseIntegration } = require('./base.js');

class DiscordIntegration extends BaseIntegration {
  constructor(config = {}) {
    super({
      name: 'discord',
      baseUrl: 'https://discord.com/api/v10',
      ...config
    });
    this.botToken = config.credentials?.botToken || config.credentials?.DISCORD_BOT_TOKEN;
    this.webhookUrl = config.credentials?.webhookUrl || config.credentials?.DISCORD_WEBHOOK_URL;
  }

  getAuthHeaders() {
    if (this.botToken) {
      return { Authorization: `Bot ${this.botToken}` };
    }
    return {};
  }

  async testConnection() {
    if (this.webhookUrl) {
      this.connected = true;
      return { success: true, method: 'webhook' };
    }

    if (!this.botToken) {
      return { success: false, error: 'No bot token or webhook URL configured' };
    }

    const result = await this.request('/users/@me');
    this.connected = result.ok;
    return {
      success: result.ok,
      username: result.data?.username,
      error: result.ok ? null : 'Invalid bot token'
    };
  }

  async sendMessage(options) {
    const { content, embeds, channelId } = options;

    // Use webhook if configured and no channel specified
    if (this.webhookUrl && !channelId) {
      return this._sendViaWebhook({ content, embeds });
    }

    if (!channelId) {
      return { success: false, error: 'channelId required for bot token mode' };
    }

    const result = await this.request(`/channels/${channelId}/messages`, {
      method: 'POST',
      body: { content, ...(embeds && { embeds }) }
    });

    return {
      success: result.ok,
      messageId: result.data?.id,
      error: result.data?.message
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

    const guildsResult = await this.request('/users/@me/guilds');
    if (!guildsResult.ok) return [];

    const targets = [];
    for (const guild of (guildsResult.data || [])) {
      const channelsResult = await this.request(`/guilds/${guild.id}/channels`);
      if (channelsResult.ok) {
        for (const ch of (channelsResult.data || [])) {
          if (ch.type === 0) { // Text channels
            targets.push({
              id: ch.id,
              name: `${guild.name} / #${ch.name}`,
              guildId: guild.id,
              guildName: guild.name
            });
          }
        }
      }
    }
    return targets;
  }

  async createIssue(options) {
    const { channelId, title, description, priority } = options;
    const embed = {
      title,
      description,
      color: priority === 'high' ? 0xff0000 : priority === 'medium' ? 0xffaa00 : 0x00ff00,
      fields: priority ? [{ name: 'Priority', value: priority, inline: true }] : []
    };
    return this.sendMessage({ channelId, embeds: [embed] });
  }

  getStatus() {
    const base = super.getStatus();
    return {
      ...base,
      method: this.webhookUrl ? 'webhook' : 'bot_token'
    };
  }
}

module.exports = { DiscordIntegration };
