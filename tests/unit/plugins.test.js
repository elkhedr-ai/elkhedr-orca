/**
 * Unit tests for skill plugin system
 */

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const { SkillRegistry, registry } = require('../../src/plugins/registry.js');
const { loadSkillFromDirectory, loadSkills } = require('../../src/plugins/loader.js');
const { skillManifestSchema } = require('../../src/plugins/schema.js');
const fs = require('fs');
const path = require('path');

describe('Skill Manifest Schema', () => {
  it('should validate a valid manifest', () => {
    const manifest = {
      name: 'test-skill',
      version: '1.0.0',
      description: 'A test skill',
      permissions: ['read', 'network']
    };
    
    const result = skillManifestSchema.parse(manifest);
    assert.strictEqual(result.name, 'test-skill');
    assert.strictEqual(result.version, '1.0.0');
    assert.deepStrictEqual(result.permissions, ['read', 'network']);
  });

  it('should apply defaults', () => {
    const manifest = {
      name: 'minimal-skill',
      version: '1.0.0',
      description: 'Minimal'
    };
    
    const result = skillManifestSchema.parse(manifest);
    assert.deepStrictEqual(result.permissions, []);
    assert.strictEqual(result.enabled, true);
    assert.strictEqual(result.entryPoint, 'index.js');
    assert.deepStrictEqual(result.dependencies, []);
  });

  it('should reject invalid names', () => {
    assert.throws(() => skillManifestSchema.parse({
      name: '123-invalid',
      version: '1.0.0',
      description: 'Test'
    }));
  });

  it('should reject invalid versions', () => {
    assert.throws(() => skillManifestSchema.parse({
      name: 'test',
      version: '1.0',
      description: 'Test'
    }));
  });
});

describe('Skill Registry', () => {
  let testRegistry;

  beforeEach(() => {
    testRegistry = new SkillRegistry();
  });

  it('should register a skill', () => {
    const manifest = {
      name: 'test-skill',
      version: '1.0.0',
      description: 'Test'
    };
    
    const implementation = {
      execute: async () => 'result'
    };
    
    testRegistry.register(manifest, implementation);
    assert.ok(testRegistry.has('test-skill'));
  });

  it('should execute a skill', async () => {
    const manifest = {
      name: 'echo',
      version: '1.0.0',
      description: 'Echo skill'
    };
    
    const implementation = {
      execute: async (args) => args.message
    };
    
    testRegistry.register(manifest, implementation);
    const result = await testRegistry.execute('echo', { message: 'hello' });
    assert.strictEqual(result, 'hello');
  });

  it('should get tool definitions', () => {
    const manifest = {
      name: 'test-tool',
      version: '1.0.0',
      description: 'Test'
    };
    
    const implementation = {
      execute: async () => 'done',
      toolDefinition: {
        type: 'function',
        function: {
          name: 'test-tool',
          description: 'Test tool'
        }
      }
    };
    
    testRegistry.register(manifest, implementation);
    const tools = testRegistry.getToolDefinitions();
    assert.strictEqual(tools.length, 1);
    assert.strictEqual(tools[0].function.name, 'test-tool');
  });

  it('should unregister a skill', () => {
    const manifest = {
      name: 'temp',
      version: '1.0.0',
      description: 'Temp'
    };
    
    testRegistry.register(manifest, { execute: async () => '' });
    assert.ok(testRegistry.has('temp'));
    
    testRegistry.unregister('temp');
    assert.ok(!testRegistry.has('temp'));
  });

  it('should reject duplicate registration', () => {
    const manifest = {
      name: 'dup',
      version: '1.0.0',
      description: 'Dup'
    };
    
    testRegistry.register(manifest, { execute: async () => '' });
    
    assert.throws(() => {
      testRegistry.register(manifest, { execute: async () => '' });
    });
  });

  it('should reject missing execute function', () => {
    assert.throws(() => {
      testRegistry.register(
        { name: 'bad', version: '1.0.0', description: 'Bad' },
        { notExecute: true }
      );
    });
  });

  it('should list skills', () => {
    testRegistry.register(
      { name: 'a', version: '1.0.0', description: 'A' },
      { execute: async () => '' }
    );
    testRegistry.register(
      { name: 'b', version: '2.0.0', description: 'B' },
      { execute: async () => '' }
    );
    
    const list = testRegistry.list();
    assert.strictEqual(list.length, 2);
    assert.ok(list.every(s => s.loaded));
  });

  it('should get stats', () => {
    testRegistry.register(
      { name: 's1', version: '1.0.0', description: 'S1' },
      { execute: async () => '' }
    );
    
    const stats = testRegistry.stats();
    assert.strictEqual(stats.total, 1);
    assert.deepStrictEqual(stats.skills, ['s1']);
  });
});

describe('Skill Loader', () => {
  const testDir = path.join(__dirname, '../../tmp-test-skills');

  beforeEach(() => {
    // Clean up test dir
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
    
    // Reset singleton registry
    registry.reset();
  });

  it('should load skill from directory', () => {
    const skillDir = path.join(testDir, 'test-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    
    fs.writeFileSync(
      path.join(skillDir, 'manifest.json'),
      JSON.stringify({
        name: 'test-skill',
        version: '1.0.0',
        description: 'Test skill'
      })
    );
    
    fs.writeFileSync(
      path.join(skillDir, 'index.js'),
      `module.exports = {
        execute: async (args) => 'result: ' + args.input
      };`
    );
    
    loadSkillFromDirectory(skillDir);
    
    assert.ok(registry.has('test-skill'));
  });

  it('should throw on missing manifest', () => {
    const skillDir = path.join(testDir, 'bad-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    
    fs.writeFileSync(
      path.join(skillDir, 'index.js'),
      'module.exports = {}'
    );
    
    assert.throws(() => {
      loadSkillFromDirectory(skillDir);
    }, /manifest.json/);
  });

  it('should load skills from directory', () => {
    // Create two test skills
    for (const name of ['skill-a', 'skill-b']) {
      const skillDir = path.join(testDir, name);
      fs.mkdirSync(skillDir, { recursive: true });
      
      fs.writeFileSync(
        path.join(skillDir, 'manifest.json'),
        JSON.stringify({
          name: name,
          version: '1.0.0',
          description: `Skill ${name}`
        })
      );
      
      fs.writeFileSync(
        path.join(skillDir, 'index.js'),
        `module.exports = {
          execute: async () => '${name}-result'
        };`
      );
    }
    
    loadSkills(testDir);
    
    assert.ok(registry.has('skill-a'));
    assert.ok(registry.has('skill-b'));
    
    const stats = registry.stats();
    assert.strictEqual(stats.total, 2);
  });

  // Cleanup after tests
  after(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });
});

describe('Built-in Skills', () => {
  beforeEach(() => {
    registry.reset();
  });

  it('should load built-in terminal skill', () => {
    const skillDir = path.join(__dirname, '../../skills/terminal');
    loadSkillFromDirectory(skillDir);
    
    assert.ok(registry.has('terminal'));
    
    const manifest = registry.getManifest('terminal');
    assert.ok(manifest.permissions.includes('execute'));
    assert.ok(manifest.permissions.includes('filesystem'));
  });

  it('should load built-in web-search skill', () => {
    const skillDir = path.join(__dirname, '../../skills/web-search');
    loadSkillFromDirectory(skillDir);
    
    assert.ok(registry.has('web-search'));
    
    const manifest = registry.getManifest('web-search');
    assert.ok(manifest.permissions.includes('network'));
  });

  it('should load built-in url-fetch skill', () => {
    const skillDir = path.join(__dirname, '../../skills/url-fetch');
    loadSkillFromDirectory(skillDir);
    
    assert.ok(registry.has('url-fetch'));
    
    const manifest = registry.getManifest('url-fetch');
    assert.ok(manifest.permissions.includes('network'));
  });

  it('should get tool definitions from all built-in skills', () => {
    loadSkills(path.join(__dirname, '../../skills'));
    
    const tools = registry.getToolDefinitions();
    assert.ok(tools.length >= 3);
    
    const names = tools.map(t => t.function.name);
    assert.ok(names.includes('terminal'));
    assert.ok(names.includes('web-search'));
    assert.ok(names.includes('url-fetch'));
  });
});
