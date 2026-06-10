# Elkhedr Orca 🐋

**Elkhedr Orca** is a massive, multi-agent orchestration system comprising 1 Super Orchestrator and 100 highly specialized subagents. It operates as a fully autonomous digital company capable of executing complex cross-domain tasks—from writing and coding to content creation, sales, and marketing.

## 🚀 One-Command Installation

```bash
curl -sSL https://raw.githubusercontent.com/ekagent/elkhedr-orca/main/install.sh | bash
```

## 🛠️ Usage

Once installed, you can call the Orca system from any terminal:

```bash
orca "Build a full-stack SaaS app and draft a marketing plan"
```

## Elkhedr App Split Contract

Orca remains a standalone app. Studio, OS, Memory, Omni, and Workspace must integrate
with it through MCP, bridge APIs, action approvals, events, and artifacts instead of
importing `elkhedr-orca/src` runtime modules.

Contract metadata lives at:

```bash
manifests/app.manifest.json
```

Local contract checks:

```bash
npm run build
npm run manifest
npm run health
node --check src/index.js
node --check src/mcp-server.js
bash -n install.sh
```

The `npm run build` step validates the app manifest against the vendored contract helper at `contracts/generated/javascript/contracts.cjs`.

Bridge action approvals live under `/api/orca/actions`. Dangerous actions such as shell
execution, file writes/deletes, desktop control, browser control, authenticated network
calls, and MCP calls are created as `pending_approval`; Orca only accepts a result after
an authenticated approval decision. Request, approval, rejection, and result transitions
are written to the tamper-evident audit log.

## 🏗️ Architecture

- **Super Orchestrator (CEO/COO):** Powered by `nvidia/nemotron-3-super-120b-a12b:free`.
- **100 Specialized Agents:** Covering Engineering, Design, Marketing, Sales, and Operations.
- **Model Routing:** Intelligent mapping across 50+ OpenRouter models (Gemma 4, Nemotron, Llama 3.3, Qwen 3, etc.).

## 📂 Project Structure

- `src/index.js`: The Orchestration Engine.
- `src/agents.json`: The 100-agent registry.
- `src/core.js`: Core orchestration with circuit breaker protection.
- `src/utils/`: Error handling, retry logic, logging, and circuit breaker.
- `install.sh`: The automated installer.

## 🔧 Features

- **Circuit Breaker Pattern**: Automatic failure detection and recovery for API calls
- **Structured Logging**: Pino-based logging with trace IDs and correlation
- **Retry Logic**: Exponential backoff with jitter for transient failures
- **Input Validation**: Zod schemas for all user inputs and configurations
- **100 Specialized Agents**: Each with primary and fallback models
- **Interactive TUI**: Rich terminal interface with real-time updates

## 📚 Documentation

- [Circuit Breaker Guide](docs/CIRCUIT_BREAKER.md) - Resilience and failure handling
- [Architecture Overview](docs/ARCHITECTURE.md) - System design and patterns
- [TUI Guide](docs/TUI_GUIDE.md) - Terminal interface usage
- [Agent Directory](docs/AGENT_DIRECTORY.md) - Complete agent catalog
- [Database Backup Guide](docs/BACKUP_GUIDE.md) - Backup/restore procedures

## 🛡️ License
ISC
