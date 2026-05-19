/**
 * Tests for CustomAgentManager
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { CustomAgentManager, AGENT_TEMPLATES, CUSTOM_AGENTS_PATH } = require('../../src/agents/custom.js');

// Use a temp path for tests
const TEST_AGENTS_PATH = path.join(__dirname, '..', '..', 'src', 'agents', 'custom-agents.test.json');

class TestCustomAgentManager extends CustomAgentManager {
  constructor() {
    super();
    this.customAgentsPath = TEST_AGENTS_PATH;
    this.customAgents = { agents: [], nextId: 1001 };
  }

  _loadCustomAgents() {
    try {
      if (fs.existsSync(TEST_AGENTS_PATH)) {
        return JSON.parse(fs.readFileSync(TEST_AGENTS_PATH, 'utf8'));
      }
    } catch { /* ignore */ }
    return { agents: [], nextId: 1001 };
  }

  _saveCustomAgents() {
    fs.writeFileSync(TEST_AGENTS_PATH, JSON.stringify(this.customAgents, null, 2));
  }
}

describe('CustomAgentManager', () => {
  let manager;

  beforeEach(() => {
    // Clean up any leftover test file
    try { fs.unlinkSync(TEST_AGENTS_PATH); } catch { /* ok */ }
    manager = new TestCustomAgentManager();
  });

  afterEach(() => {
    try { fs.unlinkSync(TEST_AGENTS_PATH); } catch { /* ok */ }
  });

  // ---- Templates ----

  describe('AGENT_TEMPLATES', () => {
    it('should have 8 predefined templates', () => {
      assert.strictEqual(AGENT_TEMPLATES.length, 8);
    });

    it('each template should have required fields', () => {
      for (const t of AGENT_TEMPLATES) {
        assert.ok(t.id, `Template missing id: ${t.name}`);
        assert.ok(t.name, `Template missing name`);
        assert.ok(t.role, `Template missing role: ${t.name}`);
        assert.ok(t.model, `Template missing model: ${t.name}`);
        assert.ok(t.department, `Template missing department: ${t.name}`);
        assert.ok(Array.isArray(t.tags), `Template tags not array: ${t.name}`);
        assert.ok(Array.isArray(t.tools), `Template tools not array: ${t.name}`);
      }
    });

    it('should include all expected template types', () => {
      const names = AGENT_TEMPLATES.map(t => t.name);
      assert.ok(names.includes('Code Reviewer'));
      assert.ok(names.includes('Technical Writer'));
      assert.ok(names.includes('Data Analyst'));
      assert.ok(names.includes('DevOps Engineer'));
      assert.ok(names.includes('Security Auditor'));
      assert.ok(names.includes('Product Manager'));
      assert.ok(names.includes('QA Tester'));
      assert.ok(names.includes('Copywriter'));
    });

    it('should have a fallbackModel for each template', () => {
      for (const t of AGENT_TEMPLATES) {
        assert.ok(t.fallbackModel, `Template missing fallbackModel: ${t.name}`);
      }
    });
  });

  // ---- CRUD ----

  describe('createAgent', () => {
    it('should create an agent with required fields', () => {
      const agent = manager.createAgent({
        role: 'My Custom Agent',
        model: 'test-model',
        department: 'Engineering'
      });

      assert.ok(agent.id >= 1001);
      assert.strictEqual(agent.role, 'My Custom Agent');
      assert.strictEqual(agent.model, 'test-model');
      assert.strictEqual(agent.department, 'Engineering');
      assert.strictEqual(agent.fallbackModel, 'google/gemma-4-26b-a4b-it');
      assert.strictEqual(agent.isCustom, true);
    });

    it('should assign incrementing IDs starting at 1001', () => {
      const a1 = manager.createAgent({ role: 'Agent 1', model: 'm1' });
      const a2 = manager.createAgent({ role: 'Agent 2', model: 'm2' });
      const a3 = manager.createAgent({ role: 'Agent 3', model: 'm3' });

      assert.strictEqual(a1.id, 1001);
      assert.strictEqual(a2.id, 1002);
      assert.strictEqual(a3.id, 1003);
    });

    it('should persist to disk', () => {
      manager.createAgent({ role: 'Persistent', model: 'm1' });
      const data = JSON.parse(fs.readFileSync(TEST_AGENTS_PATH, 'utf8'));
      assert.strictEqual(data.agents.length, 1);
      assert.strictEqual(data.agents[0].role, 'Persistent');
    });

    it('should set default department to Engineering', () => {
      const agent = manager.createAgent({ role: 'No Dept', model: 'm1' });
      assert.strictEqual(agent.department, 'Engineering');
    });

    it('should accept optional fields', () => {
      const agent = manager.createAgent({
        role: 'Full Agent',
        model: 'm1',
        fallbackModel: 'm2',
        department: 'Marketing',
        prompt: 'You are a marketing agent',
        tools: ['url-fetch'],
        tags: ['marketing', 'content'],
        createdBy: 'test-user'
      });

      assert.strictEqual(agent.prompt, 'You are a marketing agent');
      assert.deepStrictEqual(agent.tools, ['url-fetch']);
      assert.deepStrictEqual(agent.tags, ['marketing', 'content']);
    });

    it('should use role as name if name not provided', () => {
      const agent = manager.createAgent({ role: 'Rover', model: 'm1' });
      assert.ok(agent.role === 'Rover');
    });
  });

  describe('updateAgent', () => {
    it('should update specified fields', () => {
      const created = manager.createAgent({ role: 'Original', model: 'm1' });
      const updated = manager.updateAgent(created.id, { role: 'Updated' });

      assert.ok(updated);
      assert.strictEqual(updated.role, 'Updated');
    });

    it('should return null for non-existent agent', () => {
      const result = manager.updateAgent(9999, { role: 'New' });
      assert.strictEqual(result, null);
    });

    it('should update only allowed fields', () => {
      const created = manager.createAgent({ role: 'Test', model: 'm1' });
      manager.updateAgent(created.id, { role: 'New Role', model: 'new-model', createdBy: 'hacker' });

      const stored = manager.customAgents.agents.find(a => a.id === created.id);
      assert.strictEqual(stored.role, 'New Role');
      assert.strictEqual(stored.model, 'new-model');
      // createdBy should NOT have been updated (not in allowedFields)
      assert.strictEqual(stored.createdBy, null);
    });

    it('should persist updates to disk', () => {
      const created = manager.createAgent({ role: 'Before', model: 'm1' });
      manager.updateAgent(created.id, { role: 'After' });

      const data = JSON.parse(fs.readFileSync(TEST_AGENTS_PATH, 'utf8'));
      const agent = data.agents.find(a => a.id === created.id);
      assert.strictEqual(agent.role, 'After');
    });
  });

  describe('deleteAgent', () => {
    it('should delete an existing agent', () => {
      const created = manager.createAgent({ role: 'Delete Me', model: 'm1' });
      assert.strictEqual(manager.customAgents.agents.length, 1);

      const result = manager.deleteAgent(created.id);
      assert.strictEqual(result, true);
      assert.strictEqual(manager.customAgents.agents.length, 0);
    });

    it('should return false for non-existent agent', () => {
      assert.strictEqual(manager.deleteAgent(9999), false);
    });

    it('should persist deletion to disk', () => {
      const a1 = manager.createAgent({ role: 'Keep', model: 'm1' });
      const a2 = manager.createAgent({ role: 'Remove', model: 'm2' });
      manager.deleteAgent(a2.id);

      const data = JSON.parse(fs.readFileSync(TEST_AGENTS_PATH, 'utf8'));
      assert.strictEqual(data.agents.length, 1);
      assert.strictEqual(data.agents[0].id, a1.id);
    });
  });

  describe('getAgent', () => {
    it('should return the agent with the given ID', () => {
      const created = manager.createAgent({ role: 'Finder', model: 'm1' });
      const found = manager.getAgent(created.id);
      assert.ok(found);
      assert.strictEqual(found.role, 'Finder');
    });

    it('should return null for non-existent ID', () => {
      assert.strictEqual(manager.getAgent(9999), null);
    });
  });

  describe('listAgents', () => {
    it('should list all agents by default', () => {
      manager.createAgent({ role: 'A1', model: 'm1', department: 'Engineering' });
      manager.createAgent({ role: 'A2', model: 'm2', department: 'Marketing' });

      const all = manager.listAgents();
      assert.strictEqual(all.length, 2);
    });

    it('should filter by department', () => {
      manager.createAgent({ role: 'Eng A', model: 'm1', department: 'Engineering' });
      manager.createAgent({ role: 'Mkt A', model: 'm2', department: 'Marketing' });

      const eng = manager.listAgents({ department: 'Engineering' });
      assert.strictEqual(eng.length, 1);
      assert.strictEqual(eng[0].role, 'Eng A');
    });

    it('should filter by tag', () => {
      manager.createAgent({ role: 'Tagger', model: 'm1', tags: ['data', 'analysis'] });
      manager.createAgent({ role: 'Plain', model: 'm2', tags: [] });

      const tagged = manager.listAgents({ tag: 'data' });
      assert.strictEqual(tagged.length, 1);
      assert.strictEqual(tagged[0].role, 'Tagger');
    });

    it('should return empty list when no agents exist', () => {
      assert.deepStrictEqual(manager.listAgents(), []);
    });
  });

  // ---- Templates ----

  describe('getTemplates', () => {
    it('should return all templates', () => {
      const templates = manager.getTemplates();
      assert.strictEqual(templates.length, 8);
    });
  });

  describe('createFromTemplate', () => {
    it('should create an agent from a valid template', () => {
      const agent = manager.createFromTemplate('template-code-reviewer');
      assert.ok(agent);
      assert.strictEqual(agent.role, 'Code Reviewer');
      assert.strictEqual(agent.isCustom, true);
    });

    it('should return null for invalid template ID', () => {
      const result = manager.createFromTemplate('template-nonexistent');
      assert.strictEqual(result, null);
    });

    it('should apply overrides', () => {
      const agent = manager.createFromTemplate('template-code-reviewer', { model: 'custom-model' });
      assert.strictEqual(agent.model, 'custom-model');
      // Other fields from template should remain
      assert.strictEqual(agent.role, 'Code Reviewer');
    });

    it('should assign unique IDs for template-created agents', () => {
      const a1 = manager.createFromTemplate('template-code-reviewer');
      const a2 = manager.createFromTemplate('template-tech-writer');
      assert.notStrictEqual(a1.id, a2.id);
    });
  });

  // ---- Export / Import ----

  describe('exportAgent', () => {
    it('should export an agent in portable format', () => {
      const created = manager.createAgent({
        role: 'Export Test',
        model: 'test-model',
        department: 'Sales'
      });

      const exported = manager.exportAgent(created.id);
      assert.ok(exported);
      assert.strictEqual(exported.formatVersion, '1.0');
      assert.strictEqual(exported.type, 'elkhedr-orca-agent');
      assert.strictEqual(exported.agent.role, 'Export Test');
      assert.strictEqual(exported.agent.model, 'test-model');
    });

    it('should return null for non-existent agent', () => {
      assert.strictEqual(manager.exportAgent(9999), null);
    });

    it('should include exportedAt timestamp', () => {
      const created = manager.createAgent({ role: 'Time Test', model: 'm1' });
      const exported = manager.exportAgent(created.id);
      assert.ok(exported.exportedAt);
    });
  });

  describe('importAgent', () => {
    it('should import a valid agent definition', () => {
      const agent = manager.importAgent({
        formatVersion: '1.0',
        type: 'elkhedr-orca-agent',
        agent: {
          role: 'Imported Agent',
          model: 'imported-model',
          department: 'Operations'
        }
      });

      assert.ok(agent);
      assert.strictEqual(agent.role, 'Imported Agent');
      assert.strictEqual(agent.model, 'imported-model');
      assert.ok(agent.id >= 1001);
    });

    it('should reject invalid definition format', () => {
      assert.throws(() => {
        manager.importAgent({ type: 'wrong-type' });
      }, /Invalid agent definition format/);
    });

    it('should reject definition missing role', () => {
      assert.throws(() => {
        manager.importAgent({
          formatVersion: '1.0',
          type: 'elkhedr-orca-agent',
          agent: { model: 'm1' }
        });
      }, /Agent definition must include role and model/);
    });

    it('should reject definition missing model', () => {
      assert.throws(() => {
        manager.importAgent({
          formatVersion: '1.0',
          type: 'elkhedr-orca-agent',
          agent: { role: 'R1' }
        });
      }, /Agent definition must include role and model/);
    });

    it('should use fallbackModel from import or default to model', () => {
      const agent = manager.importAgent({
        formatVersion: '1.0',
        type: 'elkhedr-orca-agent',
        agent: { role: 'No FB', model: 'primary-model' }
      });
      assert.strictEqual(agent.fallbackModel, 'primary-model');
    });
  });

  describe('importFromFile', () => {
    it('should import from a JSON file', () => {
      const importPath = path.join(__dirname, 'test-import-agent.json');
      fs.writeFileSync(importPath, JSON.stringify({
        formatVersion: '1.0',
        type: 'elkhedr-orca-agent',
        agent: { role: 'File Import', model: 'file-model' }
      }));

      const agent = manager.importFromFile(importPath);
      assert.ok(agent);
      assert.strictEqual(agent.role, 'File Import');

      fs.unlinkSync(importPath);
    });

    it('should throw on file not found', () => {
      assert.throws(() => {
        manager.importFromFile('/nonexistent/path.json');
      });
    });
  });

  // ---- Persist & Loading ----

  describe('_loadCustomAgents', () => {
    it('should return empty state when file does not exist', () => {
      const fresh = new TestCustomAgentManager();
      assert.deepStrictEqual(fresh.customAgents.agents, []);
      assert.strictEqual(fresh.customAgents.nextId, 1001);
    });

    it('should reload agents from disk', () => {
      manager.createAgent({ role: 'Survivor', model: 'm1' });

      // Force fresh load from disk
      const fresh = new TestCustomAgentManager();
      fresh.customAgents = fresh._loadCustomAgents();
      const agents = fresh.listAgents();
      assert.strictEqual(agents.length, 1);
      assert.strictEqual(agents[0].role, 'Survivor');
    });
  });

  // ---- isCustom flag ----

  describe('isCustom flag', () => {
    it('should be true for all custom agents', () => {
      const agent = manager.createAgent({ role: 'Custom Check', model: 'm1' });
      assert.strictEqual(agent.isCustom, true);
    });

    it('should be present in listAgents output', () => {
      manager.createAgent({ role: 'List Check', model: 'm1' });
      const agents = manager.listAgents();
      assert.ok(agents.every(a => a.isCustom === true));
    });
  });

  // ---- ID persistence ----

  describe('ID persistence', () => {
    it('should continue ID sequence from disk', () => {
      const m = new TestCustomAgentManager();
      m.createAgent({ role: 'First', model: 'm1' });
      m.createAgent({ role: 'Second', model: 'm2' });

      const fresh = new TestCustomAgentManager();
      fresh.customAgents = fresh._loadCustomAgents();
      const agent = fresh.createAgent({ role: 'Third', model: 'm3' });
      assert.strictEqual(agent.id, 1003);
    });
  });

  // ---- Edge Cases ----

  describe('edge cases', () => {
    it('should handle agents with empty tools array', () => {
      const agent = manager.createAgent({ role: 'No Tools', model: 'm1', tools: [] });
      assert.deepStrictEqual(agent.tools, []);
    });

    it('should handle agents with empty tags array', () => {
      const agent = manager.createAgent({ role: 'No Tags', model: 'm1', tags: [] });
      assert.deepStrictEqual(agent.tags, []);
    });

    it('should handle agents with empty prompt', () => {
      const agent = manager.createAgent({ role: 'No Prompt', model: 'm1', prompt: '' });
      assert.strictEqual(agent.prompt, '');
    });
  });
});
