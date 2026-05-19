# Orca Documentation

Orca is an enterprise-grade multi-agent AI orchestration platform with CLI, MCP, REST API, and GraphQL interfaces.

## Quick Links

| Guide | Description |
|-------|-------------|
| [Quick Start](guides/quickstart.md) | Get running in 5 minutes |
| [Admin Guide](guides/admin-guide.md) | Deployment, configuration, monitoring |
| [Developer Guide](guides/developer-guide.md) | Contributing, architecture, testing |
| [Architecture](guides/architecture.md) | Design decisions and trade-offs |
| [Migration](MIGRATION.md) | Migrate from v1 (JSON) to v2 (database) |
| [API Docs](openapi.yaml) | OpenAPI/Swagger specification |
| [Backup Guide](BACKUP_GUIDE.md) | Database backup and restore |

## Additional Documentation

- [Architecture Overview](ARCHITECTURE.md) — System components and data flow
- [Circuit Breaker](CIRCUIT_BREAKER.md) — Resilience patterns
- [TUI Guide](TUI_GUIDE.md) — Terminal UI usage
- [Studio Integration](STUDIO_INTEGRATION.md) — elkhedr-studio bridge
- [Integration Guide](INTEGRATION.md) — External tool integrations

## Interfaces

- **CLI**: `orca` — Interactive TUI, single-shot prompts, direct agent mode
- **MCP Server**: `mcp-orca` — Model Context Protocol for AI tool integration
- **REST API**: Fastify server on port 3000 with JWT + API key auth
- **GraphQL**: Apollo Server on port 4000 with WebSocket subscriptions

## Getting Help

```bash
orca --help           # CLI help
npm run docs:serve    # Local API docs at http://localhost:3000/docs
```
