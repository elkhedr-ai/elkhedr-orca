# T43: Model Registry & Routing

Status: Done

## Summary

Implemented a centralized model registry that loads model assignments from `src/agents.json`, tracks health and runtime metrics, and routes requests across preferred models, explicit fallbacks, and the universal fallback.

## Implemented

- Added `src/models/health.js` with reusable health monitor support and a 60 second default interval.
- Reworked `src/models/registry.js` to centralize model definitions, aliases, health state, metrics, fallback chains, and routing scores.
- Integrated registry fallback chains into `src/core.js` so unhealthy models are skipped before OpenRouter calls.
- Added routing strategies for `balanced`, `cost`, `quality`, and `latency`.
- Added cost optimization suggestions from healthy lower-cost alternatives.
- Added model routing environment configuration in `src/config/schema.js`, `src/config/index.js`, and `.env.example`.
- Wired alert evaluation for `unhealthy_models` to the model registry.
- Expanded T43 unit coverage in `tests/unit/ai-infrastructure.test.js`.

## Verification

- `node --check src/models/registry.js`
- `node --check src/models/health.js`
- `node --check src/core.js`
- `node --test tests/unit/ai-infrastructure.test.js`

## Notes

- Health checks are explicit via `startHealthChecks()` or `runHealthChecks()`; they are not started at module import time to avoid network side effects in CLI startup and tests.
- Cost and quality profiles are estimates used for routing heuristics, not provider billing truth.
