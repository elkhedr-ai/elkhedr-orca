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