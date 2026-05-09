# Elkhedr Orca: Integration Guide (MCP)

Elkhedr Orca supports the **Model Context Protocol (MCP)**, allowing it to be used as a powerful toolset within Claude Code, Claude Desktop, and other IDEs.

## Claude Code Integration

### 1. Locate Config
Claude Code typically reads configuration from `~/.claude.json` or project-specific configs.

### 2. Add MCP Server
Add the `elkhedr-orca` server to your configuration:

```json
{
  "mcpServers": {
    "elkhedr-orca": {
      "command": "mcp-orca",
      "env": {
        "OPENROUTER_API_KEY": "YOUR_OPENROUTER_API_KEY"
      }
    }
  }
}
```

### 3. Usage
Once configured, you can call the Orca system directly from your Claude chat:
`"Ask orca to generate a product roadmap and initial backend schema."`

## CLI Usage
The system is also available as a standalone CLI:

```bash
orca "Your complex task here"
```

## Environment Variables
- `OPENROUTER_API_KEY`: Required for model access.
- `ORCA_LOG_LEVEL`: Set to `debug` for verbose orchestration logs.
