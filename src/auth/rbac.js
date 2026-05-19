/**
 * Role-Based Access Control (RBAC) System
 * Defines roles, permissions, and access control utilities
 */

// Role hierarchy (higher index = more permissions)
const ROLE_HIERARCHY = ['guest', 'user', 'manager', 'admin'];

// Permission definitions
const PERMISSIONS = {
  // Agent operations
  AGENT: {
    VIEW: 'agent:view',
    CREATE: 'agent:create',
    UPDATE: 'agent:update',
    DELETE: 'agent:delete',
    EXECUTE: 'agent:execute'
  },
  // Tool operations
  TOOL: {
    VIEW: 'tool:view',
    USE: 'tool:use',
    MANAGE: 'tool:manage'
  },
  // Data operations
  DATA: {
    VIEW_OWN: 'data:view:own',
    VIEW_ALL: 'data:view:all',
    MODIFY_OWN: 'data:modify:own',
    MODIFY_ALL: 'data:modify:all',
    DELETE_OWN: 'data:delete:own',
    DELETE_ALL: 'data:delete:all'
  },
  // Session operations
  SESSION: {
    VIEW_OWN: 'session:view:own',
    VIEW_ALL: 'session:view:all',
    MANAGE_OWN: 'session:manage:own',
    MANAGE_ALL: 'session:manage:all'
  },
  // Knowledge base
  KB: {
    VIEW: 'kb:view',
    CREATE: 'kb:create',
    UPDATE_OWN: 'kb:update:own',
    UPDATE_ALL: 'kb:update:all',
    DELETE_OWN: 'kb:delete:own',
    DELETE_ALL: 'kb:delete:all'
  },
  // Analytics
  ANALYTICS: {
    VIEW_OWN: 'analytics:view:own',
    VIEW_ALL: 'analytics:view:all'
  },
  // User management
  USER: {
    VIEW: 'user:view',
    CREATE: 'user:create',
    UPDATE: 'user:update',
    DELETE: 'user:delete',
    MANAGE_ROLES: 'user:manage:roles'
  },
  // System
  SYSTEM: {
    CONFIG: 'system:config',
    LOGS: 'system:logs',
    BACKUP: 'system:backup',
    SHUTDOWN: 'system:shutdown'
  }
};

// Role-permission mappings
const ROLE_PERMISSIONS = {
  guest: [
    PERMISSIONS.AGENT.VIEW,
    PERMISSIONS.TOOL.VIEW,
    PERMISSIONS.DATA.VIEW_OWN,
    PERMISSIONS.SESSION.VIEW_OWN,
    PERMISSIONS.KB.VIEW,
    PERMISSIONS.ANALYTICS.VIEW_OWN
  ],
  user: [
    PERMISSIONS.AGENT.VIEW,
    PERMISSIONS.AGENT.EXECUTE,
    PERMISSIONS.TOOL.VIEW,
    PERMISSIONS.TOOL.USE,
    PERMISSIONS.DATA.VIEW_OWN,
    PERMISSIONS.DATA.MODIFY_OWN,
    PERMISSIONS.DATA.DELETE_OWN,
    PERMISSIONS.SESSION.VIEW_OWN,
    PERMISSIONS.SESSION.MANAGE_OWN,
    PERMISSIONS.KB.VIEW,
    PERMISSIONS.KB.CREATE,
    PERMISSIONS.KB.UPDATE_OWN,
    PERMISSIONS.KB.DELETE_OWN,
    PERMISSIONS.ANALYTICS.VIEW_OWN
  ],
  manager: [
    // Inherits all user permissions + team management
    PERMISSIONS.AGENT.VIEW,
    PERMISSIONS.AGENT.EXECUTE,
    PERMISSIONS.AGENT.CREATE,
    PERMISSIONS.AGENT.UPDATE,
    PERMISSIONS.TOOL.VIEW,
    PERMISSIONS.TOOL.USE,
    PERMISSIONS.TOOL.MANAGE,
    PERMISSIONS.DATA.VIEW_ALL,
    PERMISSIONS.DATA.MODIFY_OWN,
    PERMISSIONS.DATA.DELETE_OWN,
    PERMISSIONS.SESSION.VIEW_ALL,
    PERMISSIONS.SESSION.MANAGE_OWN,
    PERMISSIONS.KB.VIEW,
    PERMISSIONS.KB.CREATE,
    PERMISSIONS.KB.UPDATE_OWN,
    PERMISSIONS.KB.DELETE_OWN,
    PERMISSIONS.ANALYTICS.VIEW_ALL,
    PERMISSIONS.USER.VIEW
  ],
  admin: [
    // All permissions
    ...Object.values(PERMISSIONS.AGENT),
    ...Object.values(PERMISSIONS.TOOL),
    ...Object.values(PERMISSIONS.DATA),
    ...Object.values(PERMISSIONS.SESSION),
    ...Object.values(PERMISSIONS.KB),
    ...Object.values(PERMISSIONS.ANALYTICS),
    ...Object.values(PERMISSIONS.USER),
    ...Object.values(PERMISSIONS.SYSTEM)
  ]
};

/**
 * Get permissions for a role
 * @param {string} role
 * @returns {string[]} Array of permission strings
 */
function getRolePermissions(role) {
  return ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.guest;
}

/**
 * Check if a role has a specific permission
 * @param {string} role
 * @param {string} permission
 * @returns {boolean}
 */
function hasPermission(role, permission) {
  const permissions = getRolePermissions(role);
  return permissions.includes(permission);
}

/**
 * Check if role A has equal or higher rank than role B
 * @param {string} roleA
 * @param {string} roleB
 * @returns {boolean}
 */
function hasHigherOrEqualRole(roleA, roleB) {
  const indexA = ROLE_HIERARCHY.indexOf(roleA);
  const indexB = ROLE_HIERARCHY.indexOf(roleB);
  if (indexA === -1 || indexB === -1) return false;
  return indexA >= indexB;
}

/**
 * Check if user can perform action on resource
 * @param {string} role - User's role
 * @param {string} action - Action being attempted
 * @param {string} resource - Resource type
 * @param {boolean} isOwnResource - Whether resource belongs to user
 * @returns {boolean}
 */
function can(role, action, resource, isOwnResource = true) {
  // Admin can do everything
  if (role === 'admin') return true;

  const permissions = getRolePermissions(role);

  // Check specific permission first
  const specificPerm = `${resource}:${action}${isOwnResource ? ':own' : ':all'}`;
  if (permissions.includes(specificPerm)) return true;

  // Check general permission (without :own/:all suffix)
  const generalPerm = `${resource}:${action}`;
  if (permissions.includes(generalPerm)) return true;

  // For own resources, also check :all permission (grants :own implicitly)
  if (isOwnResource) {
    const allPerm = `${resource}:${action}:all`;
    if (permissions.includes(allPerm)) return true;
  }

  return false;
}

/**
 * Check if user can view data
 * @param {string} role
 * @param {boolean} isOwnData
 */
function canView(role, isOwnData = true) {
  return can(role, 'view', 'data', isOwnData);
}

/**
 * Check if user can modify data
 * @param {string} role
 * @param {boolean} isOwnData
 */
function canModify(role, isOwnData = true) {
  return can(role, 'modify', 'data', isOwnData);
}

/**
 * Check if user can delete data
 * @param {string} role
 * @param {boolean} isOwnData
 */
function canDelete(role, isOwnData = true) {
  return can(role, 'delete', 'data', isOwnData);
}

/**
 * Check if user can execute agents
 * @param {string} role
 */
function canExecuteAgent(role) {
  return hasPermission(role, PERMISSIONS.AGENT.EXECUTE);
}

/**
 * Check if user can manage users
 * @param {string} role
 */
function canManageUsers(role) {
  return hasPermission(role, PERMISSIONS.USER.MANAGE_ROLES);
}

/**
 * Check if user can view analytics
 * @param {string} role
 * @param {boolean} isOwnAnalytics
 */
function canViewAnalytics(role, isOwnAnalytics = true) {
  return can(role, 'view', 'analytics', isOwnAnalytics);
}

/**
 * Get all available roles
 * @returns {string[]}
 */
function getRoles() {
  return [...ROLE_HIERARCHY];
}

/**
 * Validate if role is valid
 * @param {string} role
 * @returns {boolean}
 */
function isValidRole(role) {
  return ROLE_HIERARCHY.includes(role);
}

/**
 * Get role display name
 * @param {string} role
 * @returns {string}
 */
function getRoleDisplayName(role) {
  const displayNames = {
    guest: 'Guest',
    user: 'User',
    manager: 'Manager',
    admin: 'Administrator'
  };
  return displayNames[role] || role;
}

module.exports = {
  PERMISSIONS,
  ROLE_HIERARCHY,
  ROLE_PERMISSIONS,
  getRolePermissions,
  hasPermission,
  hasHigherOrEqualRole,
  can,
  canView,
  canModify,
  canDelete,
  canExecuteAgent,
  canManageUsers,
  canViewAnalytics,
  getRoles,
  isValidRole,
  getRoleDisplayName
};
