const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const { EventBus } = require('../../src/events/bus.js');
const { MemoryEventStore } = require('../../src/events/store.js');

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'validate-manifest.js');
const FIXTURES_DIR = path.join(__dirname, '..', 'fixtures', 'manifests');
const ARTIFACTS_FILE = path.join(__dirname, '..', '..', 'data', 'manifest-artifacts.jsonl');
const EVENTS_FILE = path.join(__dirname, '..', '..', 'data', 'events.jsonl');

function runScript(args = []) {
  return execSync(`node ${SCRIPT_PATH} ${args.join(' ')}`, {
    encoding: 'utf8',
    cwd: path.join(__dirname, '..', '..'),
    env: { ...process.env, NODE_ENV: 'test' },
  });
}

function runScriptFails(args = []) {
  try {
    execSync(`node ${SCRIPT_PATH} ${args.join(' ')}`, {
      encoding: 'utf8',
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env, NODE_ENV: 'test' },
    });
    return null;
  } catch (error) {
    return error;
  }
}

describe('Manifest Validation contract', () => {
  beforeEach(() => {
    // Clean up event and artifact files produced by the script.
    for (const file of [ARTIFACTS_FILE, EVENTS_FILE]) {
      try {
        fs.unlinkSync(file);
      } catch {
        // Ignore if file does not exist.
      }
    }
  });

  afterEach(() => {
    for (const file of [ARTIFACTS_FILE, EVENTS_FILE]) {
      try {
        fs.unlinkSync(file);
      } catch {
        // Ignore.
      }
    }
  });

  it('validates the production manifest and emits event + artifact', () => {
    const output = runScript();
    assert.ok(output.includes('manifest ok: orca'));

    // Artifact record should be persisted.
    const artifacts = fs.readFileSync(ARTIFACTS_FILE, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));

    assert.strictEqual(artifacts.length, 1);
    assert.strictEqual(artifacts[0].app_id, 'orca');
    assert.strictEqual(artifacts[0].artifact_type, 'app.manifest');
    assert.ok(artifacts[0].uri.includes('app.manifest.json'));
    assert.strictEqual(artifacts[0].metadata.manifestId, 'orca');

    // Event should be persisted.
    const events = fs.readFileSync(EVENTS_FILE, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));

    const validatedEvents = events.filter((e) => e.type === 'orca.manifest_validated');
    assert.strictEqual(validatedEvents.length, 1);
    assert.strictEqual(validatedEvents[0].data.manifestId, 'orca');
    assert.strictEqual(validatedEvents[0].source, 'scripts/validate-manifest.js');
  });

  it('validates a valid fixture manifest', () => {
    const fixture = path.join(FIXTURES_DIR, 'valid-app.manifest.json');
    const output = runScript(['--manifest', fixture]);
    assert.ok(output.includes('manifest ok: orca'));
  });

  it('rejects a manifest with missing id', () => {
    const fixture = path.join(FIXTURES_DIR, 'invalid-missing-id.manifest.json');
    const error = runScriptFails(['--manifest', fixture]);
    assert.ok(error, 'Expected validation to fail');
    assert.ok(error.stdout.includes('manifest error') || error.stderr.includes('manifest error'));
    assert.ok(
      (error.stdout + error.stderr).includes('missing fields: id') ||
      (error.stdout + error.stderr).includes('id is required'),
      `Expected missing id error, got: ${error.stdout}${error.stderr}`
    );
  });

  it('rejects a manifest with invalid API prefix', () => {
    const fixture = path.join(FIXTURES_DIR, 'invalid-api-prefix.manifest.json');
    const error = runScriptFails(['--manifest', fixture]);
    assert.ok(error, 'Expected validation to fail');
    const output = error.stdout + error.stderr;
    assert.ok(output.includes('manifest error'));
    assert.ok(
      output.includes('apiPrefixes') || output.includes('/api/orca'),
      `Expected apiPrefixes error, got: ${output}`
    );
  });

  it('rejects a manifest with event outside app namespace', () => {
    const fixture = path.join(FIXTURES_DIR, 'invalid-event-namespace.manifest.json');
    const error = runScriptFails(['--manifest', fixture]);
    assert.ok(error, 'Expected validation to fail');
    const output = error.stdout + error.stderr;
    assert.ok(output.includes('manifest error'));
    assert.ok(
      output.includes('eventTypes') || output.includes('studio.some_event'),
      `Expected eventTypes error, got: ${output}`
    );
  });

  it('can skip event and artifact emission with --no-events', () => {
    const fixture = path.join(FIXTURES_DIR, 'valid-app.manifest.json');
    const output = runScript(['--manifest', fixture, '--no-events']);
    assert.ok(output.includes('manifest ok: orca'));

    assert.ok(!fs.existsSync(ARTIFACTS_FILE) || fs.readFileSync(ARTIFACTS_FILE, 'utf8').trim() === '');
  });

  it('emits manifest_validation_failed for invalid manifests', () => {
    const fixture = path.join(FIXTURES_DIR, 'invalid-missing-id.manifest.json');
    runScriptFails(['--manifest', fixture]);

    const events = fs.existsSync(EVENTS_FILE)
      ? fs.readFileSync(EVENTS_FILE, 'utf8')
          .split('\n')
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line))
      : [];

    const failedEvents = events.filter((e) => e.type === 'orca.manifest_validation_failed');
    assert.strictEqual(failedEvents.length, 1);
    assert.strictEqual(failedEvents[0].data.manifestId, 'unknown');
    assert.ok(failedEvents[0].data.error);
  });
});
