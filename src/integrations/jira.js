/**
 * Jira Integration
 * Issues, comments, and project management via Jira API.
 */

const { BaseIntegration } = require('./base.js');

class JiraIntegration extends BaseIntegration {
  constructor(config = {}) {
    super({
      name: 'jira',
      ...config
    });
    this.baseUrl = config.credentials?.JIRA_BASE_URL || config.baseUrl || '';
    this.email = config.credentials?.email || config.credentials?.JIRA_EMAIL;
    this.apiToken = config.credentials?.apiToken || config.credentials?.JIRA_API_TOKEN;
  }

  getAuthHeaders() {
    if (this.email && this.apiToken) {
      const encoded = Buffer.from(`${this.email}:${this.apiToken}`).toString('base64');
      return { Authorization: `Basic ${encoded}` };
    }
    return {};
  }

  async testConnection() {
    if (!this.baseUrl || !this.email || !this.apiToken) {
      return { success: false, error: 'Jira base URL, email, and API token required' };
    }

    const result = await this.request('/rest/api/3/myself');
    this.connected = result.ok;
    return {
      success: result.ok,
      displayName: result.data?.displayName,
      emailAddress: result.data?.emailAddress,
      error: result.ok ? null : 'Authentication failed'
    };
  }

  async sendMessage(options) {
    // Jira doesn't have direct messaging; add a comment to an issue
    const { issueKey, body } = options;
    if (!issueKey) {
      return { success: false, error: 'issueKey required' };
    }

    const result = await this.request(`/rest/api/3/issue/${issueKey}/comment`, {
      method: 'POST',
      body: {
        body: {
          type: 'doc',
          version: 1,
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: body }]
          }]
        }
      }
    });

    return {
      success: result.ok,
      commentId: result.data?.id,
      error: result.data?.errorMessages?.[0]
    };
  }

  async createIssue(options) {
    const { projectKey, summary, description, issueType, priority, labels } = options;
    if (!projectKey || !summary) {
      return { success: false, error: 'projectKey and summary required' };
    }

    const result = await this.request('/rest/api/3/issue', {
      method: 'POST',
      body: {
        fields: {
          project: { key: projectKey },
          summary,
          description: description ? {
            type: 'doc',
            version: 1,
            content: [{
              type: 'paragraph',
              content: [{ type: 'text', text: description }]
            }]
          } : undefined,
          issuetype: { name: issueType || 'Task' },
          ...(priority && { priority: { name: priority } }),
          ...(labels && { labels })
        }
      }
    });

    return {
      success: result.ok,
      issueKey: result.data?.key,
      url: result.data?.self ? `${this.baseUrl}/browse/${result.data.key}` : null,
      error: result.data?.errorMessages?.[0]
    };
  }

  async updateIssue(issueId, updates) {
    const fields = {};
    if (updates.summary) fields.summary = updates.summary;
    if (updates.description) {
      fields.description = {
        type: 'doc',
        version: 1,
        content: [{
          type: 'paragraph',
          content: [{ type: 'text', text: updates.description }]
        }]
      };
    }
    if (updates.priority) fields.priority = { name: updates.priority };
    if (updates.labels) fields.labels = updates.labels;
    if (updates.status) {
      // Transition requires a separate API call
      await this.request(`/rest/api/3/issue/${issueId}/transitions`, {
        method: 'POST',
        body: { transition: { name: updates.status } }
      });
    }

    const result = await this.request(`/rest/api/3/issue/${issueId}`, {
      method: 'PUT',
      body: { fields }
    });

    return {
      success: result.ok,
      issueKey: issueId,
      error: result.data?.errorMessages?.[0]
    };
  }

  async listTargets() {
    if (!this.baseUrl || !this.apiToken) return [];

    const result = await this.request('/rest/api/3/project');
    if (!result.ok) return [];

    return (result.data || []).map(project => ({
      id: project.key,
      name: project.name,
      type: project.projectTypeKey
    }));
  }

  getStatus() {
    const base = super.getStatus();
    return {
      ...base,
      instanceUrl: this.baseUrl,
      email: this.email
    };
  }
}

module.exports = { JiraIntegration };
