const { gql } = require('graphql-tag');

const typeDefs = gql`
  type Query {
    # Health
    health: HealthStatus

    # Agents
    agents(department: String, limit: Int, offset: Int): [Agent!]!
    agent(id: ID!): Agent

    # Sessions
    sessions(limit: Int, offset: Int): [Session!]!
    session(id: ID!): Session

    # Analytics
    analytics: AnalyticsSummary
    analyticsDaily(limit: Int): [DailyAnalytics!]!
    analyticsWeekly(limit: Int): [WeeklyAnalytics!]!
    analyticsMonthly(limit: Int): [MonthlyAnalytics!]!

    # Users
    me: User
    user(id: ID!): User

    # Skills
    skills: [Skill!]!
    skill(id: ID!): Skill

    # Workspaces
    workspaces: [Workspace!]!
    workspace(id: ID!): Workspace

    # Costs
    costs(limit: Int): [Cost!]!

    # Audit
    auditLogs(limit: Int, eventType: String): [AuditLog!]!
  }

  type Mutation {
    # Auth
    register(input: RegisterInput!): AuthPayload!
    login(input: LoginInput!): AuthPayload!
    logout: Boolean!

    # Sessions
    createSession(input: CreateSessionInput!): Session!
    deleteSession(id: ID!): Boolean!

    # Agents
    createAgent(input: CreateAgentInput!): Agent!

    # API Keys
    createApiKey(input: CreateApiKeyInput!): ApiKey!
    revokeApiKey(id: ID!): Boolean!

    # Workspaces
    createWorkspace(input: CreateWorkspaceInput!): Workspace!
    inviteWorkspaceMember(workspaceId: ID!, email: String!, role: String!): Boolean!
  }

  type Subscription {
    # Real-time events
    eventCreated: Event!
    agentActivity: AgentActivity!
    costUpdated: Cost!
    sessionCreated: Session!
  }

  # Core Types
  type Agent {
    id: ID!
    name: String!
    role: String!
    model: String!
    fallbackModel: String
    department: String
    createdAt: String
    updatedAt: String
  }

  type Session {
    id: ID!
    prompt: String!
    mode: String!
    agent: String!
    result: String!
    tokens: Int!
    traceId: String
    createdAt: String
    userId: ID
  }

  type User {
    id: ID!
    username: String!
    email: String!
    role: String!
    createdAt: String
  }

  type Skill {
    id: ID!
    name: String!
    version: String!
    description: String
    permissions: [String!]
    createdAt: String
  }

  type Workspace {
    id: ID!
    name: String!
    slug: String!
    description: String
    ownerId: ID!
    billingPlan: String
    createdAt: String
  }

  type Cost {
    id: ID!
    taskId: ID!
    tokens: Int!
    cost: Float!
    createdAt: String
  }

  # Analytics Types
  type AnalyticsSummary {
    totalOperations: Int!
    totalTokens: Int!
    totalCost: Float!
    agentUsage: [AgentUsage!]!
  }

  type AgentUsage {
    role: String!
    calls: Int!
    tokens: Int!
    cost: Float!
  }

  type DailyAnalytics {
    date: String!
    totalOperations: Int!
    totalTokens: Int!
    totalCost: Float!
  }

  type WeeklyAnalytics {
    year: Int!
    week: Int!
    totalOperations: Int!
    totalTokens: Int!
    totalCost: Float!
  }

  type MonthlyAnalytics {
    year: Int!
    month: Int!
    totalOperations: Int!
    totalTokens: Int!
    totalCost: Float!
  }

  # Audit Types
  type AuditLog {
    id: ID!
    eventType: String!
    userId: ID
    action: String!
    status: String!
    resourceType: String
    resourceId: String
    metadata: String
    createdAt: String
  }

  # Event Types for Subscriptions
  type Event {
    id: ID!
    type: String!
    data: String
    createdAt: String
  }

  type AgentActivity {
    agentId: ID!
    action: String!
    timestamp: String!
    metadata: String
  }

  # Auth Types
  type AuthPayload {
    user: User!
    accessToken: String!
    refreshToken: String!
  }

  type ApiKey {
    id: ID!
    prefix: String!
    name: String
    scopes: [String!]!
    expiresAt: String
    createdAt: String
  }

  type HealthStatus {
    status: String!
    uptime: Float!
    timestamp: String!
  }

  # Input Types
  input RegisterInput {
    username: String!
    email: String!
    password: String!
    role: String
  }

  input LoginInput {
    usernameOrEmail: String!
    password: String!
  }

  input CreateSessionInput {
    prompt: String!
    mode: String!
    agent: String!
    result: String!
    tokens: Int
  }

  input CreateAgentInput {
    name: String!
    role: String!
    model: String!
    fallbackModel: String
    department: String
  }

  input CreateApiKeyInput {
    name: String!
    scopes: [String!]!
    expiresInDays: Int
  }

  input CreateWorkspaceInput {
    name: String!
    slug: String!
    description: String
  }
`;

module.exports = { typeDefs };
