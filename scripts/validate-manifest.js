#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const {
  pathFor,
  validateAppManifest,
} = require('../contracts/generated/javascript/contracts.cjs');

const manifestPath = path.join(__dirname, '..', 'manifests', 'app.manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

try {
  validateAppManifest(manifest, { appId: 'orca' });
  if (pathFor('orcaStatus') !== '/api/orca/status') {
    throw new Error('Orca status contract path mismatch');
  }
  if (pathFor('createOrcaActionRequest') !== '/api/orca/actions') {
    throw new Error('Orca action contract path mismatch');
  }
  if (pathFor('decideOrcaActionRequest', { actionId: 'test-action' }) !== '/api/orca/actions/test-action/approval') {
    throw new Error('Orca approval contract path mismatch');
  }
  if (pathFor('completeOrcaActionRequest', { actionId: 'test-action' }) !== '/api/orca/actions/test-action/result') {
    throw new Error('Orca result contract path mismatch');
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
console.log('manifest ok: orca');
