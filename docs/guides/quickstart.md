# Quick Start Guide

Get Orca running in 5 minutes.

## Prerequisites

- Node.js >= 18.0.0
- An [OpenRouter](https://openrouter.ai) API key

## Install

```bash
# Clone the repository
git clone https://github.com/your-org/elkhedr-orca.git
cd elkhedr-orca

# Install dependencies
npm install

# Link globally (optional)
npm link
```

## Configure

```bash
# Set your API key
export OPENROUTER_API_KEY=sk-or-xxxx

# Or create a .env file
echo "OPENROUTER_API_KEY=sk-or-xxxx" > .env
```

## Run

### CLI Mode

```bash
# Interactive TUI
orca

# Single-shot prompt
orca "What is the capital of France?"

# Direct agent mode
orca --agent "Code Reviewer" "Review this function for bugs"
```

### Server Mode

```bash
# Start REST API + GraphQL server
npm start

# Or with auto-reload for development
npm run server:dev
```

Server starts at `http://localhost:3000` (REST) and `http://localhost:4000` (GraphQL).

### MCP Server

```bash
# For AI tool integration (Claude, etc.)
mcp-orca
```

## First API Call

```bash
# Register a user
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","email":"admin@example.com","password":"secure123","role":"admin"}'

# Login and get token
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"usernameOrEmail":"admin","password":"secure123"}' | jq -r .accessToken)

# List agents
curl http://localhost:3000/api/v1/agents -H "Authorization: Bearer $TOKEN"

# Create a session
curl -X POST http://localhost:3000/api/v1/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Hello, Orca!","mode":"instant"}'
```

## Intelligence Levels

| Level | Description | Use Case |
|-------|-------------|----------|
| Instant | Single call to fast model | Quick questions, simple tasks |
| Thinking | Single call to reasoning model | Analysis, code review |
| Swarm | Multi-agent parallel execution | Complex research, decomposition |
| Auto | AI routes based on complexity | Default, hands-off |

```bash
# CLI level selection
orca --level thinking "Analyze this codebase"

# API level selection
curl -X POST http://localhost:3000/api/v1/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Research AI trends","mode":"swarm"}'
```

## What's Next?

- [Admin Guide](admin-guide.md) — Deploy to production, configure monitoring
- [Developer Guide](developer-guide.md) — Contribute, extend, test
- [API Docs](../openapi.yaml) — Full REST API reference
