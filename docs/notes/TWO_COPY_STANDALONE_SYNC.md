# Two-Copy Standalone Sync Model

**Status:** In Use  
**Track:** Private Business Track  
**Classification:** Private Business Asset

Each app has two documentation copies:

1. **App-local standalone copy** inside the app repo.
2. **Parent coordinator mirror** inside `ELKHEDR_WORKSPACE/docs`.

This lets an agent clone only one app, develop and push that app independently, and later
sync the roadmap/research state back to the parent coordinator without cloning every app.

## Source Rules

| Work mode | Roadmap source to update first | Research source to update first | Report source |
| --- | --- | --- | --- |
| Standalone app clone only | `<app>/docs/plans/*_APP_PRODUCTION_ROADMAP.csv` | `<app>/docs/researches/*_APP_MARKET_RESEARCH.md` | `<app>/docs/reports/`, then mirror to parent when available |
| Parent workspace clone | App-local copy and parent mirror in the same change | App-local copy and parent mirror in the same change | `docs/reports/` parent mirror |
| Coordinator-only planning | `docs/plans/` parent mirror | `docs/research/` parent mirror | `docs/reports/` parent mirror |

## Agent Rules

1. In a standalone app clone, do not depend on the parent workspace being present.
2. Update the app-local CSV row after every completed task.
3. If the parent workspace is present, keep the parent mirror and app-local copy identical
   before handoff.
4. If the parent workspace is not present, note the changed roadmap rows in the app PR so
   the coordinator can mirror them later.
5. Never copy private runtime data, secrets, customer files, memory records, provider
   tokens, or raw prompts into roadmap, research, report, fixture, or event files.
6. Contract changes still go through `elkhedr-contracts`; app-local copies do not allow
   an app to invent incompatible APIs, capabilities, events, or artifacts.

## App Copy Locations

| App | App-local roadmap/research | Parent mirror |
| --- | --- | --- |
| OS | `elkhedr-os/docs/plans`, `elkhedr-os/docs/researches` | `docs/plans`, `docs/research` |
| Memory | `elkhedr-memory/docs/plans`, `elkhedr-memory/docs/researches` | `docs/plans`, `docs/research` |
| Studio | `elkhedr-studio/docs/plans`, `elkhedr-studio/docs/researches` | `docs/plans`, `docs/research` |
| Orca | `elkhedr-orca/docs/plans`, `elkhedr-orca/docs/researches` | `docs/plans`, `docs/research` |
| Omni | `elkhedr-omni/docs/plans`, `elkhedr-omni/docs/researches` | `docs/plans`, `docs/research` |
| Workspace | `elkhedr-workspace-app/docs/plans`, `elkhedr-workspace-app/docs/researches` | `docs/plans`, `docs/research` |
| Social | `elkhedr-social/docs/plans`, `elkhedr-social/docs/researches` | `docs/plans`, `docs/research` |
| Billing Cloud | `services/billing_cloud/docs/plans`, `services/billing_cloud/docs/researches` | `docs/plans`, `docs/research` |
| Cloud Portal | `services/cloud-portal/docs/plans`, `services/cloud-portal/docs/researches` | `docs/plans`, `docs/research` |
| Contracts | `elkhedr-contracts/docs/plans`, `elkhedr-contracts/docs/researches` | `docs/plans`, `docs/contracts` |

