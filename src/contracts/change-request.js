/**
 * Contract Change Request runtime.
 *
 * A Contract Change Request (CCR) is a formal, auditable proposal to change
 * cross-app contracts (manifest, OpenAPI, MCP schema, events, artifacts,
 * capabilities, or action definitions). Because contract changes affect
 * integration boundaries, every CCR is treated as a high-risk action and is
 * routed through the Orca action approval store.
 *
 * Contract changes must still be approved by the `elkhedr-contracts` governance
 * process; this runtime only captures the request, approval, and result
 * lifecycle inside Orca and emits the expected events and artifacts.
 */

const { randomUUID } = require('node:crypto');
const {
  getActionApprovalStore,
  ActionContractError,
} = require('../actions/approval-store.js');

const CONTRACT_TYPES = Object.freeze([
  'manifest',
  'openapi',
  'mcp_schema',
  'event',
  'artifact',
  'capability',
  'action',
  'boundary_policy',
]);

const CHANGE_TYPES = Object.freeze(['add', 'modify', 'remove']);

const APP_IDS = Object.freeze([
  'os',
  'memory',
  'studio',
  'orca',
  'omni',
  'workspace',
  'social',
  'billing_cloud',
  'cloud_portal',
]);

class ContractChangeRequestError extends ActionContractError {}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateContractChangeRequest(input) {
  if (!input || typeof input !== 'object') {
    throw new ContractChangeRequestError('request body is required');
  }

  const { contractType, changeType, target, description, proposedValue, appId } = input;

  if (!isNonEmptyString(contractType)) {
    throw new ContractChangeRequestError('contractType is required');
  }
  if (!CONTRACT_TYPES.includes(contractType)) {
    throw new ContractChangeRequestError(
      `contractType must be one of: ${CONTRACT_TYPES.join(', ')}`
    );
  }

  if (!isNonEmptyString(changeType)) {
    throw new ContractChangeRequestError('changeType is required');
  }
  if (!CHANGE_TYPES.includes(changeType)) {
    throw new ContractChangeRequestError(
      `changeType must be one of: ${CHANGE_TYPES.join(', ')}`
    );
  }

  if (!isNonEmptyString(target)) {
    throw new ContractChangeRequestError('target is required');
  }

  if (!isNonEmptyString(description)) {
    throw new ContractChangeRequestError('description is required');
  }

  if (appId !== undefined && !APP_IDS.includes(appId)) {
    throw new ContractChangeRequestError(
      `appId must be one of: ${APP_IDS.join(', ')}`
    );
  }

  if (changeType !== 'remove' && proposedValue === undefined) {
    throw new ContractChangeRequestError(
      'proposedValue is required for add or modify changes'
    );
  }

  return {
    contractType,
    changeType,
    target: target.trim(),
    description: description.trim(),
    proposedValue,
    appId: appId || 'orca',
    reason: isNonEmptyString(input.reason) ? input.reason.trim() : null,
  };
}

function buildActionPayload(validated, context = {}) {
  return {
    actionType: 'contract.change_request',
    capabilityKey: 'orca.contracts',
    description: `[${validated.contractType}] ${validated.changeType} ${validated.target}: ${validated.description}`,
    risk: 'high',
    params: {
      contractType: validated.contractType,
      changeType: validated.changeType,
      target: validated.target,
      description: validated.description,
      proposedValue: validated.proposedValue,
      appId: validated.appId,
      reason: validated.reason,
      requestId: randomUUID(),
    },
    sessionId: context.sessionId || null,
  };
}

function createContractChangeRequest(input, context = {}) {
  const validated = validateContractChangeRequest(input);
  const actionPayload = buildActionPayload(validated, context);
  const store = getActionApprovalStore();
  const action = store.create(actionPayload, { actor: context.actor }, {
    requestedEventType: 'orca.contract_change_requested',
  });

  // Enrich the action representation with CCR-specific metadata for consumers.
  action.contractChangeRequest = {
    requestId: actionPayload.params.requestId,
    contractType: validated.contractType,
    changeType: validated.changeType,
    target: validated.target,
    appId: validated.appId,
    proposedValue: validated.proposedValue,
    reason: validated.reason,
  };

  return action;
}

function getContractChangeRequest(actionId) {
  const store = getActionApprovalStore();
  const action = store.get(actionId);
  if (action.actionType !== 'contract.change_request') {
    throw new ContractChangeRequestError(
      'Action is not a contract change request',
      400
    );
  }
  return action;
}

function listContractChangeRequests(filters = {}) {
  const store = getActionApprovalStore();
  const actions = store.list(filters);
  return actions.filter((action) => action.actionType === 'contract.change_request');
}

function decideContractChangeRequest(actionId, input, context = {}) {
  // Guard: ensure the action being decided is actually a contract change request.
  getContractChangeRequest(actionId);
  const store = getActionApprovalStore();
  const decision = input.decision;
  return store.decide(actionId, input, { actor: context.actor }, {
    decidedEventType: decision === 'approved'
      ? 'orca.contract_change_approved'
      : 'orca.contract_change_rejected',
  });
}

function completeContractChangeRequest(actionId, input, context = {}) {
  // Guard: ensure the action being completed is actually a contract change request.
  getContractChangeRequest(actionId);
  const store = getActionApprovalStore();
  return store.attachResult(actionId, input, { actor: context.actor }, {
    completedEventType: 'orca.contract_change_completed',
    failedEventType: 'orca.contract_change_rejected',
  });
}

module.exports = {
  APP_IDS,
  CHANGE_TYPES,
  CONTRACT_TYPES,
  ContractChangeRequestError,
  completeContractChangeRequest,
  createContractChangeRequest,
  decideContractChangeRequest,
  getContractChangeRequest,
  listContractChangeRequests,
  validateContractChangeRequest,
};
