/**
 * Orca - Enterprise Multi-Agent AI Orchestration Platform
 * TypeScript declarations for public API
 */

// ==================== Core ====================

export interface SessionStats {
  level?: 'Auto' | 'Instant' | 'Thinking' | 'Swarm';
  sandbox?: boolean;
  currentAgent?: string | null;
}

export interface CallResponse {
  content: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  model: string;
  latency: number;
}

/**
 * Main orchestration function. Routes user prompts through the appropriate
 * intelligence level (Instant, Thinking, Swarm, or Auto).
 */
export function orchestrate(
  userPrompt: string,
  onEvent?: ((event: any) => void) | null,
  sessionStats?: SessionStats
): Promise<string>;

/**
 * Run a single agent directly, bypassing the orchestration router.
 */
export function runSingleAgent(
  agentId: string | number,
  prompt: string,
  onEvent?: ((event: any) => void) | null,
  sessionStats?: SessionStats
): Promise<string>;

/**
 * Make an API call to OpenRouter with retry logic and circuit breaker.
 */
export function callOpenRouter(
  model: string,
  messages: Array<{ role: string; content: string }>,
  fallbackModel?: string | null,
  sandbox?: boolean,
  agentRole?: string,
  useTools?: boolean
): Promise<CallResponse>;

// ==================== Cache ====================

export namespace cache {
  function init(redisUrl?: string): void;
  function get(namespace: string, id: string): Promise<any | null>;
  function set(namespace: string, id: string, value: any, ttlSeconds?: number): Promise<void>;
  function del(namespace: string, id: string): Promise<void>;
  function delPattern(namespace: string, pattern: string): Promise<void>;
  function remember(namespace: string, id: string, ttlSeconds: number, fetcher: () => Promise<any>): Promise<any>;
  function rememberQuery(namespace: string, query: Record<string, any>, ttlSeconds: number, fetcher: () => Promise<any>): Promise<any>;
}

// ==================== Agent Metrics ====================

export interface AgentMetricsData {
  agentRole: string;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  successRate: string;
  totalTokens: number;
  totalCost: number;
  avgLatencyMs: number | null;
  p50LatencyMs: number | null;
  p90LatencyMs: number | null;
  p95LatencyMs: number | null;
  p99LatencyMs: number | null;
  minLatencyMs: number | null;
  maxLatencyMs: number | null;
  tokensPerCall: number | null;
  costPerCall: string | null;
  lastCallAt: string | null;
  recentErrorTypes: Array<{ type: string; count: number }>;
  modelsUsed: Array<{ model: string; count: number }>;
}

export interface LeaderboardEntry extends AgentMetricsData {
  score: number;
  successScore: string;
  latencyScore: string;
  efficiencyScore: string;
}

export interface Underperformer {
  agentRole: string;
  currentModel: string;
  issues: string[];
  metrics: {
    successRate: string;
    p95LatencyMs: number | null;
    totalCalls: number;
    avgLatencyMs: number | null;
  };
  suggestion: string;
}

export class AgentMetrics {
  getAgentMetrics(agentRole: string): Promise<AgentMetricsData>;
  getAllAgentMetrics(): Promise<AgentMetricsData[]>;
  getLeaderboard(options?: { sortBy?: string; limit?: number }): Promise<LeaderboardEntry[]>;
  getUnderperformers(thresholds?: {
    minSuccessRate?: number;
    maxP95LatencyMs?: number;
    minCalls?: number;
  }): Promise<Underperformer[]>;
  recordCall(
    agentRole: string,
    data?: {
      tokens?: number;
      cost?: number;
      latencyMs?: number;
      success?: boolean;
      modelUsed?: string;
      errorType?: string;
    }
  ): Promise<void>;
}

export function getAgentMetrics(): AgentMetrics;

// ==================== Agent Leaderboard ====================

export interface RerouteDecision {
  agentRole: string;
  fromModel: string;
  toModel: string;
  issues: Array<{ type: string; value: any; threshold: any }>;
  timestamp: string;
}

export interface AgentComparison {
  agents: [AgentMetricsData, AgentMetricsData];
  comparison: {
    successRateDiff: string;
    latencyDiff: number;
    tokensDiff: number;
    costDiff: string;
    winner: string;
  };
}

export class AgentLeaderboard {
  autoRerouteEnabled: boolean;
  thresholds: {
    minSuccessRate: number;
    maxP95LatencyMs: number;
    minCallsForEvaluation: number;
    cooldownMs: number;
  };

  getLeaderboard(options?: { sortBy?: string; limit?: number }): Promise<LeaderboardEntry[]>;
  getAgentsNeedingAttention(): Promise<Array<Underperformer & { severity: string; canAutoReroute: boolean }>>;
  checkAndRecommend(agentRole: string): Promise<Underperformer | null>;
  executeAutoReroute(agentRole: string): Promise<{ success: boolean; decision?: RerouteDecision; reason?: string; note?: string }>;
  getRerouteHistory(limit?: number): RerouteDecision[];
  compareAgents(agentRoleA: string, agentRoleB: string): Promise<AgentComparison>;
}

export function getAgentLeaderboard(): AgentLeaderboard;

// ==================== Model Registry ====================

export type ModelHealth = 'HEALTHY' | 'UNHEALTHY' | 'UNKNOWN';
export type RoutingStrategy = 'balanced' | 'cost' | 'quality' | 'latency';

export interface ModelConfig {
  id: string;
  model: string;
  provider?: string;
  health: ModelHealth;
  metrics: {
    requests: number;
    successes: number;
    failures: number;
    consecutiveFailures: number;
    totalLatency: number;
    averageLatency: number | null;
    totalTokens: number;
    totalCost: number;
    lastUsed: string | null;
    lastSuccess: string | null;
    lastFailure: string | null;
  };
}

export class ModelRegistry {
  registerModel(config: Partial<ModelConfig>): void;
  getModel(idOrModel: string): ModelConfig | undefined;
  getModels(): ModelConfig[];
  getLocalModels(): ModelConfig[];
  buildFallbackChain(options: {
    preferredModel?: string;
    fallbackModels?: string[];
    fallbackModel?: string;
    universalFallback?: string;
  }): Array<{ model: string; id?: string }>;
  recordModelSuccess(idOrModel: string, data: { latency?: number; tokens?: number; cost?: number }): void;
  recordModelFailure(idOrModel: string, error: Error): void;
  scoreModel(idOrModel: string, strategy?: RoutingStrategy): number;
  getCostOptimizationSuggestions(): Array<{ current: string; suggested: string; savings: number }>;
  discoverLocalModels(): Promise<ModelConfig[]>;
}

export function getModelRegistry(): ModelRegistry;

// ==================== Billing ====================

export function calculateCost(tokens: number, modelId: string): number;

export interface QuotaResult {
  allowed: boolean;
  reason?: string;
  quota?: {
    status: string;
    highestPercent: number;
  };
}

export class QuotaManager {
  checkQuota(userId?: number): Promise<QuotaResult>;
  trackUsage(userId: number, tokens: number, cost: number): Promise<void>;
}

export function getQuotaManager(): QuotaManager;

// ==================== Database ====================

export class DatabaseManager {
  getAdapter(): DatabaseAdapter;
  updateAnalytics(taskId: number, tokens: number, cost: number): Promise<void>;
  getAnalyticsData(userId?: number): Promise<any>;
  getAgentUsageData(userId?: number): Promise<any[]>;
  getDailyAnalytics(limit?: number): Promise<any[]>;
  getWeeklyAnalytics(limit?: number): Promise<any[]>;
  getMonthlyAnalytics(limit?: number): Promise<any[]>;
}

export interface DatabaseAdapter {
  execute(sql: string, params?: any[]): Promise<any>;
  all(sql: string, params?: any[]): Promise<any[]>;
  get(sql: string, params?: any[]): Promise<any>;
  query(sql: string, params?: any[]): Promise<any[]>;
}

export function getDatabaseInstance(): Promise<DatabaseManager>;

// ==================== Errors ====================

export class APIError extends Error {
  constructor(message: string, context?: Record<string, any>);
  context: Record<string, any>;
}

export class ValidationError extends Error {
  constructor(message: string, context?: Record<string, any>);
  context: Record<string, any>;
}

export class ConfigError extends Error {
  constructor(message: string, context?: Record<string, any>);
  context: Record<string, any>;
}

export class AgentError extends Error {
  constructor(message: string, context?: Record<string, any>);
  context: Record<string, any>;
}

export class ToolExecutionError extends Error {
  constructor(message: string, context?: Record<string, any>);
  context: Record<string, any>;
}
