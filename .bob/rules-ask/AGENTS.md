# AGENTS.md - Ask Mode

## Documentation Context

**100-Agent Corporate Structure**: The system models a complete digital company with 5 departments: Engineering (41 agents), Creative (16 agents), Marketing (15 agents), Sales (14 agents), Operations (16 agents). Agent IDs start at 2.

**Model Diversity**: Uses 50+ different OpenRouter models across agents. Each department has a preferred fallback model family (Engineering: Qwen Coder, Creative: Llama 3.3, Marketing: Gemma 4, Sales: GLM 4.5, Operations: Gemma 4).

**Orchestrator Model**: The CEO/COO orchestrator uses `nvidia/nemotron-3-super-120b-a12b` as primary, NOT a Gemma model. This is the only agent using Nemotron Super.

## Command System Nuances

**Persistent vs Transient Commands**: `/agents` command creates persistent state (Direct Agent Mode) that affects ALL subsequent queries. Most other commands are transient. This is not documented in command descriptions.

**Level vs Mode**: "Level" (Auto/Instant/Thinking/Swarm) is different from "Mode" (Direct Agent vs CEO Orchestration). Both affect routing but in different ways. Level is about complexity, Mode is about agent selection.

**Sandbox Prompt Injection**: Sandbox mode (toggled via `/sandbox`) only injects a system message - it doesn't actually restrict file system access. The restriction is prompt-based, not code-enforced.

## Session History Format

**Real Persistence**: `sessions/history.json` stores actual session data with timestamp, prompt, mode, agent, result, and tokens. This is NOT a mock file - it grows indefinitely and is never auto-cleaned.

**History Structure**: Each entry includes `mode` field which can be "DIRECT" or a level name ("Auto", "Instant", etc.). The `agent` field shows which agent handled the request (defaults to "CEO" for orchestration).

## Analytics Granularity

**Per-Agent Tracking**: Analytics track usage per agent role (not per agent ID). Multiple agents with same role would be aggregated. The `agentUsage` object keys are role strings, not IDs.

**Cost Projection Limitation**: The `/stats` command offers "Cost Projection" option but it's not implemented - selecting it does nothing. Only "Agent Usage Breakdown" and "Reset Analytics" work.

## TUI Rendering Constraints

**Terminal Width Dependency**: All boxen outputs calculate width based on terminal size (termSize() function). Resizing terminal mid-session can cause layout issues until next render.

**Gradient ASCII Art**: The ORCA splash screen (tui.js:47-55) uses gradient-string with hardcoded colors. It's centered based on terminal width at startup.