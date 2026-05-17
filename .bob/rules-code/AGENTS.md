# AGENTS.md - Code Mode

## Code Editing Constraints

**No MCP/Browser Tools**: Code mode cannot use MCP servers or browser automation. Use `executeTerminal` tool for file operations, but it requires user approval.

**Agent Model Override**: When modifying `src/agents.json`, ensure fallback models differ from primary models (update-fallbacks.js:33-35). The system will crash if they're identical.

**TUI Custom Prompt**: The `OrcaPrompt` class (tui.js:98-137) overrides enquirer's AutoComplete. When modifying TUI prompts, maintain the `submit()` override that allows free text input when not starting with `/`.

**Tool Call Recursion**: If adding new tools to `skills.js`, remember the system recursively calls `callOpenRouter()` with tool results (core.js:75). Infinite loops are possible if tools call themselves.

**Analytics File Creation**: `updateAnalytics()` in core.js creates `data/analytics.json` if missing. Don't assume the file exists when reading it elsewhere.

## Testing Gotchas

**No Test Suite**: `package.json` has placeholder test script that exits with error. There's no testing infrastructure.

**Terminal Approval Required**: `executeTerminal` tool calls require user confirmation via `@clack/prompts` confirm dialog (core.js:65). Mock this in any test environment.

## Module System

**CommonJS Only**: `package.json` specifies `"type": "commonjs"`. All files use `require()` and `module.exports`. Don't use ES6 imports.

**Binary Shebangs**: Both `src/index.js` and `src/mcp-server.js` have `#!/usr/bin/env node` shebangs. These are required for `npm link` to work.

## Agent Registry Structure

**100 Agents + Orchestrator**: `src/agents.json` has 101 total entries - 1 orchestrator object + 100 agents array. Agent IDs start at 2 (orchestrator has no ID).

**Department-Based Fallbacks**: `update-fallbacks.js` assigns fallbacks by department. Engineering uses `qwen/qwen3-coder`, Creative uses `meta-llama/llama-3.3-70b-instruct`, etc.