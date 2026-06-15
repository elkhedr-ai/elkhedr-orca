# Elkhedr Orca App Market Research

**Status:** Draft
**Created:** 2026-06-15
**Track:** Private Business Track
**Classification:** Private Business Asset
**Selected app:** `elkhedr-orca`
**Roadmap source of truth:** `docs/plans/2026-06-15_ELKHEDR_ORCA_APP_PRODUCTION_ROADMAP.csv`

## Decision

The next full production roadmap should be for `elkhedr-orca`.

Reason:

- Workspace, Social, Memory, Omni, OS, and Studio now have production roadmap packets.
  Orca is the remaining core standalone execution app in the current target topology.
- Orca already exists as a standalone CLI/MCP/runtime app with manifest validation,
  CLI/MCP entrypoints, action approval contracts, read-only event projection, audit
  concepts, sandbox modules, database/backups, agents, workflows, integrations, and
  service-mode routes.
- The market has moved from autocomplete to coding agents that can run commands, edit
  code, open pull requests, work in background environments, and connect to external
  tools through MCP.
- The production opportunity is not to claim unlimited autonomy. Orca should become the
  **governed enterprise execution runtime** for coding, product-building, MCP tools,
  agent teams, and approved actions.

## Product Introduction

Elkhedr Orca should become the **standalone enterprise multi-agent CLI, MCP, and
execution runtime** for Elkhedr.

It owns Orca sessions, runs, agent registry, CLI/TUI/MCP service, action
request/approval/result lifecycle, sandboxed execution, reports, audits, and `orca.*`
capabilities. It does not own Studio UI, OS launch/projection, Memory long-term context,
Omni SOP/process governance, Workspace documents, or Social data. It integrates through
MCP, bridge APIs, action approvals, event refs, artifact refs, and explicit handoff
packets.

The launch wedge:

```text
task request / ticket / Studio handoff / Omni approved action
  -> Orca session and run plan
  -> risk classification and sandbox selection
  -> tool/MCP/action approval queue
  -> bounded execution with logs, diffs, tests, and evidence
  -> result report, patch artifact, audit event, and optional PR/handoff
```

## Market Snapshot

Grand View Research estimates the global AI code tools market at USD 4.86B in 2023 and
projects USD 26.03B by 2030, a 27.1% CAGR from 2024 to 2030. Its AI agents outlook also
shows rapid growth: the U.S. AI agents market generated USD 2.229B in 2025 and is
expected to reach USD 46.331B by 2033. The market is attractive, but it is also becoming
crowded and security-sensitive.

The market is splitting into six lanes:

1. **Cloud coding agents**: OpenAI Codex and GitHub Copilot cloud agent run tasks in
   cloud environments, make code changes, and can create pull requests.
2. **Terminal/CLI agents**: Claude Code, Gemini CLI, Codex CLI, and similar tools run in
   local terminals with file, shell, and MCP access.
3. **Agentic IDEs**: Cursor, Windsurf, Devin Desktop, and Sourcegraph/Amp compete on
   repository context, code edits, test execution, debugging, and developer workflow.
4. **Autonomous software engineers**: Devin and related systems sell end-to-end task
   completion across tickets, bugs, internal tools, and enterprise workflows.
5. **Agent orchestration frameworks**: LangGraph, CrewAI, AutoGen-like systems, and
   workflow runtimes provide durable execution, multi-agent patterns, and tool routing.
6. **MCP/tool ecosystems**: MCP is becoming the standard way for AI apps to connect to
   tools and data, but security research and government guidance now emphasize
   authorization, least privilege, sandboxing, and careful deployment.

Contrarian evidence matters: enterprise adoption is constrained by security, shadow AI,
approval fatigue, permission sprawl, prompt/tool injection, MCP misconfiguration, and
unclear accountability. Orca must ship with governance first.

## Competitor Landscape

| Competitor | Current Signal | Implication For Elkhedr Orca |
| --- | --- | --- |
| OpenAI Codex | Codex can read, edit, and run code; Codex cloud works on background tasks in its own cloud environment. | Orca needs durable session/run state, branch/diff/test artifacts, background jobs, and clear local vs cloud execution modes. |
| Claude Code | Claude Code emphasizes explicit tool permissions, read-only defaults, approval rules, and sandboxing for safer autonomy. | Orca must implement action classes, approval rules, sandbox profiles, deny/ask/allow policies, and audit before broad autonomy. |
| GitHub Copilot cloud agent | Runs autonomously in a GitHub Actions-powered environment, researches repo, plans, changes code, and can open PRs. | Orca needs task-to-branch/patch/PR workflows, logs, session evidence, and integration boundaries. |
| Gemini CLI | Open-source terminal AI agent with ReAct loop, built-in tools, and local/remote MCP servers for coding tasks. | Orca needs a robust CLI/MCP server experience, tool registry, MCP auth, and predictable local workflows. |
| Cursor | Agentic IDE with privacy mode and enterprise data controls; positioned around repo context and developer flow. | Orca can differentiate outside IDE lock-in through CLI/MCP runtime, enterprise approvals, and cross-Elkhedr handoffs. |
| Devin | Autonomous AI software engineer that writes, runs, and tests code; enterprise positioning adds security/control. | Orca should target governed task execution with evidence, not unbounded claims of replacing engineers. |
| Sourcegraph / Amp | Competes on complete codebase context, search, navigation, MCP/API/CLI access, and enterprise controls. | Orca needs context acquisition, repo indexing strategy, and source-aware reports without exposing private code broadly. |
| LangGraph | Durable execution and human-in-the-loop orchestration for agent systems. | Orca needs resumable runs, checkpoints, state machines, replay, and failure recovery. |
| CrewAI | Multi-agent crews and flows for production-ready agent orchestration. | Orca can use multi-agent teams, but roles must be measurable, scoped, and auditable. |
| MCP ecosystem | MCP standardizes tool/data access, while authorization/security guidance highlights OAuth metadata, scopes, and deployment risk. | Orca must treat MCP as a high-risk tool boundary with allowlists, auth, per-tool policy, sandboxing, and audit. |

## Buyer Jobs

Real customers need Orca to:

- accept tasks from CLI, API, MCP, Studio, Omni, OS, or issue trackers
- understand a repository or product context without overexposing private code
- create a plan, classify risk, request approvals, and execute bounded steps
- safely read files, propose patches, run tests, and generate reports
- route tool actions through explicit approval and sandbox rules
- integrate MCP tools without giving uncontrolled access to shell, files, browser, or
  credentials
- produce patches, diffs, logs, test evidence, PR-ready summaries, and rollback notes
- run multiple agents or strategies only when they improve quality and are measurable
- support local-first/private operation and optional service/cloud modes
- support enterprise admins with RBAC, audit, quotas, secrets policy, incident response,
  and usage reports

## Product Thesis

Elkhedr Orca should become a **governed execution runtime for coding and product-building
agents**.

The v1 product must be useful without unsafe autonomy:

- CLI and MCP server that can start, list, inspect, and cancel runs
- bounded sessions with durable run state and evidence
- agent registry with roles, tools, model policy, and capability keys
- action approval queue for shell, file write/delete, browser, desktop, network, MCP,
  external system, and authenticated actions
- sandbox profiles for read-only, patch-only, test-only, network-off, MCP-off, and
  isolated workspace execution
- patch/diff/test/report artifacts
- tamper-evident audit and event feed for OS projection
- Studio/Omni/OS handoffs that pass refs and requests, not runtime imports

## Differentiation Strategy

Orca can compete by focusing on:

- **governed autonomy**: no high-risk action runs without policy and approval
- **CLI/MCP-first execution**: usable from terminal, service mode, and other apps
- **audit and evidence**: every run produces logs, diffs, tests, decisions, and reports
- **local-first/private mode**: useful for sensitive client work without cloud dependency
- **multi-agent only where measured**: agents are scored by outcomes, not counted as a
  marketing claim
- **cross-Elkhedr composition**: Studio designs/evaluates; Omni approves/governs; Orca
  executes; OS projects; Memory and Workspace provide refs through contracts

## Real-World Production Requirements

To become launch-ready, Orca must ship:

- standalone manifest, CLI, TUI, MCP server, service status, build/test/package checks,
  install verification, and resource modes
- `orca.*` capabilities, usage meters, event contracts, artifact contracts, OpenAPI/MCP
  schemas, and action approval lifecycle
- durable sessions/runs with state machine, checkpoints, retry, cancel, timeout,
  idempotency, and replayable evidence
- action approval queue with risk classification, policy, actor, reason, decision,
  result, and audit
- sandboxed tool execution with file, shell, browser, network, MCP, and credential
  restrictions
- model/provider routing with local/fake/cloud modes, budget controls, privacy controls,
  and redacted logs
- repo/task workflows for plan, patch, test, report, PR summary, rollback, and handoff
- agent registry, team routing, scoring, fallback, and leaderboard based on real metrics
- MCP authorization, tool allowlists, server registry, and per-tool risk controls
- enterprise governance: RBAC, quotas, audit export, secrets policy, incident response,
  backup/restore, and compliance readiness
- launch packs for coding agent, product builder, security review, docs generator, and
  workflow execution use cases

## Risks And Controls

| Risk | Control |
| --- | --- |
| Orca overclaims autonomy and disappoints customers | Position as governed execution runtime; measure success by completed tasks, accepted patches, tests, and evidence. |
| Agent writes or deletes unsafe files | Use sandbox profiles, path allowlists, diff preview, action approval, and rollback notes. |
| MCP tools expose shell, browser, or credentials | Require MCP authorization, tool allowlists, per-tool risk, scopes, audit, and default deny for high-risk tools. |
| Approval fatigue causes users to allow unsafe actions | Classify actions; default read-only; automate only low-risk actions; require strong context for high-risk approvals. |
| Model calls leak private code or secrets | Local/private modes, minimum-context prompts, redacted logs, no training/data-retention notes, and provider policy gates. |
| Multi-agent complexity lowers quality | Start with small measurable teams; require scorecards, evals, conflict handling, and fallback. |
| Long-running tasks fail silently | Durable run state, heartbeats, timeouts, retries, cancel, alerts, and postmortem reports. |
| Studio/Omni/OS integrations bypass boundaries | Use contracts, action requests, event refs, artifact refs, and deep links only. |

## Sources Reviewed

- Grand View Research, AI Code Tools Market:
  https://www.grandviewresearch.com/industry-analysis/ai-code-tools-market-report
- Grand View Research, U.S. AI Agents Market:
  https://www.grandviewresearch.com/horizon/outlook/ai-agents-market/united-states
- OpenAI Codex web:
  https://developers.openai.com/codex/cloud
- OpenAI Codex GitHub repository:
  https://github.com/openai/codex
- Claude Code permissions:
  https://code.claude.com/docs/en/permissions
- Claude Code security:
  https://code.claude.com/docs/en/security
- Anthropic, Claude Code sandboxing:
  https://www.anthropic.com/engineering/claude-code-sandboxing
- GitHub Copilot cloud agent:
  https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent
- GitHub Copilot coding agent announcement:
  https://github.blog/news-insights/product-news/github-copilot-meet-the-new-coding-agent/
- Gemini CLI documentation:
  https://developers.google.com/gemini-code-assist/docs/gemini-cli
- Google Gemini CLI announcement:
  https://blog.google/innovation-and-ai/technology/developers-tools/introducing-gemini-cli-open-source-ai-agent/
- Cursor data use and privacy:
  https://cursor.com/data-use
- Devin:
  https://devin.ai/
- Devin documentation:
  https://docs.devin.ai/get-started/devin-intro
- Sourcegraph:
  https://sourcegraph.com/
- Sourcegraph pricing:
  https://sourcegraph.com/pricing
- Model Context Protocol introduction:
  https://modelcontextprotocol.io/docs/getting-started/intro
- MCP authorization specification:
  https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- Anthropic, Introducing the Model Context Protocol:
  https://www.anthropic.com/news/model-context-protocol
- NSA, Model Context Protocol security design considerations:
  https://www.nsa.gov/Portals/75/documents/Cybersecurity/CSI_MCP_SECURITY.pdf
- NIST AI Risk Management Framework:
  https://www.nist.gov/itl/ai-risk-management-framework
