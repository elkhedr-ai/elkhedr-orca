# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Critical Architecture Patterns

**Tool Recursion Pattern**: When agents call tools (executeTerminal, webSearch, fetchUrl), the system recursively feeds tool results back into the LLM. This happens in `core.js:callOpenRouter()` lines 54-76. Tool calls MUST be approved by user for executeTerminal.

**Sandbox Security**: When `sessionStats.sandbox = true`, all operations are restricted to `~/elkhedr-orca-sandbox/`. The sandbox message is injected at line 40 in core.js. This is NOT enforced by the system - it's a prompt-level constraint only.

**Agent Direct Mode**: Setting `sessionStats.currentAgent` bypasses orchestration and routes ALL queries to a single agent. Reset with `/reset` command. This is a stateful session mode, not a one-time override.

**Smart Level Routing**: The `level` parameter ('Auto', 'Instant', 'Thinking', 'Swarm') determines orchestration depth. 'Auto' uses Gemma 4 to analyze complexity first (line 96-99 in core.js), then routes accordingly. This adds an extra API call.

## Non-Standard Dependencies

**Terminal Size Handling**: `terminal-size` package has dual export pattern - check if function or object with `.default` (tui.js:14-17). This prevents crashes on different Node versions.

**Regex Safety in TUI**: Custom `OrcaPrompt` class (tui.js:98-137) overrides enquirer's AutoComplete to prevent regex crashes from special characters. The `highlight()` method escapes all regex special chars.

**Word Wrapping**: Results MUST be wrapped using `word-wrap` package before boxing (tui.js:235-239) to prevent text overflow in terminal boxes.

## Model Fallback Chain

Every agent has a 3-tier fallback: Primary Model → Agent Fallback → Universal Fallback (`google/gemma-4-26b-a4b-it`). The universal fallback is hardcoded in core.js:12 and used when both primary and agent fallback fail.

## Analytics Persistence

Analytics are written synchronously to `data/analytics.json` on EVERY API call (core.js:15-30). File is created if missing. Cost calculation: `(tokens / 1000000) * 0.5` - this is a rough estimate, not actual OpenRouter pricing.

## Session History

Real session history is saved to `sessions/history.json` (tui.js:216-227) with full prompt, result, and metadata. This is NOT a mock - it persists across restarts.

## MCP Server Binary

The `mcp-orca` binary (package.json:8) exposes a single tool `orca_execute` via Model Context Protocol. It uses stdio transport and calls the same `orchestrate()` function as the CLI.

## Installation Gotchas

- `npm link` creates global symlinks for both `orca` and `mcp-orca` binaries
- Install script supports branch switching via `ORCA_BRANCH` env var
- `.env` file is auto-created from `OPENROUTER_API_KEY` env var if present
- Uses `npm ci` if package-lock.json exists, otherwise `npm install`

## Command System

Commands are registered in `commands.js:CommandRegistry` class. The `/agents` command enables "Direct Agent Mode" which persists until `/reset`. This is different from one-off agent selection.

## Tool Definitions

Tool schemas are defined in `skills.js:toolDefinitions` (lines 62-105) and injected into API calls when `useTools: true`. The system expects OpenRouter-compatible function calling format.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **elkhedr-orca** (3798 symbols, 7173 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
