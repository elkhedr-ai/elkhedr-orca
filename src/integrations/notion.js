/**
 * Notion Integration
 * Pages, databases, and comments via Notion API.
 */

const { BaseIntegration } = require('./base.js');

class NotionIntegration extends BaseIntegration {
  constructor(config = {}) {
    super({
      name: 'notion',
      baseUrl: 'https://api.notion.com/v1',
      ...config
    });
    this.token = config.credentials?.token || config.credentials?.NOTION_TOKEN;
  }

  getAuthHeaders() {
    if (this.token) {
      return {
        Authorization: `Bearer ${this.token}`,
        'Notion-Version': '2022-06-28'
      };
    }
    return {};
  }

  async testConnection() {
    if (!this.token) {
      return { success: false, error: 'No Notion token configured' };
    }

    const result = await this.request('/users/me');
    this.connected = result.ok;
    return {
      success: result.ok,
      name: result.data?.name,
      type: result.data?.type,
      error: result.ok ? null : 'Invalid token'
    };
  }

  async sendMessage(options) {
    // Notion doesn't have direct messaging; add a comment to a page
    const { pageId, text } = options;
    if (!pageId) {
      return { success: false, error: 'pageId required' };
    }

    const result = await this.request('/comments', {
      method: 'POST',
      body: {
        parent: { page_id: pageId },
        rich_text: [{ text: { content: text } }]
      }
    });

    return {
      success: result.ok,
      commentId: result.data?.id,
      error: result.data?.message
    };
  }

  async createIssue(options) {
    const { databaseId, title, properties, content } = options;
    if (!databaseId || !title) {
      return { success: false, error: 'databaseId and title required' };
    }

    const pageProperties = {
      title: { title: [{ text: { content: title } }] },
      ...properties
    };

    const children = content ? [{
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ text: { content } }] }
    }] : undefined;

    const result = await this.request('/pages', {
      method: 'POST',
      body: {
        parent: { database_id: databaseId },
        properties: pageProperties,
        ...(children && { children })
      }
    });

    return {
      success: result.ok,
      pageId: result.data?.id,
      url: result.data?.url,
      error: result.data?.message
    };
  }

  async updateIssue(issueId, updates) {
    const properties = {};
    if (updates.title) {
      properties.title = { title: [{ text: { content: updates.title } }] };
    }
    if (updates.properties) {
      Object.assign(properties, updates.properties);
    }

    const result = await this.request(`/pages/${issueId}`, {
      method: 'PATCH',
      body: { properties }
    });

    return {
      success: result.ok,
      pageId: result.data?.id,
      error: result.data?.message
    };
  }

  async listTargets() {
    if (!this.token) return [];

    const result = await this.request('/search', {
      method: 'POST',
      body: {
        filter: { value: 'database', property: 'object' },
        page_size: 100
      }
    });

    if (!result.ok) return [];

    return (result.data?.results || []).map(db => ({
      id: db.id,
      name: db.title?.[0]?.plain_text || 'Untitled',
      type: 'database',
      url: db.url
    }));
  }

  async appendToPage(pageId, blocks) {
    const result = await this.request(`/blocks/${pageId}/children`, {
      method: 'PATCH',
      body: { children: blocks }
    });

    return {
      success: result.ok,
      error: result.data?.message
    };
  }

  getStatus() {
    const base = super.getStatus();
    return {
      ...base,
      authenticated: !!this.token
    };
  }
}

module.exports = { NotionIntegration };
