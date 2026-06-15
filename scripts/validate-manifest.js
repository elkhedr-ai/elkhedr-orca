#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, '..', 'manifests', 'app.manifest.json');

function fail(message) {
  console.error(`manifest error: ${message}`);
  process.exit(1);
}

function loadContractsHelper() {
  const candidates = [
    { label: 'installed elkhedr-contracts package', request: 'elkhedr-contracts' },
    {
      label: 'workspace elkhedr-contracts checkout',
      request: path.join(__dirname, '..', '..', 'elkhedr-contracts'),
    },
    {
      label: 'workspace generated contracts helper',
      request: path.join(
        __dirname,
        '..',
        '..',
        'elkhedr-contracts',
        'contracts',
        'generated',
        'javascript',
        'contracts.cjs',
      ),
    },
    {
      label: 'offline vendored contracts helper',
      request: path.join(__dirname, '..', 'contracts', 'generated', 'javascript', 'contracts.cjs'),
    },
  ];
  const errors = [];
  for (const candidate of candidates) {
    try {
      return { ...require(candidate.request), source: candidate.label };
    } catch (error) {
      errors.push(`${candidate.label}: ${error.message}`);
    }
  }
  throw new Error(`Unable to load elkhedr-contracts helper:\n${errors.join('\n')}`);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

let source = null;
let pathFor = null;
let validateAppManifest = null;
try {
  ({ pathFor, source, validateAppManifest } = loadContractsHelper());
  validateAppManifest(manifest, { appId: 'orca' });
} catch (error) {
  fail(error.message);
}

if (!manifest.apiPrefixes.includes('/api/orca')) {
  fail('apiPrefixes must include /api/orca');
}

if (pathFor('orcaStatus') !== '/api/orca/status') {
  fail('Orca status contract path mismatch');
}

console.log(`manifest ok: ${manifest.id} (${source})`);
