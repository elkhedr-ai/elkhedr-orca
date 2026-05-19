const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { initializeDatabaseInstance } = require('../../src/db');

describe('Database User Isolation', () => {
  let db;
  let user1Id;
  let user2Id;

  beforeEach(async () => {
    process.env.ORCA_DB_URL = ':memory:';
    db = await initializeDatabaseInstance();
    // Insert test users to satisfy foreign key constraints
    const u1 = await db.getAdapter().execute(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      ['user1', 'user1@test.com', 'hash1']
    );
    user1Id = u1.lastInsertRowid;
    const u2 = await db.getAdapter().execute(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      ['user2', 'user2@test.com', 'hash2']
    );
    user2Id = u2.lastInsertRowid;
  });

  afterEach(async () => {
    await db.close();
  });

  it('should get sessions filtered by user_id', async () => {
    await db.saveSessionData({ prompt: 'prompt-a', mode: 'instant', agent: 'test', result: 'result-a', tokens: 10, traceId: 't1' }, user1Id);
    await db.saveSessionData({ prompt: 'prompt-b', mode: 'instant', agent: 'test', result: 'result-b', tokens: 20, traceId: 't2' }, user2Id);
    await db.saveSessionData({ prompt: 'prompt-c', mode: 'instant', agent: 'test', result: 'result-c', tokens: 30, traceId: 't3' }, user1Id);

    const user1Sessions = await db.getSessionsData(user1Id, 50);
    assert.strictEqual(user1Sessions.length, 2);
    assert.ok(user1Sessions.some(s => s.prompt === 'prompt-a'));
    assert.ok(user1Sessions.some(s => s.prompt === 'prompt-c'));

    const user2Sessions = await db.getSessionsData(user2Id, 50);
    assert.strictEqual(user2Sessions.length, 1);
    assert.strictEqual(user2Sessions[0].prompt, 'prompt-b');

    const allSessions = await db.getSessionsData(null, 50);
    assert.strictEqual(allSessions.length, 3);
  });

  it('should get analytics filtered by user_id', async () => {
    const task1 = await db.getAdapter().execute(
      'INSERT INTO tasks (user_id, agent_role, prompt, result, tokens, cost) VALUES (?, ?, ?, ?, ?, ?)',
      [user1Id, 'agent-a', 'prompt', 'result', 100, 0.05]
    );
    await db.updateAnalytics(task1.lastInsertRowid, 100, 0.05);

    const task2 = await db.getAdapter().execute(
      'INSERT INTO tasks (user_id, agent_role, prompt, result, tokens, cost) VALUES (?, ?, ?, ?, ?, ?)',
      [user2Id, 'agent-b', 'prompt', 'result', 200, 0.10]
    );
    await db.updateAnalytics(task2.lastInsertRowid, 200, 0.10);

    const user1Analytics = await db.getAnalyticsData(user1Id);
    assert.strictEqual(user1Analytics.totalTokens, 100);
    assert.strictEqual(user1Analytics.totalCost, 0.05);

    const user2Analytics = await db.getAnalyticsData(user2Id);
    assert.strictEqual(user2Analytics.totalTokens, 200);
    assert.strictEqual(user2Analytics.totalCost, 0.10);

    const allAnalytics = await db.getAnalyticsData(null);
    assert.strictEqual(allAnalytics.totalTokens, 300);
    assert.ok(Math.abs(allAnalytics.totalCost - 0.15) < 0.001);
  });

  it('should get agent usage filtered by user_id', async () => {
    const task1 = await db.getAdapter().execute(
      'INSERT INTO tasks (user_id, agent_role, prompt, result, tokens, cost) VALUES (?, ?, ?, ?, ?, ?)',
      [user1Id, 'agent-a', 'prompt', 'result', 100, 0.05]
    );
    await db.updateAnalytics(task1.lastInsertRowid, 100, 0.05);

    const task2 = await db.getAdapter().execute(
      'INSERT INTO tasks (user_id, agent_role, prompt, result, tokens, cost) VALUES (?, ?, ?, ?, ?, ?)',
      [user2Id, 'agent-b', 'prompt', 'result', 200, 0.10]
    );
    await db.updateAnalytics(task2.lastInsertRowid, 200, 0.10);

    const user1Usage = await db.getAgentUsageData(user1Id);
    assert.strictEqual(Object.keys(user1Usage).length, 1);
    assert.ok(user1Usage['agent-a']);

    const user2Usage = await db.getAgentUsageData(user2Id);
    assert.strictEqual(Object.keys(user2Usage).length, 1);
    assert.ok(user2Usage['agent-b']);

    const allUsage = await db.getAgentUsageData(null);
    assert.strictEqual(Object.keys(allUsage).length, 2);
  });

  it('should get recent messages filtered by user_id', async () => {
    await db.addConversationMessage({ agentId: 'agent-a', sessionId: 'sess-1', userId: user1Id, role: 'user', content: 'hello user 1' });
    await db.addConversationMessage({ agentId: 'agent-a', sessionId: 'sess-1', userId: user1Id, role: 'assistant', content: 'hi user 1' });
    await db.addConversationMessage({ agentId: 'agent-a', sessionId: 'sess-1', userId: user2Id, role: 'user', content: 'hello user 2' });

    const user1Messages = await db.getRecentMessages({ agentId: 'agent-a', sessionId: 'sess-1', userId: user1Id, limit: 10 });
    assert.strictEqual(user1Messages.length, 2);
    assert.ok(user1Messages.some(m => m.content === 'hello user 1'));
    assert.ok(user1Messages.some(m => m.content === 'hi user 1'));

    const user2Messages = await db.getRecentMessages({ agentId: 'agent-a', sessionId: 'sess-1', userId: user2Id, limit: 10 });
    assert.strictEqual(user2Messages.length, 1);
    assert.strictEqual(user2Messages[0].content, 'hello user 2');
  });

  it('should search knowledge filtered by user_id', async () => {
    await db.createKnowledgeEntry({ agentId: 'agent-a', userId: user1Id, title: 'user1 doc', content: 'content1', type: 'markdown' });
    await db.createKnowledgeEntry({ agentId: 'agent-a', userId: user2Id, title: 'user2 doc', content: 'content2', type: 'markdown' });
    await db.createKnowledgeEntry({ agentId: 'agent-a', userId: null, title: 'public doc', content: 'content3', type: 'markdown' });

    const user1Results = await db.searchKnowledge('agent-a', 'doc', user1Id, 10);
    assert.strictEqual(user1Results.length, 2);

    const user2Results = await db.searchKnowledge('agent-a', 'doc', user2Id, 10);
    assert.strictEqual(user2Results.length, 2);

    const allResults = await db.searchKnowledge('agent-a', 'doc', null, 10);
    assert.strictEqual(allResults.length, 3);
  });

  it('should get knowledge entry by ID filtered by user_id', async () => {
    const entryId = await db.createKnowledgeEntry({ agentId: 'agent-a', userId: user1Id, title: 'private', content: 'secret', type: 'markdown' });

    const ownerEntry = await db.getKnowledgeEntryById(entryId, user1Id);
    assert.ok(ownerEntry);
    assert.strictEqual(ownerEntry.title, 'private');

    const otherEntry = await db.getKnowledgeEntryById(entryId, user2Id);
    assert.strictEqual(otherEntry, null);

    const adminEntry = await db.getKnowledgeEntryById(entryId, null);
    assert.ok(adminEntry);
    assert.strictEqual(adminEntry.title, 'private');
  });

  it('should get session stats filtered by user_id', async () => {
    await db.upsertSessionStats('sess-1', { level: 'Auto', sandbox: false, currentAgent: null, userId: user1Id });
    await db.upsertSessionStats('sess-2', { level: 'Thinking', sandbox: true, currentAgent: 'agent-a', userId: user2Id });

    const stats1 = await db.getSessionStats('sess-1', user1Id);
    assert.ok(stats1);
    assert.strictEqual(stats1.level, 'Auto');

    const stats1other = await db.getSessionStats('sess-2', user1Id);
    assert.strictEqual(stats1other, null);

    const stats2 = await db.getSessionStats('sess-2', user2Id);
    assert.ok(stats2);
    assert.strictEqual(stats2.level, 'Thinking');

    const adminStats = await db.getSessionStats('sess-1', null);
    assert.ok(adminStats);
  });
});
