# Orca Agent User Guide

**Track:** Private Business Track  
**Asset class:** Private Business Asset  
**App path:** `elkhedr-orca`  
**Capability prefix:** `orca.*`

## Source Of Truth

- Standalone roadmap CSV: `docs/plans/2026-06-15_ELKHEDR_ORCA_APP_PRODUCTION_ROADMAP.csv`
- Standalone research brief: `docs/researches/2026-06-15_ELKHEDR_ORCA_APP_MARKET_RESEARCH.md`
- Standalone sync guide: `docs/notes/TWO_COPY_STANDALONE_SYNC.md`
- Coordinator roadmap mirror: `../../../docs/plans/2026-06-15_ELKHEDR_ORCA_APP_PRODUCTION_ROADMAP.csv`
- Coordinator research mirror: `../../../docs/research/2026-06-15_ELKHEDR_ORCA_APP_MARKET_RESEARCH.md`
- Parent app map, when present: `../../../docs/notes/APP_SOURCE_OF_TRUTH_INDEX.md`
- Parent agent guide, when present: `../../../docs/agent-ops/apps/orca-agent.md`
- Manifest: `../../manifests/app.manifest.json`
- Existing Orca docs: `../README.md`, `../ARCHITECTURE.md`, and `../LAUNCH_GUIDE.md`
- Contracts: `../../../docs/contracts/README.md` and `../../../elkhedr-contracts`

## Ownership

Orca owns autonomous coding/product execution, CLI/MCP runtime, session state, action
requests, approvals, results, audit records, service status, and event projection feed.

Orca does not own OS entitlements, Studio UI, Memory storage, Omni operations policy,
Workspace files, Social messages, Billing Cloud secrets, or Cloud Portal UI.

## Agent Workflow

1. Read this guide, the Orca app-local roadmap CSV, and the Orca app-local research
   brief.
2. Run impact analysis before code-symbol edits when GitNexus guidance applies.
3. Keep risky actions behind approval queues; no shell, file write, desktop, MCP, or
   authenticated action should bypass approval.
4. Verify with `npm run manifest`, `npm test`, `node --check src/index.js`, and
   `node --check src/mcp-server.js`.
5. Update the app-local roadmap CSV row with status, evidence, and verification.
6. If the parent workspace is available, sync the app-local roadmap, research, and
   delivery report changes back to the coordinator mirror.

Never expose session histories, private repositories, secrets, or execution traces in
research docs, events, fixtures, or model prompts.
