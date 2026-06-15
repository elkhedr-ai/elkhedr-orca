# Contract Change Request Operator Behavior

**Scope:** ELK-ORCA-PROD-003  
**Owner:** Orca Agent  
**Capability:** `orca.contracts`

## What is a Contract Change Request?

A Contract Change Request (CCR) is a formal, auditable proposal to change a
cross-app contract that Orca owns or depends on. CCRs cover:

- `manifest` — app manifest entries (routes, API prefixes, capability prefixes)
- `openapi` — REST API paths and schemas
- `mcp_schema` — MCP tool schemas
- `event` — event types emitted by Orca
- `artifact` — artifact types produced by Orca
- `capability` — capability keys exposed by Orca
- `action` — action definitions and approval rules
- `boundary_policy` — standalone/composition boundary rules

## Lifecycle

```text
requester creates CCR
  -> action approval store marks it pending_approval (high risk)
  -> orca.contract_change_requested event emitted
  -> reviewer approves/rejects
       approved -> orca.contract_change_approved
       rejected -> orca.contract_change_rejected (terminal)
  -> requester attaches result
       success -> orca.contract_change_completed
       failure -> orca.contract_change_rejected
```

## REST API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/orca/contracts/change-requests` | List CCRs (auth required) |
| POST | `/api/orca/contracts/change-requests` | Create a CCR (auth + write scope) |
| GET | `/api/orca/contracts/change-requests/:requestId` | Read a CCR (auth required) |
| POST | `/api/orca/contracts/change-requests/:requestId/approval` | Approve or reject (auth + write scope) |
| POST | `/api/orca/contracts/change-requests/:requestId/result` | Attach result (auth + write scope) |

## Request Schema

```json
{
  "contractType": "manifest",
  "changeType": "add",
  "target": "orca.contract_change_requested",
  "description": "Add new event type to manifest.",
  "proposedValue": { "eventType": "orca.contract_change_requested" },
  "appId": "orca",
  "reason": "Required by ELK-ORCA-PROD-003.",
  "sessionId": "optional-session-id"
}
```

Validation rules:

- `contractType`, `changeType`, `target`, and `description` are required.
- `proposedValue` is required for `add` and `modify` changes.
- `appId` must be one of the known Elkhedr app IDs.
- CCRs are always high-risk and require approval.

## Events and Artifacts

- Events: `orca.contract_change_requested`, `orca.contract_change_approved`,
  `orca.contract_change_rejected`, `orca.contract_change_completed`
- Artifact type: `orca.contract_change_request`

## Security and Boundaries

- CCRs cannot bypass the action approval queue.
- Only actions with `actionType: 'contract.change_request'` can be read or
  decided through the CCR endpoints.
- All state transitions are audit-logged.
- Actual contract changes still flow through `elkhedr-contracts`; this runtime
  only captures the request, approval, and result lifecycle inside Orca.

## Verification

```bash
python3 scripts/validate-app-contracts.py
```

## Fixtures

Synthetic fixtures live in `tests/fixtures/contract-change-requests/` and are
used by `tests/unit/orca-contract-change-request.test.js`.
