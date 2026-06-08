#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, '..', 'manifests', 'app.manifest.json');

function fail(message) {
  console.error(`manifest error: ${message}`);
  process.exit(1);
}

function requireArray(manifest, field) {
  if (!Array.isArray(manifest[field])) {
    fail(`${field} must be an array`);
  }
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const required = [
  'id',
  'label',
  'kind',
  'version',
  'standalone',
  'routes',
  'apiPrefixes',
  'capabilityPrefixes',
  'eventTypes',
  'artifactTypes',
  'integrationModes',
];

for (const field of required) {
  if (!(field in manifest)) {
    fail(`missing ${field}`);
  }
}

if (manifest.id !== 'orca') {
  fail('id must be orca');
}

if (!/^([0-9]+)\.([0-9]+)\.([0-9]+)(-[A-Za-z0-9.-]+)?$/.test(manifest.version)) {
  fail('version must be semver');
}

for (const field of ['routes', 'apiPrefixes', 'capabilityPrefixes', 'eventTypes', 'artifactTypes', 'integrationModes']) {
  requireArray(manifest, field);
}

for (const field of ['repo', 'downloadable', 'bootCommand', 'healthCheck']) {
  if (!(field in manifest.standalone)) {
    fail(`standalone.${field} is required`);
  }
}

if (!manifest.capabilityPrefixes.every((prefix) => prefix === 'orca.')) {
  fail('capabilityPrefixes must stay inside orca.*');
}

if (!manifest.apiPrefixes.includes('/api/orca')) {
  fail('apiPrefixes must include /api/orca');
}

if (!manifest.integrationModes.includes('standalone')) {
  fail('integrationModes must include standalone');
}

for (const eventType of manifest.eventTypes) {
  if (!eventType.startsWith('orca.')) {
    fail(`event type must use orca.*: ${eventType}`);
  }
}

for (const artifactType of manifest.artifactTypes) {
  if (!artifactType.startsWith('orca.')) {
    fail(`artifact type must use orca.*: ${artifactType}`);
  }
}

console.log(`manifest ok: ${manifest.id}`);
