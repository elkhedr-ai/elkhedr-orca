const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { SandboxManager } = require('../../src/sandbox/index.js');
const { FilesystemSandbox } = require('../../src/sandbox/filesystem.js');

describe('Sandbox - Filesystem', () => {
  const testWorkspace = path.join(__dirname, '../../tmp-test-sandbox');
  let sandbox;

  before(async () => {
    // Clean up any previous test workspace
    if (fs.existsSync(testWorkspace)) {
      fs.rmSync(testWorkspace, { recursive: true });
    }
    sandbox = new FilesystemSandbox({
      workspace: testWorkspace,
      networkEnabled: false
    });
    await sandbox.initialize();
  });

  after(async () => {
    if (sandbox) {
      await sandbox.cleanup();
    }
    if (fs.existsSync(testWorkspace)) {
      fs.rmSync(testWorkspace, { recursive: true });
    }
  });

  it('should initialize workspace directories', () => {
    assert.ok(fs.existsSync(testWorkspace));
    assert.ok(fs.existsSync(path.join(testWorkspace, 'tmp')));
    assert.ok(fs.existsSync(path.join(testWorkspace, 'data')));
    assert.ok(fs.existsSync(path.join(testWorkspace, 'output')));
  });

  it('should write and read files within sandbox', async () => {
    await sandbox.writeFile('test.txt', 'hello world');
    const content = await sandbox.readFile('test.txt');
    assert.strictEqual(content, 'hello world');
  });

  it('should reject paths outside sandbox', async () => {
    await assert.rejects(
      sandbox.writeFile('../outside.txt', 'bad'),
      /outside sandbox/
    );
  });

  it('should list files in sandbox', async () => {
    const files = await sandbox.listFiles();
    assert.ok(files.includes('test.txt'));
  });

  it('should execute code in sandbox', async () => {
    const result = await sandbox.execute(`
      console.log('sandboxed output');
      console.error('sandboxed error');
    `);

    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.stdout.includes('sandboxed output'));
    assert.ok(result.stderr.includes('sandboxed error'));
  });

  it('should return status', () => {
    const status = sandbox.getStatus();
    assert.strictEqual(status.type, 'filesystem');
    assert.strictEqual(status.initialized, true);
    assert.strictEqual(status.networkEnabled, false);
  });
});

describe('Sandbox - Manager', () => {
  it('should create manager with default none type', () => {
    const manager = new SandboxManager();
    assert.strictEqual(manager.type, 'none');
    assert.strictEqual(manager.backend, null);
  });

  it('should create manager with filesystem type', async () => {
    const testWorkspace = path.join(__dirname, '../../tmp-test-sandbox-manager');
    const manager = new SandboxManager({
      type: 'filesystem',
      workspace: testWorkspace,
      networkEnabled: false
    });

    await manager.initialize();
    assert.ok(manager.backend);
    assert.strictEqual(manager.initialized, true);

    await manager.cleanup();
    if (fs.existsSync(testWorkspace)) {
      fs.rmSync(testWorkspace, { recursive: true });
    }
  });

  it('should execute code through manager', async () => {
    const testWorkspace = path.join(__dirname, '../../tmp-test-sandbox-exec');
    const manager = new SandboxManager({
      type: 'filesystem',
      workspace: testWorkspace,
      networkEnabled: false
    });

    const result = await manager.execute(`console.log('manager test');`);
    assert.strictEqual(result.exitCode, 0);
    assert.ok(result.stdout.includes('manager test'));

    await manager.cleanup();
    if (fs.existsSync(testWorkspace)) {
      fs.rmSync(testWorkspace, { recursive: true });
    }
  });

  it('should return status', async () => {
    const manager = new SandboxManager({ type: 'none' });
    const status = manager.getStatus();
    assert.strictEqual(status.type, 'none');
    assert.strictEqual(status.initialized, false);
  });
});

describe('Sandbox - Docker', () => {
  const { DockerSandbox } = require('../../src/sandbox/docker.js');

  it('should check Docker availability', async () => {
    const sandbox = new DockerSandbox({ workspace: './tmp-docker-test' });
    const available = await sandbox.checkDocker();
    // Don't assert true/false - Docker may or may not be available in test environment
    assert.strictEqual(typeof available, 'boolean');
  });

  it('should have correct status before init', () => {
    const sandbox = new DockerSandbox({
      workspace: './tmp-docker-test',
      networkEnabled: false,
      cpuLimit: '0.5',
      memoryLimit: '256m'
    });

    const status = sandbox.getStatus();
    assert.strictEqual(status.type, 'docker');
    assert.strictEqual(status.initialized, false);
    assert.strictEqual(status.networkEnabled, false);
    assert.strictEqual(status.cpuLimit, '0.5');
    assert.strictEqual(status.memoryLimit, '256m');
  });
});
