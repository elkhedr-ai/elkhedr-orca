const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

interface ApiOptions {
  headers?: Record<string, string>;
  body?: unknown;
}

export async function api<T>(path: string, method = 'GET', options: ApiOptions = {}): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export function login(usernameOrEmail: string, password: string) {
  return api<{ user: { id: number; username: string; email: string }; accessToken: string }>('/auth/login', 'POST', {
    body: { usernameOrEmail, password },
  });
}

export function register(username: string, email: string, password: string) {
  return api<{ user: { id: number }; accessToken: string }>('/auth/register', 'POST', {
    body: { username, email, password },
  });
}

export function logout() {
  return api('/auth/logout', 'POST');
}

export function getMe() {
  return api<{ user: { id: number; username: string; email: string; role: string } }>('/users/me');
}

export function getAgents(params?: { department?: string; limit?: number; offset?: number }) {
  const query = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
  return api<{ agents: Array<{ id: number; name: string; role: string; model: string; department: string }> }>(`/agents${query}`);
}

export function getSessions(params?: { limit?: number; offset?: number }) {
  const query = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : '';
  return api<{ sessions: Array<{ id: number; prompt: string; mode: string; agent: string; tokens: number; createdAt: string }> }>(`/sessions${query}`);
}

export function getAnalytics() {
  return api<{ analytics: { totalOperations: number; totalTokens: number; totalCost: number; agentUsage: Record<string, unknown> } }>('/analytics');
}

export { api };
