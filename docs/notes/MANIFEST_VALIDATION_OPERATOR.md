# Manifest Validation Operator Behavior

**Scope:** ELK-ORCA-PROD-004  
**Owner:** Orca Agent  
**Capability:** `orca.manifest`

## Purpose

The manifest validation contract ensures `manifests/app.manifest.json` always
conforms to the cross-app contract schema defined in `elkhedr-contracts`. A
valid manifest is required for Orca to participate in standalone mode and in the
composed Elkhedr platform.

## Runtime Path

The validation script is `scripts/validate-manifest.js`.

```text
npm run manifest
  -> node scripts/validate-manifest.js
  -> load elkhedr-contracts helper (installed package, workspace checkout,
     generated helper, or offline vendored snapshot)
  -> validate manifest schema and Orca-specific constraints
  -> on success: emit orca.manifest_validated event + app.manifest artifact
  -> on failure: emit orca.manifest_validation_failed event and exit 1
```

## Usage

```bash
# Validate the production manifest
npm run manifest

# Validate a custom manifest
node scripts/validate-manifest.js --manifest path/to/manifest.json

# Validate without emitting events/artifacts
node scripts/validate-manifest.js --no-events
```

## Validation Rules

The script checks:

1. Manifest JSON is valid and parseable.
2. Required top-level fields: `id`, `label`, `kind`, `version`, `standalone`,
   `routes`, `apiPrefixes`, `capabilityPrefixes`, `eventTypes`, `artifactTypes`,
   `integrationModes`.
3. `id` is `orca` and `kind` is `standalone_product_app`.
4. `apiPrefixes` includes `/api/orca`.
5. `pathFor('orcaStatus')` resolves to `/api/orca/status`.
6. All capability keys, event types, and artifact types stay inside the `orca.`
   namespace.

## Events and Artifacts

- Success event: `orca.manifest_validated`
- Failure event: `orca.manifest_validation_failed`
- Artifact type: `app.manifest`

On success, the script writes:

- An event to `data/events.jsonl` via the event bus.
- An artifact record to `data/manifest-artifacts.jsonl`.

## Security and Boundaries

- Manifest validation does not execute code, call external services, or modify
  source files.
- Unknown API prefixes, capability prefixes, event types, and artifact types are
  rejected.
- The offline vendored helper at `contracts/generated/javascript/contracts.cjs`
  is a fallback only; canonical contract changes flow through
  `elkhedr-contracts`.

## Verification

```bash
cd elkhedr-orca && npm run manifest
node --test tests/unit/manifest-validation.test.js
```

## Fixtures

Synthetic fixtures live in `tests/fixtures/manifests/`:

- `valid-app.manifest.json`
- `invalid-missing-id.manifest.json`
- `invalid-api-prefix.manifest.json`
- `invalid-event-namespace.manifest.json`
