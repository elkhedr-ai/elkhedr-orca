// AUTO-GENERATED FILE. Do not edit by hand.
// Source: contracts/json-schema/*.json and contracts/openapi/app-contracts.openapi.yaml
'use strict';

const APP_IDS = Object.freeze([
  "os",
  "memory",
  "studio",
  "orca",
  "omni",
  "workspace"
]);
const APP_KINDS = Object.freeze([
  "os_shell",
  "standalone_product_app",
  "standalone_service_app"
]);
const INTEGRATION_MODES = Object.freeze([
  "standalone",
  "composed",
  "headless"
]);
const API_ENDPOINTS = Object.freeze({
  "completeOmniRun": {
    "method": "POST",
    "path": "/api/omni/runs/{runId}/complete"
  },
  "completeOrcaActionRequest": {
    "method": "POST",
    "path": "/api/orca/actions/{actionId}/result"
  },
  "createChatMessage": {
    "method": "POST",
    "path": "/api/chat/messages"
  },
  "createMemoryItem": {
    "method": "POST",
    "path": "/api/memory/items"
  },
  "createOfficeDocument": {
    "method": "POST",
    "path": "/api/office/documents"
  },
  "createOmniDepartment": {
    "method": "POST",
    "path": "/api/omni/departments"
  },
  "createOmniSop": {
    "method": "POST",
    "path": "/api/omni/sops"
  },
  "createOrcaActionRequest": {
    "method": "POST",
    "path": "/api/orca/actions"
  },
  "createWorkspaceDocument": {
    "method": "POST",
    "path": "/api/workspace/documents"
  },
  "createWorkspaceExport": {
    "method": "POST",
    "path": "/api/workspace/exports"
  },
  "createWorkspaceSyncJob": {
    "method": "POST",
    "path": "/api/workspace/sync/jobs"
  },
  "decideOmniRunApproval": {
    "method": "POST",
    "path": "/api/omni/runs/{runId}/approval"
  },
  "decideOrcaActionRequest": {
    "method": "POST",
    "path": "/api/orca/actions/{actionId}/approval"
  },
  "deleteMemoryItem": {
    "method": "DELETE",
    "path": "/api/memory/items/{itemId}"
  },
  "discoverApps": {
    "method": "POST",
    "path": "/api/os/discover"
  },
  "evolveMemoryProfile": {
    "method": "POST",
    "path": "/api/memory/evolve"
  },
  "exportMemory": {
    "method": "GET",
    "path": "/api/memory/export"
  },
  "getEntitlementSnapshot": {
    "method": "GET",
    "path": "/api/entitlements/snapshot"
  },
  "getMemoryCloudCompanionStatus": {
    "method": "GET",
    "path": "/api/memory/cloud-companion/status"
  },
  "getMemoryItem": {
    "method": "GET",
    "path": "/api/memory/items/{itemId}"
  },
  "getMemoryProfile": {
    "method": "GET",
    "path": "/api/memory/profile"
  },
  "getOrcaActionRequest": {
    "method": "GET",
    "path": "/api/orca/actions/{actionId}"
  },
  "getOsContext": {
    "method": "GET",
    "path": "/api/os/context"
  },
  "getOsEventRetentionPolicy": {
    "method": "GET",
    "path": "/api/os/events/retention"
  },
  "getRegisteredApp": {
    "method": "GET",
    "path": "/api/os/apps/{appId}"
  },
  "getWorkspaceDocument": {
    "method": "GET",
    "path": "/api/workspace/documents/{documentId}"
  },
  "getWorkspaceSyncStatus": {
    "method": "GET",
    "path": "/api/workspace/sync/status"
  },
  "ingestOsEvent": {
    "method": "POST",
    "path": "/api/os/events"
  },
  "launchApp": {
    "method": "POST",
    "path": "/api/os/launch"
  },
  "listApps": {
    "method": "GET",
    "path": "/api/os/apps"
  },
  "listCapabilities": {
    "method": "GET",
    "path": "/api/capabilities"
  },
  "listChatThreadMessages": {
    "method": "GET",
    "path": "/api/chat/threads/{threadId}/messages"
  },
  "listMemoryEvents": {
    "method": "GET",
    "path": "/api/memory/events"
  },
  "listMemoryItems": {
    "method": "GET",
    "path": "/api/memory/items"
  },
  "listOfficeDocuments": {
    "method": "GET",
    "path": "/api/office/documents"
  },
  "listOmniDepartments": {
    "method": "GET",
    "path": "/api/omni/departments"
  },
  "listOmniEvents": {
    "method": "GET",
    "path": "/api/omni/events"
  },
  "listOmniRuns": {
    "method": "GET",
    "path": "/api/omni/runs"
  },
  "listOmniSops": {
    "method": "GET",
    "path": "/api/omni/sops"
  },
  "listOrcaActionRequests": {
    "method": "GET",
    "path": "/api/orca/actions"
  },
  "listOsEvents": {
    "method": "GET",
    "path": "/api/os/events"
  },
  "listWorkspaceDocumentVersions": {
    "method": "GET",
    "path": "/api/workspace/documents/{documentId}/versions"
  },
  "listWorkspaceDocuments": {
    "method": "GET",
    "path": "/api/workspace/documents"
  },
  "listWorkspaceEvents": {
    "method": "GET",
    "path": "/api/workspace/events"
  },
  "listWorkspaceExports": {
    "method": "GET",
    "path": "/api/workspace/exports"
  },
  "listWorkspaceSyncJobs": {
    "method": "GET",
    "path": "/api/workspace/sync/jobs"
  },
  "memoryHealth": {
    "method": "GET",
    "path": "/api/memory/health"
  },
  "omniHealth": {
    "method": "GET",
    "path": "/api/omni/health"
  },
  "orcaStatus": {
    "method": "GET",
    "path": "/api/orca/status"
  },
  "osHealth": {
    "method": "GET",
    "path": "/api/os/health"
  },
  "probeOsAppAvailability": {
    "method": "POST",
    "path": "/api/os/apps/probe"
  },
  "pruneOsEvents": {
    "method": "POST",
    "path": "/api/os/events/prune"
  },
  "registerApp": {
    "method": "POST",
    "path": "/api/os/apps"
  },
  "replayOsEvents": {
    "method": "POST",
    "path": "/api/os/events/replay"
  },
  "requestMemoryCloudCompanionSync": {
    "method": "POST",
    "path": "/api/memory/cloud-companion/sync"
  },
  "routeOmniDirective": {
    "method": "POST",
    "path": "/api/omni/route"
  },
  "studioHealth": {
    "method": "GET",
    "path": "/api/studio/health"
  },
  "updateEntitlementSnapshot": {
    "method": "POST",
    "path": "/api/entitlements/snapshot"
  },
  "updateMemoryItem": {
    "method": "PATCH",
    "path": "/api/memory/items/{itemId}"
  },
  "updateOsAppAvailability": {
    "method": "PATCH",
    "path": "/api/os/apps/{appId}/availability"
  },
  "updateOsEventRetentionPolicy": {
    "method": "POST",
    "path": "/api/os/events/retention"
  },
  "updateWorkspaceDocument": {
    "method": "PATCH",
    "path": "/api/workspace/documents/{documentId}"
  },
  "workspaceHealth": {
    "method": "GET",
    "path": "/api/workspace/health"
  }
});
const APP_API_PREFIXES = Object.freeze({
  "memory": [
    "/api/memory",
    "/api/chat"
  ],
  "omni": [
    "/api/omni"
  ],
  "orca": [
    "/api/orca"
  ],
  "os": [
    "/api/os",
    "/api/capabilities",
    "/api/entitlements"
  ],
  "studio": [
    "/api/studio"
  ],
  "workspace": [
    "/api/workspace",
    "/api/office"
  ]
});
const APP_CAPABILITY_PREFIXES = Object.freeze({
  "memory": [
    "memory."
  ],
  "omni": [
    "omni."
  ],
  "orca": [
    "orca."
  ],
  "os": [
    "os."
  ],
  "studio": [
    "studio."
  ],
  "workspace": [
    "workspace.",
    "office."
  ]
});

const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$/;
const ROUTE_ID_PATTERN = /^[a-z][a-z0-9_.-]*$/;
const CAPABILITY_PREFIX_PATTERN = /^[a-z][a-z0-9_]*\.$/;
const NAMESPACED_KEY_PATTERN = /^[a-z][a-z0-9_.]*$/;
const ROOT_FIELDS = new Set([
  'id', 'label', 'kind', 'version', 'description', 'standalone', 'routes',
  'apiPrefixes', 'capabilityPrefixes', 'eventTypes', 'artifactTypes',
  'integrationModes', 'doNotTouch',
]);
const STANDALONE_FIELDS = new Set(['repo', 'downloadable', 'bootCommand', 'healthCheck', 'boundary']);
const ROUTE_FIELDS = new Set(['id', 'path', 'label', 'implemented', 'capabilityKey']);

function manifestError(message) {
  throw new Error(`manifest ${message}`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requirePlainObject(value, field) {
  if (!isPlainObject(value)) {
    manifestError(`${field} must be an object`);
  }
}

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    manifestError(`${field} is required`);
  }
}

function validateAllowedFields(value, allowed, field) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      manifestError(`${field} has unsupported field: ${key}`);
    }
  }
}

function requireUniqueStringArray(manifest, field, options = {}) {
  const values = manifest[field];
  if (!Array.isArray(values)) {
    manifestError(`${field} must be an array`);
  }
  if (options.minItems && values.length < options.minItems) {
    manifestError(`${field} must include at least ${options.minItems} item`);
  }
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) {
      manifestError(`${field} entries must be non-empty strings`);
    }
    if (seen.has(value)) {
      manifestError(`${field} entries must be unique`);
    }
    seen.add(value);
    if (options.pattern && !options.pattern.test(value)) {
      manifestError(`${field} entry is invalid: ${value}`);
    }
    if (options.allowed && !options.allowed.includes(value)) {
      manifestError(`${field} entry is not allowed: ${value}`);
    }
  }
  return values;
}

function validateNamespacedValues(values, field, prefixes) {
  for (const value of values) {
    if (!prefixes.some((prefix) => value.startsWith(prefix))) {
      manifestError(`${field} entry ${value} is outside app namespace`);
    }
  }
}

function validateAppManifest(manifest, options = {}) {
  requirePlainObject(manifest, 'root');
  validateAllowedFields(manifest, ROOT_FIELDS, 'root');
  const required = [
    'id', 'label', 'kind', 'version', 'standalone', 'routes', 'apiPrefixes',
    'capabilityPrefixes', 'eventTypes', 'artifactTypes', 'integrationModes',
  ];
  const missing = required.filter((key) => !(key in manifest));
  if (missing.length) manifestError(`missing fields: ${missing.join(', ')}`);
  requireNonEmptyString(manifest.id, 'id');
  if (!APP_IDS.includes(manifest.id)) manifestError(`id is not allowed: ${manifest.id}`);
  if (options.appId && manifest.id !== options.appId) {
    manifestError(`id must be ${options.appId}, got ${manifest.id}`);
  }
  requireNonEmptyString(manifest.label, 'label');
  requireNonEmptyString(manifest.kind, 'kind');
  if (!APP_KINDS.includes(manifest.kind)) manifestError(`kind is not allowed: ${manifest.kind}`);
  if (manifest.id === 'os' && manifest.kind !== 'os_shell') {
    manifestError('os manifest must use kind os_shell');
  }
  if (manifest.id !== 'os' && manifest.kind === 'os_shell') {
    manifestError(`${manifest.id} manifest cannot use kind os_shell`);
  }
  requireNonEmptyString(manifest.version, 'version');
  if (!VERSION_PATTERN.test(manifest.version)) manifestError(`version is invalid: ${manifest.version}`);
  if (manifest.description !== undefined && typeof manifest.description !== 'string') {
    manifestError('description must be a string');
  }
  requirePlainObject(manifest.standalone, 'standalone');
  validateAllowedFields(manifest.standalone, STANDALONE_FIELDS, 'standalone');
  const standaloneRequired = ['repo', 'downloadable', 'bootCommand', 'healthCheck'];
  const missingStandalone = standaloneRequired.filter((key) => !(key in manifest.standalone));
  if (missingStandalone.length) {
    manifestError(`standalone missing fields: ${missingStandalone.join(', ')}`);
  }
  requireNonEmptyString(manifest.standalone.repo, 'standalone.repo');
  if (typeof manifest.standalone.downloadable !== 'boolean') {
    manifestError('standalone.downloadable must be a boolean');
  }
  requireNonEmptyString(manifest.standalone.bootCommand, 'standalone.bootCommand');
  requireNonEmptyString(manifest.standalone.healthCheck, 'standalone.healthCheck');
  if (!manifest.standalone.healthCheck.startsWith('/')) {
    manifestError('standalone.healthCheck must start with /');
  }
  const allowedCapabilityPrefixes = APP_CAPABILITY_PREFIXES[manifest.id] || [];
  const capabilityPrefixes = requireUniqueStringArray(manifest, 'capabilityPrefixes', {
    minItems: 1,
    pattern: CAPABILITY_PREFIX_PATTERN,
  });
  const invalidCapabilityPrefixes = capabilityPrefixes
    .filter((prefix) => !allowedCapabilityPrefixes.includes(prefix));
  if (invalidCapabilityPrefixes.length) {
    manifestError(`capabilityPrefixes not allowed for ${manifest.id}: ${invalidCapabilityPrefixes.join(', ')}`);
  }
  const allowedApiPrefixes = APP_API_PREFIXES[manifest.id] || [];
  requireUniqueStringArray(manifest, 'apiPrefixes', {
    minItems: 1,
    pattern: /^\//,
    allowed: allowedApiPrefixes,
  });
  const integrationModes = requireUniqueStringArray(manifest, 'integrationModes', {
    minItems: 1,
    allowed: INTEGRATION_MODES,
  });
  if (!integrationModes.includes('standalone')) {
    manifestError('integrationModes must include standalone');
  }
  const eventTypes = requireUniqueStringArray(manifest, 'eventTypes', { pattern: NAMESPACED_KEY_PATTERN });
  validateNamespacedValues(eventTypes, 'eventTypes', [`${manifest.id}.`]);
  const artifactTypes = requireUniqueStringArray(manifest, 'artifactTypes', { pattern: NAMESPACED_KEY_PATTERN });
  validateNamespacedValues(artifactTypes, 'artifactTypes', [`${manifest.id}.`]);
  if (!Array.isArray(manifest.routes) || !manifest.routes.length) {
    manifestError('routes must include at least one route');
  }
  const routeIds = new Set();
  for (const route of manifest.routes) {
    requirePlainObject(route, 'route');
    validateAllowedFields(route, ROUTE_FIELDS, 'route');
    requireNonEmptyString(route.id, 'route.id');
    if (!ROUTE_ID_PATTERN.test(route.id)) manifestError(`route.id is invalid: ${route.id}`);
    if (routeIds.has(route.id)) manifestError(`route.id must be unique: ${route.id}`);
    routeIds.add(route.id);
    requireNonEmptyString(route.path, 'route.path');
    if (!route.path.startsWith('/')) manifestError(`route.path must start with /: ${route.path}`);
    requireNonEmptyString(route.label, 'route.label');
    if (route.implemented !== undefined && typeof route.implemented !== 'boolean') {
      manifestError(`route.implemented must be a boolean: ${route.id}`);
    }
    if (route.capabilityKey !== undefined) {
      requireNonEmptyString(route.capabilityKey, 'route.capabilityKey');
      if (!capabilityPrefixes.some((prefix) => route.capabilityKey.startsWith(prefix))) {
        manifestError(`route capabilityKey outside declared prefixes: ${route.capabilityKey}`);
      }
    }
  }
  if (manifest.doNotTouch !== undefined) requireUniqueStringArray(manifest, 'doNotTouch');
  return manifest;
}

function pathFor(operationId, params = {}) {
  const endpoint = API_ENDPOINTS[operationId];
  if (!endpoint) throw new Error(`unknown operationId: ${operationId}`);
  let path = endpoint.path;
  for (const [key, value] of Object.entries(params)) {
    path = path.replace(`{${key}}`, encodeURIComponent(String(value)));
  }
  return path;
}

module.exports = {
  APP_IDS,
  APP_KINDS,
  INTEGRATION_MODES,
  API_ENDPOINTS,
  APP_API_PREFIXES,
  APP_CAPABILITY_PREFIXES,
  pathFor,
  validateAppManifest,
};
