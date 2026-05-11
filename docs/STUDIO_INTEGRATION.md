# Elkhedr Studio Integration

Elkhedr Orca remains a standalone application. Elkhedr Studio integrates it through
the Enterprise Orca bridge, which detects a local Orca checkout and registers Orca as
an MCP server. Studio should not import Orca runtime code into the Tauri/React bundle.

## Branch Contract
- Orca standalone branch: `main`
- Orca Studio bridge branch: `studio-enterprise-bridge`
- Studio integration branch: `studio-orca-enterprise-bridge`

Use `studio-enterprise-bridge` for integration metadata and installer/MCP contract work.
Merge changes into `main` only when they improve the standalone Orca product.

## New Device Setup
From an Elkhedr workspace checkout:

```bash
ORCA_BRANCH=studio-enterprise-bridge ./scripts/bootstrap-orca.sh
```

Or install Orca directly:

```bash
ORCA_BRANCH=studio-enterprise-bridge bash install.sh
```

## Studio Contract
- Status: `GET /api/enterprise/orca/status`
- Register MCP: `POST /api/enterprise/orca/register-mcp`
- Open folder: `POST /api/enterprise/orca/open`

The MCP endpoint can use the globally linked command:

```json
{
  "mcpServers": {
    "elkhedr-orca": {
      "command": "mcp-orca",
      "env": {
        "OPENROUTER_API_KEY": "${OPENROUTER_API_KEY}"
      }
    }
  }
}
```

For pinned source snapshots inside Studio, use a Git submodule rather than copying files:

```bash
git submodule add -b studio-enterprise-bridge https://github.com/ekagent/elkhedr-orca.git elkhedr-studio/src/enterprise/elkhedr-orca
git submodule update --init --recursive
```
