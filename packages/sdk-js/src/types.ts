/**
 * Orca SDK Type Definitions
 */

export interface OrcaConfig {
  baseUrl: string;
  apiKey?: string;
  token?: string;
  timeout?: number;
}

export interface Agent {
  name: string;
  model: string;
  systemPrompt: string;
  skills: string[];
  fallbackModel?: string;
}

export interface Session {
  id: string;
  userId: number;
  agent: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;
  model?: string;
  tokens?: number;
}

export interface ChatRequest {
  message: string;
  agent?: string;
  level?: 'Auto' | 'Instant' | 'Thinking' | 'Swarm';
  sessionId?: string;
  sandbox?: boolean;
}

export interface ChatResponse {
  response: string;
  sessionId: string;
  agent: string;
  model: string;
  tokens: { input: number; output: number };
  cost: number;
  duration: number;
}

export interface Skill {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  enabled: boolean;
}

export interface Quota {
  limits: {
    tokens: number;
    operations: number;
    cost: number;
  };
  used: {
    tokens: number;
    operations: number;
    cost: number;
  };
  resetAt: string;
}

export interface Webhook {
  id: number;
  url: string;
  events: string[];
  active: boolean;
  description?: string;
  createdAt: string;
}

export interface Integration {
  id: number;
  provider: string;
  name: string;
  active: boolean;
  lastTestStatus?: string;
  createdAt: string;
}

export interface HealthStatus {
  status: string;
  version: string;
  uptime: number;
  components: Record<string, { status: string; latency?: number }>;
}

export interface ListResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ErrorResponse {
  error: string;
  message: string;
  details?: unknown;
}
