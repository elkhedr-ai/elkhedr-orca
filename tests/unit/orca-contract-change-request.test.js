const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { buildServer } = require('../../src/server/index.js');
const { initializeDatabaseInstance } = require('../../src/db');
const { getActionApprovalStore } = require('../../src/actions/approval-store.js');
const { getAuditLogs } = require('../../src/audit/logger.js');

async function registerUser(app) {
  const username = `ccrtest_${Date.now()}_${Math.round(Math.random() * 100000)}`;
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

describe('Orca contract change request contract', () => {
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

  it('rejects unauthenticated contract change requests', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/orca/contracts/change-requests',
      payload: {
        contractType: 'manifest',
        changeType: 'add',
        target: 'orca.contract_change_requested',
        description: 'Add a new event type.',
        proposedValue: { eventType: 'orca.contract_change_requested' },
      },
    });

    assert.strictEqual(response.statusCode, 401);
  });

  it('creates a pending contract change request with contract-specific events', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/orca/contracts/change-requests',
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        contractType: 'manifest',
        changeType: 'add',
        target: 'orca.contract_change_requested',
        description: 'Add contract change request event to manifest.',
        proposedValue: { eventType: 'orca.contract_change_requested' },
        appId: 'orca',
        reason: 'Needed for contract change request lifecycle.',
      },
    });

    assert.strictEqual(response.statusCode, 201, response.body);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.request.actionType, 'contract.change_request');
    assert.strictEqual(body.request.status, 'pending_approval');
    assert.strictEqual(body.request.approvalRequired, true);
    assert.strictEqual(body.request.params.contractType, 'manifest');
    assert.strictEqual(body.request.params.appId, 'orca');
    assert.ok(body.request.contractChangeRequest);
    assert.strictEqual(body.request.contractChangeRequest.target, 'orca.contract_change_requested');
    assert.ok(body.request.events.some((event) => event.event_type === 'orca.contract_change_requested'));
  });

  it('lists only contract change requests', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/orca/actions',
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        actionType: 'shell.execute',
        description: 'Shell action',
        risk: 'high',
      },
    });

    await app.inject({
      method: 'POST',
      url: '/api/orca/contracts/change-requests',
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        contractType: 'event',
        changeType: 'add',
        target: 'orca.new_event',
        description: 'Add event.',
        proposedValue: { eventType: 'orca.new_event' },
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/orca/contracts/change-requests',
      headers: { Authorization: `Bearer ${authToken}` },
    });

    assert.strictEqual(response.statusCode, 200, response.body);
    const body = JSON.parse(response.body);
    assert.strictEqual(body.requests.length, 1);
    assert.strictEqual(body.requests[0].actionType, 'contract.change_request');
  });

  it('requires approval before completing a contract change request', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/orca/contracts/change-requests',
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        contractType: 'openapi',
        changeType: 'modify',
        target: '/api/orca/contracts/change-requests',
        description: 'Add CCR endpoints to OpenAPI spec.',
        proposedValue: { path: '/api/orca/contracts/change-requests', method: 'POST' },
      },
    });

    assert.strictEqual(created.statusCode, 201, created.body);
    const requestId = JSON.parse(created.body).request.id;

    const blockedResult = await app.inject({
      method: 'POST',
      url: `/api/orca/contracts/change-requests/${requestId}/result`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: { status: 'success', summary: 'Merged into elkhedr-contracts.' },
    });
    assert.strictEqual(blockedResult.statusCode, 409);

    const approved = await app.inject({
      method: 'POST',
      url: `/api/orca/contracts/change-requests/${requestId}/approval`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: { decision: 'approved', reason: 'Reviewed and accepted.' },
    });
    assert.strictEqual(approved.statusCode, 200, approved.body);
    const approvedBody = JSON.parse(approved.body);
    assert.strictEqual(approvedBody.request.status, 'approved');
    assert.ok(approvedBody.request.events.some((event) => event.event_type === 'orca.contract_change_approved'));

    const completed = await app.inject({
      method: 'POST',
      url: `/api/orca/contracts/change-requests/${requestId}/result`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        status: 'success',
        summary: 'Contract change merged and manifest updated.',
        artifacts: [{ type: 'orca.contract_change_request', uri: 'orca://contracts/ccr-1' }],
      },
    });
    assert.strictEqual(completed.statusCode, 200, completed.body);
    const completedBody = JSON.parse(completed.body);
    assert.strictEqual(completedBody.request.status, 'completed');
    assert.ok(completedBody.request.events.some((event) => event.event_type === 'orca.contract_change_completed'));

    const logs = await getAuditLogs({ eventType: 'orca_contract_change', limit: 10 });
    assert.deepStrictEqual(
      logs.map((log) => log.action).reverse(),
      ['contract_change.requested', 'contract_change.approved', 'contract_change.result']
    );
  });

  it('records rejected contract change requests as terminal decisions', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/orca/contracts/change-requests',
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        contractType: 'capability',
        changeType: 'add',
        target: 'orca.unsafe_capability',
        description: 'Request unsafe capability.',
        proposedValue: { capabilityKey: 'orca.unsafe_capability' },
      },
    });
    const requestId = JSON.parse(created.body).request.id;

    const rejected = await app.inject({
      method: 'POST',
      url: `/api/orca/contracts/change-requests/${requestId}/approval`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: { decision: 'rejected', reason: 'Violates boundary policy.' },
    });
    assert.strictEqual(rejected.statusCode, 200, rejected.body);
    const rejectedBody = JSON.parse(rejected.body);
    assert.strictEqual(rejectedBody.request.status, 'rejected');
    assert.ok(rejectedBody.request.events.some((event) => event.event_type === 'orca.contract_change_rejected'));

    const result = await app.inject({
      method: 'POST',
      url: `/api/orca/contracts/change-requests/${requestId}/result`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: { status: 'success' },
    });
    assert.strictEqual(result.statusCode, 409);
  });

  it('rejects invalid contract change request payloads', async () => {
    const tests = [
      {
        payload: { contractType: 'invalid', changeType: 'add', target: 'x', description: 'x', proposedValue: {} },
        expectedMessage: 'contractType',
      },
      {
        payload: { contractType: 'manifest', changeType: 'invalid', target: 'x', description: 'x', proposedValue: {} },
        expectedMessage: 'changeType',
      },
      {
        payload: { contractType: 'manifest', changeType: 'add', description: 'x', proposedValue: {} },
        expectedMessage: 'target',
      },
      {
        payload: { contractType: 'event', changeType: 'add', target: 'x', description: 'x' },
        expectedMessage: 'proposedValue',
      },
      {
        payload: { contractType: 'manifest', changeType: 'add', target: 'x', description: 'x', proposedValue: {}, appId: 'invalid' },
        expectedMessage: 'appId',
      },
    ];

    for (const test of tests) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/orca/contracts/change-requests',
        headers: { Authorization: `Bearer ${authToken}` },
        payload: test.payload,
      });
      assert.strictEqual(response.statusCode, 400, `Expected 400 for ${test.expectedMessage}`);
      const body = JSON.parse(response.body);
      assert.ok(body.message.includes(test.expectedMessage), `Message should mention ${test.expectedMessage}: ${body.message}`);
    }
  });

  it('rejects reading or deciding a non-contract-change-request action', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/orca/actions',
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        actionType: 'shell.execute',
        description: 'Shell action',
        risk: 'high',
      },
    });
    const actionId = JSON.parse(created.body).action.id;

    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/orca/contracts/change-requests/${actionId}`,
      headers: { Authorization: `Bearer ${authToken}` },
    });
    assert.strictEqual(getResponse.statusCode, 400);

    const approvalResponse = await app.inject({
      method: 'POST',
      url: `/api/orca/contracts/change-requests/${actionId}/approval`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: { decision: 'approved' },
    });
    assert.strictEqual(approvalResponse.statusCode, 400);
  });

  it('accepts valid contract change request fixtures and rejects invalid ones', async () => {
    const fixtureDir = path.join(__dirname, '..', 'fixtures', 'contract-change-requests');
    const validFixtures = [
      'valid-manifest-add.json',
      'valid-openapi-modify.json',
    ];
    const invalidFixtures = [
      { file: 'invalid-missing-proposed-value.json', expectedMessage: 'proposedValue' },
      { file: 'invalid-unknown-app.json', expectedMessage: 'appId' },
    ];

    for (const file of validFixtures) {
      const payload = JSON.parse(fs.readFileSync(path.join(fixtureDir, file), 'utf8'));
      const response = await app.inject({
        method: 'POST',
        url: '/api/orca/contracts/change-requests',
        headers: { Authorization: `Bearer ${authToken}` },
        payload,
      });
      assert.strictEqual(response.statusCode, 201, `Expected 201 for ${file}`);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.request.status, 'pending_approval');
      assert.strictEqual(body.request.params.contractType, payload.contractType);
    }

    for (const { file, expectedMessage } of invalidFixtures) {
      const payload = JSON.parse(fs.readFileSync(path.join(fixtureDir, file), 'utf8'));
      const response = await app.inject({
        method: 'POST',
        url: '/api/orca/contracts/change-requests',
        headers: { Authorization: `Bearer ${authToken}` },
        payload,
      });
      assert.strictEqual(response.statusCode, 400, `Expected 400 for ${file}`);
      const body = JSON.parse(response.body);
      assert.ok(body.message.includes(expectedMessage), `Message should mention ${expectedMessage}: ${body.message}`);
    }
  });
});
