#!/usr/bin/env python3
"""Validate Orca app contracts and integration boundaries.

This script is the verification step for ELK-ORCA-PROD-003 (Contract Change
Request) and related contract boundary tasks. It checks:

1. App manifest passes manifest validation.
2. Action approval contract tests pass.
3. Contract change request tests pass.
4. Manifest declares expected contract-related event and artifact types.
5. Contract change request module can be imported and its schemas are valid.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = ROOT / "manifests" / "app.manifest.json"


def run(command, **kwargs):
    """Run a shell command and return (returncode, stdout, stderr)."""
    result = subprocess.run(
        command,
        cwd=ROOT,
        text=True,
        capture_output=True,
        **kwargs,
    )
    return result.returncode, result.stdout, result.stderr


def check_manifest():
    """Run npm manifest validation."""
    print("Checking app manifest...")
    code, stdout, stderr = run(["npm", "run", "manifest"])
    if code != 0:
        print("FAIL: manifest validation failed")
        print(stdout)
        print(stderr, file=sys.stderr)
        return False
    print("OK: manifest validation passed")
    return True


def check_node_syntax(*paths):
    """Run node --check on the given files."""
    print(f"Checking Node.js syntax for {len(paths)} file(s)...")
    for p in paths:
        code, stdout, stderr = run(["node", "--check", str(p)])
        if code != 0:
            print(f"FAIL: syntax error in {p}")
            print(stderr, file=sys.stderr)
            return False
    print("OK: Node.js syntax checks passed")
    return True


def check_tests(*patterns):
    """Run node --test for the given test patterns."""
    print(f"Running tests for {len(patterns)} pattern(s)...")
    for pattern in patterns:
        code, stdout, stderr = run(["node", "--test", pattern])
        if code != 0:
            print(f"FAIL: tests failed for pattern {pattern}")
            print(stdout)
            print(stderr, file=sys.stderr)
            return False
    print("OK: contract tests passed")
    return True


def check_manifest_event_artifact_types():
    """Verify manifest declares contract change request events and artifacts."""
    print("Checking manifest event and artifact declarations...")
    manifest = json.loads(MANIFEST_PATH.read_text())

    expected_events = {
        "orca.contract_change_requested",
        "orca.contract_change_approved",
        "orca.contract_change_rejected",
        "orca.contract_change_completed",
    }
    expected_artifacts = {"orca.contract_change_request"}

    events = set(manifest.get("eventTypes", []))
    artifacts = set(manifest.get("artifactTypes", []))

    missing_events = expected_events - events
    missing_artifacts = expected_artifacts - artifacts

    if missing_events:
        print(f"FAIL: manifest missing event types: {sorted(missing_events)}")
        return False
    if missing_artifacts:
        print(f"FAIL: manifest missing artifact types: {sorted(missing_artifacts)}")
        return False

    print("OK: manifest declares contract change request events and artifacts")
    return True


def check_contract_change_request_module():
    """Verify the contract change request module loads and validates inputs."""
    print("Checking contract change request module...")
    script = """
const {
  createContractChangeRequest,
  validateContractChangeRequest,
  ContractChangeRequestError,
  CONTRACT_TYPES,
  CHANGE_TYPES,
} = require('./src/contracts/change-request.js');
const { getActionApprovalStore } = require('./src/actions/approval-store.js');

getActionApprovalStore().reset();

// Positive case
const action = createContractChangeRequest({
  contractType: 'manifest',
  changeType: 'add',
  target: 'orca.contract_change_requested',
  description: 'Add contract change request event to manifest.',
  proposedValue: { eventType: 'orca.contract_change_requested' },
  appId: 'orca',
}, { actor: { id: 'test', role: 'admin' } });

if (action.actionType !== 'contract.change_request') {
  throw new Error('Expected actionType contract.change_request, got ' + action.actionType);
}
if (action.status !== 'pending_approval') {
  throw new Error('Expected pending_approval status, got ' + action.status);
}
if (!action.events.some(e => e.event_type === 'orca.contract_change_requested')) {
  throw new Error('Expected orca.contract_change_requested event');
}

// Negative case: invalid contract type
try {
  validateContractChangeRequest({ contractType: 'invalid', changeType: 'add', target: 'x', description: 'x' });
  throw new Error('Expected validation error for invalid contractType');
} catch (error) {
  if (!(error instanceof ContractChangeRequestError)) {
    throw new Error('Expected ContractChangeRequestError, got ' + error.constructor.name);
  }
}

// Negative case: missing proposedValue for add
try {
  validateContractChangeRequest({ contractType: 'event', changeType: 'add', target: 'x', description: 'x' });
  throw new Error('Expected validation error for missing proposedValue');
} catch (error) {
  if (!(error instanceof ContractChangeRequestError)) {
    throw new Error('Expected ContractChangeRequestError, got ' + error.constructor.name);
  }
}

console.log('contract change request module OK');
"""
    code, stdout, stderr = run(["node", "-e", script])
    if code != 0:
        print("FAIL: contract change request module check failed")
        print(stdout)
        print(stderr, file=sys.stderr)
        return False
    print("OK: contract change request module check passed")
    return True


def main():
    os.environ.setdefault("NODE_ENV", "test")

    checks = [
        check_manifest,
        lambda: check_node_syntax(
            "src/contracts/change-request.js",
            "src/server/routes/orca-contracts.js",
            "src/server/index.js",
            "src/actions/approval-store.js",
        ),
        lambda: check_tests(
            "tests/unit/orca-action-contract.test.js",
            "tests/unit/orca-contract-change-request.test.js",
        ),
        check_manifest_event_artifact_types,
        check_contract_change_request_module,
    ]

    failures = 0
    for check in checks:
        try:
            if not check():
                failures += 1
        except Exception as error:
            print(f"FAIL: {check.__name__} raised {error}")
            failures += 1

    if failures:
        print(f"\n{failures} check(s) failed.")
        sys.exit(1)

    print("\nAll app contract checks passed.")
    sys.exit(0)


if __name__ == "__main__":
    main()
