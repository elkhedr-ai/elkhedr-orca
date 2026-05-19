/**
 * GitHub Integration
 * Issues, PRs, and notifications via GitHub API.
 */

const { BaseIntegration } = require('./base.js');

class GitHubIntegration extends BaseIntegration {
  constructor(config = {}) {
    super({
      name: 'github',
      baseUrl: 'https://api.github.com',
      ...config
    });
    this.token = config.credentials?.token || config.credentials?.GITHUB_TOKEN;
  }

  getAuthHeaders() {
    if (this.token) {
      return {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github.v3+json'
      };
    }
    return {};
  }

  async testConnection() {
    if (!this.token) {
      return { success: false, error: 'No GitHub token configured' };
    }

    const result = await this.request('/user');
    this.connected = result.ok;
    return {
      success: result.ok,
      username: result.data?.login,
      error: result.ok ? null : 'Invalid token'
    };
  }

  async sendMessage(options) {
    // GitHub doesn't have direct messaging; create a comment on an issue
    const { repo, issueNumber, body } = options;
    if (!repo || !issueNumber) {
      return { success: false, error: 'repo and issueNumber required' };
    }

    const result = await this.request(`/repos/${repo}/issues/${issueNumber}/comments`, {
      method: 'POST',
      body: { body }
    });

    return {
      success: result.ok,
      commentId: result.data?.id,
      error: result.data?.message
    };
  }

  async createIssue(options) {
    const { repo, title, body, labels, assignees, milestone } = options;
    if (!repo) {
      return { success: false, error: 'repo required' };
    }

    const result = await this.request(`/repos/${repo}/issues`, {
      method: 'POST',
      body: {
        title,
        body,
        ...(labels && { labels }),
        ...(assignees && { assignees }),
        ...(milestone && { milestone })
      }
    });

    return {
      success: result.ok,
      issueNumber: result.data?.number,
      url: result.data?.html_url,
      error: result.data?.message
    };
  }

  async updateIssue(issueId, updates) {
    // issueId format: "owner/repo#123"
    const match = issueId.match(/^(.+?)\/(.+?)#(\d+)$/);
    if (!match) {
      return { success: false, error: 'issueId must be in format owner/repo#number' };
    }

    const [, owner, repo, number] = match;
    const result = await this.request(`/repos/${owner}/${repo}/issues/${number}`, {
      method: 'PATCH',
      body: updates
    });

    return {
      success: result.ok,
      issueNumber: result.data?.number,
      url: result.data?.html_url,
      error: result.data?.message
    };
  }

  async listTargets() {
    if (!this.token) return [];

    const result = await this.request('/user/repos?per_page=100&sort=updated');
    if (!result.ok) return [];

    return (result.data || []).map(repo => ({
      id: repo.full_name,
      name: repo.full_name,
      private: repo.private,
      description: repo.description
    }));
  }

  async createPullRequest(options) {
    const { repo, title, body, head, base } = options;
    if (!repo || !head) {
      return { success: false, error: 'repo and head branch required' };
    }

    const result = await this.request(`/repos/${repo}/pulls`, {
      method: 'POST',
      body: { title, body, head, base: base || 'main' }
    });

    return {
      success: result.ok,
      prNumber: result.data?.number,
      url: result.data?.html_url,
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

module.exports = { GitHubIntegration };
