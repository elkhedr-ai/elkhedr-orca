const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { buildServer } = require('../../src/server/index.js');
const { initializeDatabaseInstance } = require('../../src/db');
const { getAuditLogs } = require('../../src/audit/logger.js');
const { getActionApprovalStore } = require('../../src/actions/approval-store.js');

async function registerUser(app) {
  const username = `actiontest_${Date.now()}_${Math.round(Math.random() * 100000)}`;
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: {
      username,
      email: `${username}@example.com`,
      password: 'Password123!',
    },
  });
  assert.strictEqual(response.statusCode, 201, response.body);
  return JSON.parse(response.body).tokens.accessToken;
}

describe('Orca action approval contract', () => {
  let app;
  let db;
  let authToken;

  beforeEach(async () => {
    process.env.ORCA_DB_URL = ':memory:';
    getActionApprovalStore().reset();
    db = await initializeDatabaseInstance();
    app = await buildServer();
    authToken = await registerUser(app);
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    if (db) {
      await db.close();
    }
    getActionApprovalStore().reset();
  });

  it('publishes bridge status without authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/orca/status',
    });

    assert.strictEqual(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.status, 'ok');
    assert.strictEqual(body.approvalContract.actionsPath, '/api/orca/actions');
  });

  it('rejects unauthenticated action requests', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/orca/actions',
      payload: {
        actionType: 'shell.execute',
        description: 'Run a command',
      },
    });

    assert.strictEqual(response.statusCode, 401);
  });

  it('requires approval before accepting dangerous action results', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/orca/actions',
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        actionType: 'shell.execute',
        capabilityKey: 'orca.shell',
        description: 'Run npm test',
        risk: 'high',
        params: { command: 'npm test' },
      },
    });

    assert.strictEqual(created.statusCode, 201, created.body);
    const createdBody = JSON.parse(created.body);
    assert.strictEqual(createdBody.action.status, 'pending_approval');
    assert.strictEqual(createdBody.action.approvalRequired, true);
    assert.strictEqual(createdBody.action.events[0].event_type, 'orca.action_requested');

    const blockedResult = await app.inject({
      method: 'POST',
      url: `/api/orca/actions/${createdBody.action.id}/result`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        status: 'success',
        summary: 'Executed',
      },
    });
    assert.strictEqual(blockedResult.statusCode, 409);

    const approved = await app.inject({
      method: 'POST',
      url: `/api/orca/actions/${createdBody.action.id}/approval`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        decision: 'approved',
        reason: 'User approved this shell command.',
      },
    });
    assert.strictEqual(approved.statusCode, 200, approved.body);
    assert.strictEqual(JSON.parse(approved.body).action.status, 'approved');

    const completed = await app.inject({
      method: 'POST',
      url: `/api/orca/actions/${createdBody.action.id}/result`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        status: 'success',
        summary: 'Command completed in sandbox.',
        artifacts: [{ type: 'orca.report', uri: 'orca://runs/run-1/report' }],
      },
    });
    assert.strictEqual(completed.statusCode, 200, completed.body);
    const completedBody = JSON.parse(completed.body);
    assert.strictEqual(completedBody.action.status, 'completed');
    assert.strictEqual(completedBody.action.result.artifacts.length, 1);

    const events = await app.inject({
      method: 'GET',
      url: '/api/orca/events',
    });
    assert.strictEqual(events.statusCode, 200, events.body);
    const eventsBody = JSON.parse(events.body);
    assert.ok(eventsBody.events.some((event) => event.event_type === 'orca.action_requested'));
    assert.ok(eventsBody.events.some((event) => event.event_type === 'orca.action_completed'));
    assert.strictEqual(eventsBody.events[0].app_id, 'orca');
    assert.strictEqual(eventsBody.events[0].artifact.app_id, 'orca');
    assert.ok(['orca.run', 'orca.report'].includes(eventsBody.events.at(-1).artifact.artifact_type));

    const logs = await getAuditLogs({ eventType: 'orca_action', limit: 10 });
    assert.deepStrictEqual(
      logs.map((log) => log.action).reverse(),
      ['action.requested', 'action.approved', 'action.result']
    );
  });

  it('auto-approves low-risk action requests', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/orca/actions',
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        actionType: 'analysis.summarize',
        capabilityKey: 'orca.analysis',
        description: 'Summarize local run metadata',
        risk: 'low',
      },
    });

    assert.strictEqual(response.statusCode, 201, response.body);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.action.status, 'approved');
    assert.strictEqual(body.action.approvalRequired, false);
    assert.ok(body.action.events.some((event) => event.event_type === 'orca.action_approved'));
  });

  it('records rejected action requests as terminal decisions', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/orca/actions',
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        actionType: 'file.delete',
        capabilityKey: 'orca.file_delete',
        description: 'Delete a workspace file',
        risk: 'critical',
      },
    });
    const actionId = JSON.parse(created.body).action.id;

    const rejected = await app.inject({
      method: 'POST',
      url: `/api/orca/actions/${actionId}/approval`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        decision: 'rejected',
        reason: 'User denied file deletion.',
      },
    });
    assert.strictEqual(rejected.statusCode, 200, rejected.body);
    assert.strictEqual(JSON.parse(rejected.body).action.status, 'rejected');

    const result = await app.inject({
      method: 'POST',
      url: `/api/orca/actions/${actionId}/result`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: { status: 'success' },
    });
    assert.strictEqual(result.statusCode, 409);
  });

  it('emits projection events with artifacts for OS ingestion', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/orca/actions',
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        actionType: 'shell.execute',
        capabilityKey: 'orca.shell',
        description: 'Run npm test',
        risk: 'high',
      },
    });
    const actionId = JSON.parse(created.body).action.id;

    await app.inject({
      method: 'POST',
      url: `/api/orca/actions/${actionId}/approval`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: { decision: 'approved', reason: 'Test OK' },
    });

    await app.inject({
      method: 'POST',
      url: `/api/orca/actions/${actionId}/result`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: { status: 'success', summary: 'Done' },
    });

    const events = await app.inject({
      method: 'GET',
      url: '/api/orca/events',
    });
    assert.strictEqual(events.statusCode, 200);
    const body = JSON.parse(events.body);
    assert.ok(body.events.length >= 3);
    assert.ok(body.events.some((e) => e.event_type === 'orca.action_requested'));
    assert.ok(body.events.some((e) => e.event_type === 'orca.action_approved'));
    assert.ok(body.events.some((e) => e.event_type === 'orca.action_completed'));
    assert.ok(body.events.every((e) => e.app_id === 'orca'));
    assert.ok(body.events.every((e) => e.artifact && e.artifact.artifact_type.startsWith('orca.')));
  });
});
