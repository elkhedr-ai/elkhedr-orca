const { randomUUID } = require('node:crypto');

const RISK_LEVELS = ['low', 'medium', 'high', 'critical'];
const RESULT_STATUSES = ['success', 'failure', 'canceled'];
const DANGEROUS_ACTION_TYPES = new Set([
  'shell.execute',
  'terminal.execute',
  'file.write',
  'file.delete',
  'file.move',
  'desktop.control',
  'browser.control',
  'mcp.call',
  'network.authenticated',
]);
const DANGEROUS_CAPABILITIES = new Set([
  'orca.shell',
  'orca.file_write',
  'orca.file_delete',
  'orca.desktop_control',
  'orca.browser_control',
  'orca.mcp_call',
]);

class ActionContractError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'ActionContractError';
    this.statusCode = statusCode;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function now() {
  return new Date().toISOString();
}

function normalizeRisk(risk = 'medium') {
  if (!RISK_LEVELS.includes(risk)) {
    throw new ActionContractError(`risk must be one of: ${RISK_LEVELS.join(', ')}`);
  }
  return risk;
}

function isDangerousAction(action) {
  const risk = normalizeRisk(action.risk || 'medium');
  return (
    risk === 'high' ||
    risk === 'critical' ||
    DANGEROUS_ACTION_TYPES.has(action.actionType) ||
    DANGEROUS_CAPABILITIES.has(action.capabilityKey)
  );
}

function buildActor(actor = {}) {
  return {
    id: actor.id ? String(actor.id) : 'anonymous',
    role: actor.role || 'unknown',
  };
}

function pushEvent(action, type, actor, payload = {}) {
  const event = {
    id: randomUUID(),
    app_id: 'orca',
    event_type: type,
    actor: {
      type: actor.id === 'system' ? 'system' : 'user',
      id: actor.id,
      display_name: actor.role,
    },
    severity: type.endsWith('rejected') || type.endsWith('failed') ? 'warning' : 'info',
    capability_key: action.capabilityKey,
    timestamp: now(),
    payload,
  };
  action.events.push(event);
  return event;
}

class OrcaActionApprovalStore {
  constructor() {
    this.actions = new Map();
  }

  reset() {
    this.actions.clear();
  }

  create(input, context = {}) {
    if (!input || typeof input !== 'object') {
      throw new ActionContractError('request body is required');
    }
    if (!input.actionType || typeof input.actionType !== 'string') {
      throw new ActionContractError('actionType is required');
    }
    if (!input.description || typeof input.description !== 'string') {
      throw new ActionContractError('description is required');
    }

    const actor = buildActor(context.actor);
    const risk = normalizeRisk(input.risk || 'medium');
    const capabilityKey = input.capabilityKey || 'orca.action';
    const approvalRequired = isDangerousAction({
      actionType: input.actionType,
      capabilityKey,
      risk,
    });
    const createdAt = now();
    const action = {
      id: randomUUID(),
      app_id: 'orca',
      actionType: input.actionType,
      capabilityKey,
      description: input.description,
      risk,
      approvalRequired,
      status: approvalRequired ? 'pending_approval' : 'approved',
      params: input.params && typeof input.params === 'object' ? input.params : {},
      sessionId: input.sessionId || null,
      requestedBy: actor,
      approvals: [],
      result: null,
      events: [],
      createdAt,
      updatedAt: createdAt,
    };

    pushEvent(action, 'orca.action_requested', actor, {
      actionType: action.actionType,
      approvalRequired,
      risk,
      status: action.status,
    });
    if (!approvalRequired) {
      pushEvent(action, 'orca.action_approved', { id: 'system', role: 'system' }, {
        decision: 'approved',
        reason: 'Approval not required for low-risk action.',
      });
    }

    this.actions.set(action.id, action);
    return clone(action);
  }

  list(filters = {}) {
    const actions = Array.from(this.actions.values()).filter((action) => {
      return !filters.status || action.status === filters.status;
    });
    actions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return clone(actions);
  }

  get(actionId) {
    const action = this.actions.get(actionId);
    if (!action) {
      throw new ActionContractError('Action request not found', 404);
    }
    return clone(action);
  }

  decide(actionId, input = {}, context = {}) {
    const action = this.actions.get(actionId);
    if (!action) {
      throw new ActionContractError('Action request not found', 404);
    }
    if (action.status !== 'pending_approval') {
      throw new ActionContractError(`Action is not pending approval: ${action.status}`, 409);
    }

    const decision = input.decision;
    if (!['approved', 'rejected'].includes(decision)) {
      throw new ActionContractError('decision must be approved or rejected');
    }

    const actor = buildActor(context.actor);
    const approval = {
      id: randomUUID(),
      decision,
      reason: input.reason || null,
      approvedBy: actor,
      createdAt: now(),
    };
    action.approvals.push(approval);
    action.status = decision === 'approved' ? 'approved' : 'rejected';
    action.updatedAt = approval.createdAt;
    pushEvent(action, `orca.action_${decision}`, actor, {
      decision,
      reason: approval.reason,
    });
    return clone(action);
  }

  attachResult(actionId, input = {}, context = {}) {
    const action = this.actions.get(actionId);
    if (!action) {
      throw new ActionContractError('Action request not found', 404);
    }
    if (action.status !== 'approved') {
      throw new ActionContractError(`Action must be approved before result: ${action.status}`, 409);
    }

    const status = input.status || 'success';
    if (!RESULT_STATUSES.includes(status)) {
      throw new ActionContractError(`status must be one of: ${RESULT_STATUSES.join(', ')}`);
    }

    const actor = buildActor(context.actor);
    const completedAt = now();
    action.result = {
      status,
      summary: input.summary || '',
      artifacts: Array.isArray(input.artifacts) ? input.artifacts : [],
      metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
      reportedBy: actor,
      completedAt,
    };
    action.status = status === 'success' ? 'completed' : status;
    action.updatedAt = completedAt;
    pushEvent(action, status === 'success' ? 'orca.action_completed' : 'orca.action_failed', actor, {
      resultStatus: status,
      artifactCount: action.result.artifacts.length,
    });
    return clone(action);
  }
}

const store = new OrcaActionApprovalStore();

module.exports = {
  ActionContractError,
  DANGEROUS_ACTION_TYPES,
  DANGEROUS_CAPABILITIES,
  OrcaActionApprovalStore,
  getActionApprovalStore: () => store,
  isDangerousAction,
};
