# AGENTS.md - Plan Mode

## Architectural Constraints

**Stateful Session Design**: The `sessionStats` object (tui.js:22-31) maintains state across the entire session. Changes to `sandbox`, `level`, or `currentAgent` persist until explicitly reset or session ends.

**Tool Approval Workflow**: Terminal commands require user approval via `@clack/prompts` confirm dialog (core.js:65). This is a blocking operation that pauses execution until user responds.

**Recursive Tool Execution**: When tools are called, results are fed back into the LLM recursively (core.js:75). This means a single user query can trigger multiple API calls if tools are used.

## Model Routing Architecture

**Three-Tier Fallback System**: Every agent has Primary Model → Agent Fallback → Universal Fallback (`google/gemma-4-26b-a4b-it`). The universal fallback is hardcoded and cannot be changed without modifying core.js:12.

**Smart Level Auto-Routing**: When level is 'Auto', the system makes an extra API call to Gemma 4 to analyze complexity (core.js:96-99) before routing. This adds latency and cost.

**Direct Agent Mode Bypass**: Setting `sessionStats.currentAgent` completely bypasses the orchestrator and routes directly to a single agent. This is a session-wide state change, not per-query.

## Data Persistence Patterns

**Synchronous Analytics Writes**: Every API call writes to `data/analytics.json` synchronously (core.js:28). High-frequency usage could cause I/O bottlenecks.

**Unbounded History Growth**: `sessions/history.json` grows indefinitely with no cleanup mechanism (tui.js:216-227). Long-running sessions will accumulate large files.

**Auto-Created Files**: Both analytics and history files are created automatically if missing. Don't assume they exist when planning file operations.

## Command System Architecture

**Command Registry Pattern**: Commands are registered in `commands.js:CommandRegistry` class with execute callbacks. Adding new commands requires modifying the constructor (lines 18-80).

**Persistent vs Transient State**: `/agents` command creates persistent state that affects ALL subsequent queries. `/level` also persists. Most other commands are transient.

## Integration Points

**MCP Server Stdio Transport**: The `mcp-orca` binary uses stdio transport (mcp-server.js:57-58). This means it can only be used by MCP-compatible clients, not as a REST API.

**Binary Installation**: `npm link` creates global symlinks for both `orca` and `mcp-orca` (install.sh:42). Uninstalling requires `npm unlink` from the install directory.

**Environment Variable Precedence**: `.env` file is only created if missing AND `OPENROUTER_API_KEY` env var exists (install.sh:44-47). Existing .env files are never overwritten.