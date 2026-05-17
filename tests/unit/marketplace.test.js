/**
 * Tests for Skill Marketplace
 */

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { 
  installSkill, 
  uninstallSkill, 
  listInstalledSkills, 
  parseSource 
} = require('../../src/plugins/marketplace.js');
const { registry } = require('../../src/plugins/registry.js');

describe('Marketplace - Parse Source', () => {
  it('should parse GitHub repo URL', () => {
    const result = parseSource('https://github.com/user/repo/tree/main/skills/my-skill');
    assert.strictEqual(result.type, 'github');
    assert.strictEqual(result.user, 'user');
    assert.strictEqual(result.repo, 'repo');
    assert.strictEqual(result.subPath, 'skills/my-skill');
  });

  it('should parse GitHub raw URL', () => {
    const result = parseSource('https://raw.githubusercontent.com/user/repo/main/skills/my-skill');
    assert.strictEqual(result.type, 'github-raw');
    assert.strictEqual(result.user, 'user');
    assert.strictEqual(result.repo, 'repo');
    assert.strictEqual(result.branch, 'main');
  });

  it('should parse local absolute path', () => {
    const result = parseSource('/absolute/path/to/skill');
    assert.strictEqual(result.type, 'local');
    assert.ok(result.path.includes('skill'));
  });

  it('should parse local relative path', () => {
    const result = parseSource('./relative/path');
    assert.strictEqual(result.type, 'local');
    assert.ok(result.path.includes('relative'));
  });
});

describe('Marketplace - Install from Local', () => {
  const testInstallDir = path.join(__dirname, '../../tmp-marketplace-test');
  const testSourceDir = path.join(__dirname, '../../tmp-test-skill-source');

  beforeEach(() => {
    // Cleanup
    if (fs.existsSync(testInstallDir)) {
      fs.rmSync(testInstallDir, { recursive: true });
    }
    if (fs.existsSync(testSourceDir)) {
      fs.rmSync(testSourceDir, { recursive: true });
    }
    
    // Create test skill source
    fs.mkdirSync(testSourceDir, { recursive: true });
    fs.writeFileSync(
      path.join(testSourceDir, 'manifest.json'),
      JSON.stringify({
        name: 'test-marketplace-skill',
        version: '1.0.0',
        description: 'Test skill for marketplace',
        permissions: ['read'],
        category: 'custom'
      })
    );
    fs.writeFileSync(
      path.join(testSourceDir, 'index.js'),
      `module.exports = {
        execute: async () => 'test-result'
      };`
    );
    
    // Reset registry
    registry.reset();
  });

  after(() => {
    if (fs.existsSync(testInstallDir)) {
      fs.rmSync(testInstallDir, { recursive: true });
    }
    if (fs.existsSync(testSourceDir)) {
      fs.rmSync(testSourceDir, { recursive: true });
    }
  });

  it('should install skill from local path', async () => {
    const result = await installSkill(testSourceDir, {
      installDir: testInstallDir
    });
    
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.name, 'test-marketplace-skill');
    assert.strictEqual(result.version, '1.0.0');
    assert.ok(fs.existsSync(result.path));
  });

  it('should detect duplicate installation', async () => {
    await installSkill(testSourceDir, {
      installDir: testInstallDir
    });
    
    await assert.rejects(
      installSkill(testSourceDir, {
        installDir: testInstallDir
      }),
      /already exists/
    );
  });

  it('should allow force overwrite', async () => {
    await installSkill(testSourceDir, {
      installDir: testInstallDir
    });
    
    const result = await installSkill(testSourceDir, {
      installDir: testInstallDir,
      force: true
    });
    
    assert.strictEqual(result.success, true);
  });

  it('should throw for non-existent path', async () => {
    await assert.rejects(
      installSkill('/non/existent/path', {
        installDir: testInstallDir
      }),
      /not found/
    );
  });

  it('should throw for path without manifest', async () => {
    const badInstallDir = path.join(__dirname, '../../tmp-marketplace-bad');
    const badSourceDir = path.join(__dirname, '../../tmp-bad-source-no-manifest');
    
    // Cleanup
    if (fs.existsSync(badInstallDir)) {
      fs.rmSync(badInstallDir, { recursive: true });
    }
    if (fs.existsSync(badSourceDir)) {
      fs.rmSync(badSourceDir, { recursive: true });
    }
    
    fs.mkdirSync(badSourceDir, { recursive: true });
    fs.writeFileSync(path.join(badSourceDir, 'index.js'), 'module.exports = {}');
    fs.mkdirSync(badInstallDir, { recursive: true });
    
    await assert.rejects(
      installSkill(badSourceDir, {
        installDir: badInstallDir
      }),
      /manifest.json/
    );
    
    // Cleanup
    fs.rmSync(badInstallDir, { recursive: true });
    fs.rmSync(badSourceDir, { recursive: true });
  });
});

describe('Marketplace - Uninstall', () => {
  const testInstallDir = path.join(__dirname, '../../tmp-marketplace-uninstall');
  const testSourceDir = path.join(__dirname, '../../tmp-uninstall-skill');

  beforeEach(async () => {
    if (fs.existsSync(testInstallDir)) {
      fs.rmSync(testInstallDir, { recursive: true });
    }
    if (fs.existsSync(testSourceDir)) {
      fs.rmSync(testSourceDir, { recursive: true });
    }
    
    fs.mkdirSync(testSourceDir, { recursive: true });
    fs.writeFileSync(
      path.join(testSourceDir, 'manifest.json'),
      JSON.stringify({
        name: 'uninstall-test',
        version: '1.0.0',
        description: 'Test'
      })
    );
    fs.writeFileSync(
      path.join(testSourceDir, 'index.js'),
      'module.exports = { execute: async () => "" };'
    );
    
    registry.reset();
    await installSkill(testSourceDir, { installDir: testInstallDir });
  });

  after(() => {
    if (fs.existsSync(testInstallDir)) {
      fs.rmSync(testInstallDir, { recursive: true });
    }
    if (fs.existsSync(testSourceDir)) {
      fs.rmSync(testSourceDir, { recursive: true });
    }
  });

  it('should uninstall a skill', async () => {
    const result = await uninstallSkill('uninstall-test', {
      installDir: testInstallDir
    });
    
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.name, 'uninstall-test');
    assert.ok(!registry.has('uninstall-test'));
  });

  it('should throw for non-existent skill', async () => {
    await assert.rejects(
      uninstallSkill('non-existent', {
        installDir: testInstallDir
      }),
      /not found/
    );
  });
});

describe('Marketplace - List Skills', () => {
  const testInstallDir = path.join(__dirname, '../../tmp-marketplace-list');

  beforeEach(() => {
    if (fs.existsSync(testInstallDir)) {
      fs.rmSync(testInstallDir, { recursive: true });
    }
    fs.mkdirSync(testInstallDir, { recursive: true });
    
    // Create a couple test skills
    for (const name of ['skill-a', 'skill-b']) {
      const dir = path.join(testInstallDir, name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'manifest.json'),
        JSON.stringify({
          name,
          version: '1.0.0',
          description: `Skill ${name}`,
          permissions: ['read']
        })
      );
    }
  });

  after(() => {
    if (fs.existsSync(testInstallDir)) {
      fs.rmSync(testInstallDir, { recursive: true });
    }
  });

  it('should list installed skills', () => {
    const skills = listInstalledSkills({ installDir: testInstallDir });
    
    assert.strictEqual(skills.length, 2);
    assert.ok(skills.some(s => s.name === 'skill-a'));
    assert.ok(skills.some(s => s.name === 'skill-b'));
  });

  it('should return empty array for non-existent dir', () => {
    const skills = listInstalledSkills({ installDir: '/non/existent' });
    assert.deepStrictEqual(skills, []);
  });
});
