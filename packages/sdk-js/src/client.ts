/**
 * Orca SDK Client
 * Typed client for the Orca multi-agent orchestration API.
 */

import type {
  OrcaConfig,
  ChatRequest,
  ChatResponse,
  Agent,
  Session,
  Message,
  Skill,
  Quota,
  Webhook,
  Integration,
  HealthStatus,
  ListResponse,
  ErrorResponse
} from './types.js';

export class OrcaError extends Error {
  public readonly status: number;
  public readonly error: string;
  public readonly details?: unknown;

  constructor(status: number, error: string, message: string, details?: unknown) {
    super(message);
    this.name = 'OrcaError';
    this.status = status;
    this.error = error;
    this.details = details;
  }
}

export class OrcaClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly token?: string;
  private readonly timeout: number;

  constructor(config: OrcaConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.token = config.token;
    this.timeout = config.timeout || 30000;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Orca-SDK/1.0'
    };
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    return headers;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers: { ...this.getHeaders(), ...options.headers as Record<string, string> },
        signal: controller.signal
      });

      clearTimeout(timeout);

      const data = await response.json();

      if (!response.ok) {
        throw new OrcaError(
          response.status,
          (data as ErrorResponse).error || 'UnknownError',
          (data as ErrorResponse).message || `HTTP ${response.status}`,
          (data as ErrorResponse).details
        );
      }

      return data as T;
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof OrcaError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new OrcaError(0, 'Timeout', `Request timed out after ${this.timeout}ms`);
      }
      throw new OrcaError(0, 'NetworkError', (error as Error).message);
    }
  }

  // ── Health ──────────────────────────────────────────────────────────────

  async getHealth(): Promise<HealthStatus> {
    return this.request<HealthStatus>('/health');
  }

  // ── Chat / Orchestration ────────────────────────────────────────────────

  async chat(request: ChatRequest): Promise<ChatResponse> {
    return this.request<ChatResponse>('/api/v1/chat', {
      method: 'POST',
      body: JSON.stringify(request)
    });
  }

  async chatStream(request: ChatRequest): Promise<ReadableStream<string>> {
    const url = `${this.baseUrl}/api/v1/chat/stream`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new OrcaError(response.status, 'StreamError', (data as ErrorResponse).message || 'Stream failed');
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    return new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(decoder.decode(value, { stream: true }));
      }
    });
  }

  // ── Agents ──────────────────────────────────────────────────────────────

  async listAgents(): Promise<Agent[]> {
    return this.request<Agent[]>('/api/v1/agents');
  }

  async getAgent(name: string): Promise<Agent> {
    return this.request<Agent>(`/api/v1/agents/${encodeURIComponent(name)}`);
  }

  // ── Sessions ────────────────────────────────────────────────────────────

  async listSessions(): Promise<Session[]> {
    return this.request<Session[]>('/api/v1/sessions');
  }

  async getSession(id: string): Promise<Session & { messages: Message[] }> {
    return this.request<Session & { messages: Message[] }>(`/api/v1/sessions/${encodeURIComponent(id)}`);
  }

  async deleteSession(id: string): Promise<void> {
    await this.request(`/api/v1/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  // ── Skills ──────────────────────────────────────────────────────────────

  async listSkills(): Promise<Skill[]> {
    return this.request<Skill[]>('/api/v1/skills');
  }

  async getSkill(name: string): Promise<Skill> {
    return this.request<Skill>(`/api/v1/skills/${encodeURIComponent(name)}`);
  }

  // ── Billing & Quotas ────────────────────────────────────────────────────

  async getQuota(): Promise<{ quota: Quota; warning: string | null }> {
    return this.request('/api/v1/billing/quotas/me');
  }

  async getUsageHistory(limit = 50): Promise<{ usage: unknown[] }> {
    return this.request(`/api/v1/billing/usage/me?limit=${limit}`);
  }

  // ── Webhooks ────────────────────────────────────────────────────────────

  async listWebhooks(): Promise<{ webhooks: Webhook[] }> {
    return this.request('/api/v1/webhooks');
  }

  async createWebhook(config: { url: string; events: string[]; description?: string }): Promise<{ webhook: Webhook }> {
    return this.request('/api/v1/webhooks', {
      method: 'POST',
      body: JSON.stringify(config)
    });
  }

  async deleteWebhook(id: number): Promise<void> {
    await this.request(`/api/v1/webhooks/${id}`, { method: 'DELETE' });
  }

  // ── Integrations ────────────────────────────────────────────────────────

  async listIntegrations(): Promise<{ integrations: Integration[] }> {
    return this.request('/api/v1/integrations');
  }

  async registerIntegration(config: { provider: string; credentials: Record<string, string>; name?: string }): Promise<{ integration: Integration }> {
    return this.request('/api/v1/integrations', {
      method: 'POST',
      body: JSON.stringify(config)
    });
  }

  async testIntegration(id: number): Promise<{ success: boolean; error?: string }> {
    return this.request(`/api/v1/integrations/${id}/test`, { method: 'POST' });
  }

  async executeIntegrationAction(id: number, action: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return this.request(`/api/v1/integrations/${id}/actions`, {
      method: 'POST',
      body: JSON.stringify({ action, params })
    });
  }
}
