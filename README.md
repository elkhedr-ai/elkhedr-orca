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
