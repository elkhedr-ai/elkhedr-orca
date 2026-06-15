#!/usr/bin/env node
/**
 * Manifest Validation Script
 *
 * Validates the Orca app manifest against the elkhedr-contracts helper and
 * emits the expected event and artifact for the Manifest Validation contract.
 *
 * Usage:
 *   npm run manifest
 *   node scripts/validate-manifest.js
 *   node scripts/validate-manifest.js --manifest path/to/manifest.json
 *   node scripts/validate-manifest.js --no-events
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('node:crypto');

const DEFAULT_MANIFEST_PATH = path.join(__dirname, '..', 'manifests', 'app.manifest.json');
const ARTIFACTS_FILE = path.join(__dirname, '..', 'data', 'manifest-artifacts.jsonl');

function parseArgs(argv) {
  const args = {
    manifestPath: DEFAULT_MANIFEST_PATH,
    emitEvents: true,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--manifest' || arg === '-m') {
      args.manifestPath = path.resolve(argv[i + 1]);
      i++;
    } else if (arg === '--no-events') {
      args.emitEvents = false;
    }
  }
  return args;
}

function fail(message, options = {}) {
  console.error(`manifest error: ${message}`);
  if (options.eventBus) {
    try {
      options.eventBus.publish('orca.manifest_validation_failed', {
        manifestId: options.manifestId || 'unknown',
        path: options.manifestPath,
        error: message,
      }, { source: 'scripts/validate-manifest.js' });
      options.eventBus.stop();
    } catch {
      // Ignore event emission errors during failure path.
    }
  }
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

function ensureArtifactsStorage() {
  const dir = path.dirname(ARTIFACTS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(ARTIFACTS_FILE)) {
    fs.writeFileSync(ARTIFACTS_FILE, '');
  }
}

function appendArtifact(record) {
  ensureArtifactsStorage();
  fs.appendFileSync(ARTIFACTS_FILE, JSON.stringify(record) + '\n');
}

function createEventBus() {
  const { getEventBus } = require('../src/events/bus.js');
  return getEventBus({ name: 'manifest-validation', persistenceEnabled: true });
}

async function main() {
  const args = parseArgs(process.argv);

  if (!fs.existsSync(args.manifestPath)) {
    fail(`manifest file not found: ${args.manifestPath}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(args.manifestPath, 'utf8'));
  } catch (error) {
    fail(`invalid JSON: ${error.message}`);
  }

  let eventBus = null;
  if (args.emitEvents) {
    try {
      eventBus = createEventBus();
    } catch (error) {
      console.warn(`warning: unable to initialize event bus: ${error.message}`);
    }
  }

  const eventContext = {
    eventBus,
    manifestId: manifest.id || 'unknown',
    manifestPath: args.manifestPath,
  };

  let source = null;
  let pathFor = null;
  let validateAppManifest = null;
  try {
    ({ pathFor, source, validateAppManifest } = loadContractsHelper());
    validateAppManifest(manifest, { appId: 'orca' });
  } catch (error) {
    fail(error.message, eventContext);
  }

  if (!manifest.apiPrefixes.includes('/api/orca')) {
    fail('apiPrefixes must include /api/orca', eventContext);
  }

  if (pathFor('orcaStatus') !== '/api/orca/status') {
    fail('Orca status contract path mismatch', eventContext);
  }

  const timestamp = new Date().toISOString();

  if (eventBus) {
    eventBus.publish('orca.manifest_validated', {
      manifestId: manifest.id,
      manifestPath: args.manifestPath,
      manifestVersion: manifest.version,
      source,
      validatedAt: timestamp,
    }, { source: 'scripts/validate-manifest.js' });

    // Persist artifact record for the validated manifest.
    const artifact = {
      id: randomUUID(),
      app_id: 'orca',
      artifact_type: 'app.manifest',
      title: `Validated manifest for ${manifest.id}`,
      uri: `file://${args.manifestPath}`,
      created_at: timestamp,
      metadata: {
        manifestId: manifest.id,
        version: manifest.version,
        source,
        validator: 'scripts/validate-manifest.js',
      },
    };
    appendArtifact(artifact);

    // Flush and stop the event bus so CLI scripts exit cleanly.
    eventBus.stop();
  }

  console.log(`manifest ok: ${manifest.id} (${source})`);
  process.exit(0);
}

main().catch((error) => {
  console.error(`manifest error: ${error.message}`);
  process.exit(1);
});
