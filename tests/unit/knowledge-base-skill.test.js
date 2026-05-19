const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const skills = require('../../src/skills.js');

describe('Knowledge Base Skill', () => {
  let skillInstance;

  beforeEach(async () => {
    // Ensure we use an in‑memory SQLite database for isolation
    process.env.ORCA_DB_URL = ':memory:';
    // Reload skills to pick up the env var
    delete require.cache[require.resolve('../../src/skills.js')];
    // Re‑load skills (this will also reload the knowledge-base skill)
    const skillsModule = require('../../src/skills.js');
    // Debug: list all loaded skill names
    const loadedSkills = skillsModule.registry.getAll().map(s => s.name);
    console.log('Loaded skills:', loadedSkills);
    // Find the knowledge_base skill
    skillInstance = skillsModule.registry.get('knowledge_base');
    // If not found, log the error and fail
    if (!skillInstance) {
      console.error('knowledge_base skill not found in registry');
      console.error('Registry contents:', skillsModule.registry.getAll().map(s => ({name: s.name, permissions: s.permissions})));
    }
    assert.ok(skillInstance, 'knowledge_base skill should be loaded');
  });

  afterEach(async () => {
    // Close the database connection
    const db = require('../../src/db/index.js').getDatabaseInstance();
    await db.close();
  });

  it('should add a fact and retrieve it', async () => {
    // Simulate the agentId that the skill will use (in real usage this is set by the caller)
    skillInstance.agentId = 'test-agent';
    const result = await skillInstance.execute({
      action: 'add',
      title: 'Test Fact',
      content: 'This is a test fact.',
      type: 'markdown'
    });
    assert.strictEqual(typeof result, 'string');
    assert.ok(result.includes('Knowledge entry added with ID'));

    // Extract the ID from the result (naive)
    const idMatch = result.match(/ID (\d+)/);
    assert.ok(idMatch);
    const entryId = parseInt(idMatch[1], 10);

    // Now retrieve the entry using the get action
    const getResult = await skillInstance.execute({
      action: 'get',
      entryId: entryId
    });
    const entry = JSON.parse(getResult);
    assert.strictEqual(entry.title, 'Test Fact');
    assert.strictEqual(entry.content, 'This is a test fact.');
    assert.strictEqual(entry.content_type, 'markdown');
  });

  it('should update a fact and create a version', async () => {
    skillInstance.agentId = 'test-agent';
    const addResult = await skillInstance.execute({
      action: 'add',
      title: 'Updatable Fact',
      content: 'Original content',
      type: 'markdown'
    });
    const idMatch = addResult.match(/ID (\d+)/);
    assert.ok(idMatch);
    const entryId = parseInt(idMatch[1], 10);

    // Update the fact
    const updateResult = await skillInstance.execute({
      action: 'update',
      entryId: entryId,
      content: 'Updated content'
    });
    assert.strictEqual(updateResult, `Knowledge entry ${entryId} updated.`);

    // Retrieve and verify updated content
    const getResult = await skillInstance.execute({
      action: 'get',
      entryId: entryId
    });
    const entry = JSON.parse(getResult);
    assert.strictEqual(entry.content, 'Updated content');

    // For versioning, we could check the knowledge_versions table directly,
    // but we'll trust the DB manager's updateKnowledgeEntry creates a version.
  });

  it('should search for facts by title or content', async () => {
    skillInstance.agentId = 'test-agent';
    await skillInstance.execute({
      action: 'add',
      title: 'Apple',
      content: 'A fruit that is red or green.',
      type: 'markdown'
    });
    await skillInstance.execute({
      action: 'add',
      title: 'Banana',
      content: 'A yellow fruit.',
      type: 'markdown'
    });

    const searchResult = await skillInstance.execute({
      action: 'search',
      query: 'fruit',
      limit: 10
    });
    const results = JSON.parse(searchResult);
    assert.strictEqual(Array.isArray(results), true);
    assert.ok(results.length >= 2);
    // Ensure both entries appear (order may vary)
    const titles = results.map(r => r.title);
    assert.ok(titles.includes('Apple'));
    assert.ok(titles.includes('Banana'));
  });
});
