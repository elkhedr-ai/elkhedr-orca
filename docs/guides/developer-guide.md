# Developer Guide

Contributing to Orca: architecture, testing, and extension points.

## Development Setup

```bash
# Clone and install
git clone https://github.com/your-org/elkhedr-orca.git
cd elkhedr-orca
npm install

# Set up environment
cp .env.example .env
# Edit .env with your OpenRouter API key

# Run in development mode (auto-reload)
npm run server:dev

# Run tests
npm test
npm run test:unit
npm run test:integration
```

## Project Structure

```
elkhedr-orca/
├── src/
│   ├── index.js              # CLI entry point
│   ├── mcp-server.js         # MCP server entry
│   ├── core.js               # Orchestration engine
│   ├── agents.json           # Agent definitions (100+ agents)
│   ├── skills.js             # Tool registry and execution
│   ├── agents/
│   │   ├── custom.js         # Custom agent manager
│   │   ├── metrics.js        # Performance metrics
│   │   └── leaderboard.js    # Agent ranking
│   ├── auth/
│   │   ├── api-keys.js       # API key management
│   │   ├── jwt.js            # JWT authentication
│   │   └── rbac.js           # Role-based access
│   ├── billing/
│   │   ├── pricing.js        # Cost calculation
│   │   └── quotas.js         # Usage quotas
│   ├── cache/
│   │   └── index.js          # Redis cache layer
│   ├── config/
│   │   └── index.js          # Zod-validated config
│   ├── db/
│   │   ├── index.js          # Database manager
│   │   ├── schema.sql        # SQLite schema
│   │   ├── adapters/         # DB adapters (SQLite, Postgres)
│   │   └── migrations/       # Schema migrations
│   ├── memory/
│   │   └── manager.js        # Conversation memory
│   ├── models/
│   │   ├── registry.js       # Model registry + fallback
│   │   ├── health.js         # Health monitoring
│   │   └── local.js          # Ollama/LM Studio
│   ├── rag/
│   │   └── prompts.js        # RAG query engine
│   ├── server/
│   │   ├── index.js          # Fastify server
│   │   ├── graphql.js        # Apollo GraphQL
│   │   ├── health.js         # Health/readiness probes
│   │   ├── metrics.js        # Prometheus metrics
│   │   └── routes/           # REST API routes
│   ├── session/
│   │   └── manager.js        # Session management
│   ├── swarm/
│   │   ├── index.js          # Swarm orchestrator
│   │   ├── executor.js       # Parallel execution
│   │   ├── decomposer.js     # Task decomposition
│   │   └── aggregator.js     # Result aggregation
│   └── utils/
│       ├── circuit-breaker.js
│       ├── retry.js
│       └── logger.js
├── scripts/
│   ├── migrate.js            # JSON→DB migration
│   └── backup.sh             # Backup script
├── tests/
│   ├── unit/                 # Unit tests (48 files)
│   ├── integration/          # Integration tests
│   └── load/                 # Load tests (k6 + benchmark)
└── docs/                     # Documentation
```

## Architecture Patterns

### Orchestration Flow

```
User Prompt
    │
    ▼
┌─────────────┐
│  Validation  │  Zod schema check
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Quota Check  │  Billing limits
└──────┬──────┘
       │
       ▼
┌─────────────┐
│Auto Routing  │  Gemma complexity analysis (if level=auto)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Session    │  Load/create session, memory context
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  RAG Query   │  Vector store lookup (if enabled)
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────┐
│         Execution by Level           │
├──────────┬──────────┬───────────────┤
│ Instant  │ Thinking │    Swarm      │
│ (1 call) │ (1 call) │ (parallel)    │
└──────────┴──────────┴───────────────┘
```

### Tool Recursion

When agents call tools (executeTerminal, webSearch, fetchUrl), the system recursively feeds results back into the LLM. This happens in `core.js:callOpenRouter()`.

### Model Fallback

Every agent has a 3-tier fallback: Primary → Agent Fallback → Universal Fallback (`google/gemma-4-26b-a4b-it`). The model registry tracks health, latency, and cost per model.

### Circuit Breaker

Calls are wrapped in a circuit breaker (5 failures to open, 30s recovery). See `src/utils/circuit-breaker.js`.

## Testing

### Unit Tests

```bash
# Run all unit tests
npm run test:unit

# Run specific test
node --test tests/unit/cache.test.js

# With coverage
node --test --experimental-test-coverage tests/unit/**/*.test.js
```

### Integration Tests

```bash
npm run test:integration
```

### Load Tests

```bash
# Node.js benchmark (no dependencies)
npm run test:benchmark

# k6 load test (requires k6)
npm run test:load
npm run test:load:full
```

### Writing Tests

```javascript
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('MyFeature', () => {
  it('should do something', () => {
    assert.strictEqual(1 + 1, 2);
  });

  it('should handle async', async () => {
    const result = await myAsyncFunction();
    assert.ok(result);
  });
});
```

## Extension Points

### Adding a New Agent

Edit `src/agents.json`:

```json
{
  "id": 102,
  "role": "My Custom Agent",
  "model": "openai/gpt-4o",
  "department": "Engineering",
  "fallbackModel": "anthropic/claude-3-haiku"
}
```

### Adding a New Tool

In `src/skills.js`, add to `toolDefinitions`:

```javascript
{
  type: "function",
  function: {
    name: "my_tool",
    description: "Does something useful",
    parameters: {
      type: "object",
      properties: {
        input: { type: "string", description: "The input" }
      },
      required: ["input"]
    }
  }
}
```

Then add a handler in the `execute()` method.

### Adding a REST Route

Create `src/server/routes/my-route.js`:

```javascript
async function myRoutes(fastify, options) {
  fastify.get('/my-endpoint', {
    preHandler: [fastify.requireAuth],
    schema: { /* OpenAPI schema */ }
  }, async (request) => {
    return { data: 'hello' };
  });
}

module.exports = myRoutes;
```

Register in `src/server/index.js`:

```javascript
fastify.register(require('./routes/my-route.js'), { prefix: '/api/v1' });
```

### Adding a Database Migration

Create `src/db/migrations/004_my_migration.js`:

```javascript
exports.up = async function(knex) {
  await knex.schema.table('my_table', (table) => {
    table.string('new_column').nullable();
  });
};

exports.down = async function(knex) {
  await knex.schema.table('my_table', (table) => {
    table.dropColumn('new_column');
  });
};
```

## Code Style

- ES modules / CommonJS (Node.js compatible)
- 2-space indentation
- Single quotes for strings
- Trailing commas in multi-line
- JSDoc for public functions
- Error classes from `src/utils/errors.js`
- Logger from `src/utils/logger.js`

## Pull Request Checklist

- [ ] All tests pass (`npm test`)
- [ ] No syntax errors (`node --check src/file.js`)
- [ ] New routes have auth (`preHandler: [fastify.requireAuth]`)
- [ ] New DB columns have migrations
- [ ] Documentation updated if API changes
