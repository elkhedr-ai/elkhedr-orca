# Elkhedr Orca — Agent Development Guide

**Status:** PRODUCTION  
**Version:** 1.0.0  
**Date:** 2026-06-11  

---

## 1. Identity & Role

### Standalone Product Identity
Elkhedr Orca is the autonomous enterprise coding and product creation runtime. It operates as a local daemon or standalone CLI tool, running agentic loops to perform filesystem modifications, execute terminal commands, package applications, and run test suites.

### Composition System Role
Within the composed Elkhedr platform, Orca is the execution muscle. It registers its features as MCP (Model Context Protocol) tools and exposes endpoints to the Studio bridge (`/api/enterprise/orca`), allowing the Studio frontend or Omni workflows to trigger coding tasks, compile apps, and run diagnostics within a controlled loop.

---

## 2. Ownership & Boundaries

### Orca Owns:
- **Autonomous Task Engine:** Runs agentic loops, task planning, tool execution, and session management.
- **MCP Server Binary:** (`src/mcp-server.js`) - Translates internal functions to MCP tool schemas.
- **Execution Workspace:** The directory structure where autonomous code modifications occur.
- **Session & Run History:** Tracks logs, console prints, token usage, and cost aggregates.
- **API Namespace:** `/api/orca` (and local MCP bridge)
- **Capability Prefix:** `orca.*` (e.g., `orca.execute`, `orca.mcp_register`)

### Orca Does NOT Own:
- **Billing & Entitlements:** Plan checks, license signatures, subscription invoices (→ `elkhedr-os`).
- **Personalized Memory:** Persistent chat history database, facts storage, memory CRUD (→ `elkhedr-memory`).
- **Productivity Surfaces:** Main GUI panels, settings tabs, and analytical layouts (→ `elkhedr-studio`).
- **Company Operations:** SOP runs, department settings, run approval state machines (→ `elkhedr-omni`).
- **Office Files & Sync:** Word/Sheet/Deck structures, file exports, Drive/365 sync (→ `elkhedr-workspace-app`).

---

## 3. Critical Architecture Patterns

**Tool Recursion Pattern**: When agents call tools (executeTerminal, webSearch, fetchUrl), the system recursively feeds tool results back into the LLM. This happens in `core.js:callOpenRouter()` lines 54-76. Tool calls MUST be approved by user for executeTerminal.

**Sandbox Security**: When `sessionStats.sandbox = true`, all operations are restricted to `~/elkhedr-orca-sandbox/`. The sandbox message is injected at line 40 in core.js. This is NOT enforced by the system - it's a prompt-level constraint only.

**Agent Direct Mode**: Setting `sessionStats.currentAgent` bypasses orchestration and routes ALL queries to a single agent. Reset with `/reset` command. This is a stateful session mode, not a one-time override.

**Smart Level Routing**: The `level` parameter ('Auto', 'Instant', 'Thinking', 'Swarm') determines orchestration depth. 'Auto' uses Gemma 4 to analyze complexity first (line 96-99 in core.js), then routes accordingly. This adds an extra API call.

---

## 4. Non-Standard Dependencies

**Terminal Size Handling**: `terminal-size` package has dual export pattern - check if function or object with `.default` (tui.js:14-17). This prevents crashes on different Node versions.

**Regex Safety in TUI**: Custom `OrcaPrompt` class (tui.js:98-137) overrides enquirer's AutoComplete to prevent regex crashes from special characters. The `highlight()` method escapes all regex special chars.

**Word Wrapping**: Results MUST be wrapped using `word-wrap` package before boxing (tui.js:235-239) to prevent text overflow in terminal boxes.

---

## 5. Model Fallback Chain

Every agent has a 3-tier fallback: Primary Model → Agent Fallback → Universal Fallback (`google/gemma-4-26b-a4b-it`). The universal fallback is hardcoded in core.js:12 and used when both primary and agent fallback fail.

---

## 6. Analytics Persistence

Analytics are written synchronously to `data/analytics.json` on EVERY API call (core.js:15-30). File is created if missing. Cost calculation: `(tokens / 1000000) * 0.5` - this is a rough estimate, not actual OpenRouter pricing.

---

## 7. Session History

Real session history is saved to `sessions/history.json` (tui.js:216-227) with full prompt, result, and metadata. This is NOT a mock - it persists across restarts.

---

## 8. MCP Server Binary

The `mcp-orca` binary (package.json:8) exposes a single tool `orca_execute` via Model Context Protocol. It uses stdio transport and calls the same `orchestrate()` function as the CLI.

---

## 9. Installation Gotchas

- `npm link` creates global symlinks for both `orca` and `mcp-orca` binaries
- Install script supports branch switching via `ORCA_BRANCH` env var
- `.env` file is auto-created from `OPENROUTER_API_KEY` env var if present
- Uses `npm ci` if package-lock.json exists, otherwise `npm install`

---

## 10. Command System

Commands are registered in `commands.js:CommandRegistry` class. The `/agents` command enables "Direct Agent Mode" which persists until `/reset`. This is different from one-off agent selection.

---

## 11. Tool Definitions

Tool schemas are defined in `skills.js:toolDefinitions` (lines 62-105) and injected into API calls when `useTools: true`. The system expects OpenRouter-compatible function calling format.

---

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

---

## 12. Security & Agent Hardening

Because Orca runs shell commands, strict execution boundaries are required:
- **Sandbox Enforcement:** When running tasks, keep files strictly inside sandbox target folder.
- **User Approvals:** No executeTerminal, file write, or desktop automation tool can run without user consent and approval queue routing.
- **Outbound Network Protection:** Restrict API and curl executions to approved namespaces. Never send telemetry or code snippets to public LLM services outside configuration guidelines.
- **IP Protection:** Do not transmit Orca state machines, fallback architectures, or tool recursion patterns to training sets or providers.
- **Code Quality:** Keep CLI utilities lightweight. Clean up file handlers and ensure all spawned processes are terminated on run exit.
- **Cross-App Communication:** Use only MCP protocols or HTTP API routes to coordinate with Studio or OS.
