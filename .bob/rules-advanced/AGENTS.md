# AGENTS.md - Advanced Mode

## Advanced Mode Capabilities

**MCP Server Access**: Advanced mode can use the `mcp-orca` binary which exposes `orca_execute` tool via Model Context Protocol (mcp-server.js). This allows nested orchestration calls.

**Browser Automation**: Advanced mode has access to puppeteer-core (package.json:32) and chromium (package.json:25) for web scraping beyond simple cheerio parsing.

## Web Scraping Architecture

**Dual Scraping Strategy**: `skills.js` uses cheerio for simple HTML parsing (fetchUrl function), but puppeteer-core is available for JavaScript-heavy sites. Chromium binary must be installed separately.

**Google Search Scraping**: `webSearch()` in skills.js scrapes Google directly with User-Agent spoofing (line 30). This is fragile and may break if Google changes their HTML structure.

## Recursive Orchestration Risk

**MCP Tool Nesting**: The `orca_execute` MCP tool calls `orchestrate()` which can itself call tools. This creates potential for infinite recursion if an agent calls orca_execute with a prompt that triggers another orca_execute call.

**Tool Result Injection**: Tool results are injected back into the conversation (core.js:72-75) with role "tool". OpenRouter expects this format, but other providers may not support it.

## Session State Persistence

**Stateful Session Object**: `sessionStats` object in tui.js (lines 22-31) persists across multiple queries in the same session. Modifying it affects all subsequent calls until reset.

**Direct Agent Mode Persistence**: When `/agents` command sets `sessionStats.currentAgent`, ALL subsequent queries bypass orchestration until `/reset` is called. This is not obvious from the UI.

## Analytics Cost Estimation

**Hardcoded Cost Formula**: Analytics use `(tokens / 1000000) * 0.5` (core.js:51, tui.js:192, 208). This is NOT actual OpenRouter pricing - it's a rough estimate. Real costs vary by model.

## Environment Variable Handling

**Auto .env Creation**: install.sh creates `.env` from `OPENROUTER_API_KEY` env var if file doesn't exist (lines 44-47). This means the .env file may not match the current environment after installation.