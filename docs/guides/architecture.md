# Architecture Decision Records

Key design decisions and trade-offs in Orca.

## ADR-001: SQLite as Default Database

**Status:** Accepted

**Context:** Need a zero-config database that works out of the box for development and small deployments.

**Decision:** Use SQLite as the default with PostgreSQL as an optional upgrade.

**Consequences:**
- (+) No external dependencies for development
- (+) Single-file database, easy backups
- (+) WAL mode for concurrent reads
- (-) No native JSON column support (use TEXT)
- (-) Limited concurrent write performance
- Migration path: Set `DB_TYPE=postgres` and `DATABASE_URL`

---

## ADR-002: Model Fallback Chain

**Status:** Accepted

**Context:** API providers are unreliable. Models go down, rate limits hit, costs vary.

**Decision:** 3-tier fallback per agent: Primary Model → Agent Fallback → Universal Fallback.

**Consequences:**
- (+) Resilient to provider outages
- (+) Cost/quality/latency trade-off per agent
- (+) Automatic model health tracking
- (-) Increased complexity in model routing
- (-) Fallback models may have different capabilities

---

## ADR-003: Prompt-Level Sandbox

**Status:** Accepted

**Context:** Need sandboxing for terminal execution but don't want OS-level isolation overhead.

**Decision:** Inject a system prompt constraint (`sessionStats.sandbox = true`) that restricts operations to `~/elkhedr-orca-sandbox/`.

**Consequences:**
- (+) Lightweight, no container overhead
- (+) Works on all platforms
- (-) Not enforced by the system — relies on LLM compliance
- (-) Determined adversaries can bypass prompt constraints
- Trade-off: Acceptable for trusted users; not suitable for untrusted execution

---

## ADR-004: Swarm Parallel Execution

**Status:** Accepted

**Context:** Complex research tasks benefit from multiple agents working in parallel.

**Decision:** CEO agent decomposes tasks → subtasks run in parallel with `Promise.allSettled` → results aggregated.

**Consequences:**
- (+) Faster complex task completion
- (+) Diverse perspectives on research questions
- (+) Three aggregation strategies (voting, best-of-n, synthesis)
- (-) Higher token cost (multiple concurrent API calls)
- (-) 30s per-agent timeout may truncate complex tasks

---

## ADR-005: Circuit Breaker Pattern

**Status:** Accepted

**Context:** Repeated API failures should not cascade or waste resources.

**Decision:** Wrap all API calls in a circuit breaker (CLOSED → OPEN → HALF_OPEN).

**Consequences:**
- (+) Fast failure when provider is down
- (+) Automatic recovery probing
- (+) Configurable thresholds per model
- (-) May open prematurely on transient spikes

---

## ADR-006: Cache-Aside with Graceful Degradation

**Status:** Accepted

**Context:** Caching improves performance but should not be a hard dependency.

**Decision:** Redis cache with silent pass-through when unavailable. All cache operations return null on failure.

**Consequences:**
- (+) System works without Redis
- (+) Zero-downtime Redis upgrades
- (+) Configurable TTL per namespace
- (-) Cache misses are invisible (no monitoring of degradation)

---

## ADR-007: JWT + API Key Authentication

**Status:** Accepted

**Context:** Need authentication for REST API. Users want both interactive (JWT) and programmatic (API key) access.

**Decision:** JWT for interactive sessions, API keys for CI/CD and scripts. Both verified in the same middleware.

**Consequences:**
- (+) Two auth methods cover all use cases
- (+) API keys are hashed at rest
- (+) Scopes per API key
- (-) JWT secret rotation requires all clients to re-authenticate

---

## ADR-008: In-Memory Analytics with DB Sync

**Status:** Accepted

**Context:** Real-time metrics need to be fast. Database writes can lag.

**Decision:** MetricsCollector tracks counters in memory. Prometheus scrapes from memory. Agent metrics aggregate in DB asynchronously.

**Consequences:**
- (+) Fast metric reads (no DB query)
- (+) Prometheus-compatible output
- (-) Metrics lost on process restart
- (-) Two sources of truth (memory vs DB)

---

## ADR-009: Recursive Tool Execution

**Status:** Accepted

**Context:** Agents need to use tools (terminal, web search, URL fetch) and process results.

**Decision:** Tool results are fed back into the LLM as messages. The system recurses until the LLM produces a final response (no tool calls).

**Consequences:**
- (+) Multi-step tool workflows possible
- (+) LLM can reason about tool results
- (-) Unbounded recursion risk (mitigated by tool call limits)
- (-) Each recursion costs additional tokens

---

## ADR-010: Agent Performance Metrics and Auto-Rerouting

**Status:** Accepted

**Context:** Some agents consistently underperform due to model choice.

**Decision:** Track per-agent success rate, latency, and token efficiency. Auto-reroute underperforming agents to healthier models with a cooldown.

**Consequences:**
- (+) Data-driven model selection
- (+) Automatic adaptation to provider issues
- (+) Leaderboard for visibility
- (-) Auto-mutation disabled by default (safety)
- (-) Requires minimum 5 calls before evaluation
