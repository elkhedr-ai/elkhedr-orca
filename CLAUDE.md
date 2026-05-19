# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Elkhedr Orca is a multi-agent orchestration CLI/MCP system. One Super Orchestrator routes tasks across 100 specialized agents (5 departments: Engineering, Creative, Marketing, Sales, Operations) using OpenRouter for LLM access. Three entry points: CLI (`orca`), interactive TUI, and MCP server (`mcp-orca`).

## Commands

```bash
# Run
orca "prompt"              # Single-shot CLI
orca                       # Interactive TUI
node src/mcp-server.js     # MCP server (stdio transport)

# Test
npm test                                  # All tests (Node built-in test runner)
npm run test:unit                         # Unit tests only
npm run test:integration                  # Integration tests only
node --test tests/unit/specific.test.js   # Single test file
node --test --test-name-pattern "name"    # Single test by name

# Database
npm run db:migrate              # Run Knex migrations (PostgreSQL)
npm run db:migrate:down         # Rollback one migration
npm run db:migrate:status       # Show migration status
npm run db:migrate:make <name>  # Create new migration

# Health
npm run health    # Verify core.js imports cleanly
npm run version   # Print version
```

Tests use Node's built-in `node --test` runner (not Jest/Vitest). CI runs on Node 18.x and 20.x with `OPENROUTER_API_KEY=sk-test-key` and in-memory SQLite.

## Architecture

### Core Orchestration Flow

`src/core.js` is the brain. Two main paths:

1. **`orchestrate(prompt, onEvent, sessionStats)`** — Main flow: validates prompt (Zod) → classifies complexity if `Auto` level (via Gemma 4) → loads session/memory → prepares RAG context → calls `callOpenRouter()` → stores conversation back to memory.

2. **`runSingleAgent(agentId, prompt, onEvent, sessionStats)`** — Direct agent execution, bypasses orchestration.

**`callOpenRouter(model, messages, fallbackModel, sandbox, agentRole, useTools)`** — Makes API calls to OpenRouter with circuit breaker + retry + model fallback chain. When the LLM returns `tool_calls`, it executes them via the skills registry and **recursively calls itself** with tool results injected. User approval is required for `execute` permission tools.

### Orchestration Levels

| Level | Behavior |
|---|---|
| `Auto` | Gemma 4 classifies complexity, then routes to Instant/Thinking/Swarm |
| `Instant` | Single fast model call |
| `Thinking` | Deep reasoning with orchestrator model |
| `Swarm` | Multi-agent collaboration |

### Model Fallback Chain

Every agent has: Primary Model → Agent Fallback → Universal Fallback (`google/gemma-4-26b-a4b-it`, hardcoded in core.js:12). The `ModelRegistry` (`src/models/registry.js`) tracks health/latency/cost and builds fallback chains with routing strategies: `balanced`, `cost`, `quality`, `latency`.

### Skills/Plugin System

`src/skills.js` is a backward-compatible wrapper. Actual implementation:
- `src/plugins/registry.js` — `SkillRegistry` singleton. Skills register with manifest + implementation.
- `src/plugins/loader.js` — Scans `skills/` directory for `manifest.json` + `index.js` pairs. Supports hot-reload.
- `src/plugins/permissions.js` — Permission model (e.g., `execute` requires user confirmation).

Directory skills: `skills/terminal`, `skills/url-fetch`, `skills/web-search`. Bundled: `src/skills/knowledge-base.js`.

### Session & Memory

- `src/session/manager.js` — `getOrCreateSession()` / `updateSession()`, DB-backed via `src/session/store.js`
- `src/memory/manager.js` — Conversation memory per agent/session/user
- Sessions store: `level`, `sandbox`, `currentAgent` state

### Database

Dual support via adapter pattern (`src/db/adapters/`):
- **SQLite** (default, `better-sqlite3`) — schema in `src/db/schema.sql`
- **PostgreSQL** (production, `knex` + `pg`) — migrations in `src/db/migrations/`

`DatabaseManager` (`src/db/index.js`) is the singleton interface. Key tables: `tasks`, `sessions`, `session_stats`, `conversation_messages`, `knowledge_entries`, `analytics_*`, `input_history`.

### MCP Server

`src/mcp-server.js` exposes 6 tools via `@modelcontextprotocol/sdk` (stdio transport):
- `orca_execute` — Main task execution (calls `orchestrate()`)
- `orca_assign_task` — Direct agent assignment (calls `runSingleAgent()`)
- `orca_list_agents`, `orca_agent_status`, `orca_get_analytics`, `orca_get_health`

### Other Key Systems

- **Circuit breaker** (`src/utils/circuit-breaker.js`): 5 failure threshold, 2 success threshold, 60s timeout. Wraps all OpenRouter calls.
- **Event bus** (`src/events/bus.js`): Pub/sub with persistence, wildcard subscriptions, correlation IDs.
- **Task queue** (`src/queue/index.js`): In-memory priority queue with retries + dead letter queue.
- **Workflow DSL** (`src/workflows/dsl.js`): JSON-based workflows with standard, condition, parallel, and human-approval step types.
- **REST API** (`src/server/`): Fastify server with WebSocket, GraphQL (`@apollo/server`), Swagger docs.
- **Auth** (`src/auth/`): JWT, API keys, OAuth, RBAC middleware.
- **RAG** (`src/rag/`): Vector store + knowledge base retrieval for prompt enhancement.

## Configuration

Required: `OPENROUTER_API_KEY` in `.env` (copy from `.env.example`).

Key env vars: `ORCA_DB_TYPE` (sqlite/postgresql), `ORCA_LOG_LEVEL`, `ORCA_REDIS_URL`, `ORCA_PORT`, `ORCA_MODEL_ROUTING_STRATEGY`, `ORCA_SANDBOX`. Full list in `.env.example`.

Config is validated via Zod (`src/config/schema.js`) and supports hot-reload (`src/config/loader.js`).

## Common Pitfalls

- **Tool recursion**: Tool calls feed results back into the LLM recursively. Unbounded tool chains can spiral — the circuit breaker is the main guard.
- **Sandbox is prompt-level only**: When `sessionStats.sandbox = true`, the sandbox message is injected as a prompt constraint. It is NOT enforced by the system.
- **Agent Direct Mode is sticky**: Setting `sessionStats.currentAgent` via `/agents` persists until `/reset`. It bypasses orchestration entirely.
- **`terminal-size` package**: Has a dual export pattern — check if function or object with `.default` (tui.js:14-17).
- **Regex in TUI**: `OrcaPrompt` class (tui.js:98-137) escapes regex special chars to prevent crashes from user input.
- **Word wrapping required**: Results MUST be wrapped with `word-wrap` before boxing (tui.js:235-239) to prevent terminal overflow.
- **Analytics writes synchronously**: `data/analytics.json` is written on EVERY API call (core.js:15-30).

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **elkhedr-orca** (5559 symbols, 9906 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/elkhedr-orca/context` | Codebase overview, check index freshness |
| `gitnexus://repo/elkhedr-orca/clusters` | All functional areas |
| `gitnexus://repo/elkhedr-orca/processes` | All execution flows |
| `gitnexus://repo/elkhedr-orca/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
