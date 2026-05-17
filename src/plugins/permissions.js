/**
 * Permission System for Skills
 * 
 * RBAC for skills with required permission declarations.
 * Skills must declare permissions in their manifest.
 * Elevated permissions (execute, filesystem, network) require explicit approval.
 */

const { logger } = require('../utils/logger.js');
const { ValidationError, AuthorizationError } = require('../utils/errors.js');

// Permission levels
const PERMISSIONS = {
  READ: 'read',
  WRITE: 'write', 
  EXECUTE: 'execute',
  NETWORK: 'network',
  FILESYSTEM: 'filesystem'
};

// Permissions considered "elevated" - require explicit approval
const ELEVATED_PERMISSIONS = [
  PERMISSIONS.EXECUTE,
  PERMISSIONS.FILESYSTEM,
  PERMISSIONS.NETWORK
];

// In-memory store for approved permissions per skill
// In production, this would be persisted to database
const approvedPermissions = new Map();
const approvalCallbacks = new Set();

/**
 * Validate that a permission string is valid
 */
function validatePermission(permission) {
  const validPermissions = Object.values(PERMISSIONS);
  if (!validPermissions.includes(permission)) {
    throw new ValidationError(
      `Invalid permission: "${permission}". Valid permissions: ${validPermissions.join(', ')}`
    );
  }
  return permission;
}

/**
 * Validate a list of permissions
 */
function validatePermissions(permissions) {
  if (!Array.isArray(permissions)) {
    throw new ValidationError('Permissions must be an array');
  }
  return permissions.map(validatePermission);
}

/**
 * Check if a permission is elevated
 */
function isElevatedPermission(permission) {
  return ELEVATED_PERMISSIONS.includes(permission);
}

/**
 * Get elevated permissions from a list
 */
function getElevatedPermissions(permissions) {
  return permissions.filter(isElevatedPermission);
}

/**
 * Check if a skill has been approved for all its elevated permissions
 */
function isApproved(skillName, permissions) {
  const approved = approvedPermissions.get(skillName);
  if (!approved) {
    return false;
  }
  
  const elevated = getElevatedPermissions(permissions);
  return elevated.every(p => approved.includes(p));
}

/**
 * Approve a skill's permissions
 * @param {string} skillName - Name of the skill
 * @param {string[]} permissions - Permissions to approve
 * @param {Object} options - Approval options
 * @param {string} options.approvedBy - Who approved (user ID or "system")
 * @param {Date} options.expiresAt - When approval expires (null for never)
 */
function approveSkill(skillName, permissions, options = {}) {
  const { approvedBy = 'system', expiresAt = null } = options;
  
  validatePermissions(permissions);
  
  const existing = approvedPermissions.get(skillName) || [];
  const updated = [...new Set([...existing, ...permissions])];
  
  approvedPermissions.set(skillName, updated);
  
  logger.info({
    skill: skillName,
    permissions,
    approvedBy,
    expiresAt
  }, 'Skill permissions approved');
  
  // Notify subscribers
  for (const callback of approvalCallbacks) {
    try {
      callback(skillName, permissions, { approvedBy, expiresAt });
    } catch (error) {
      logger.error({ error: error.message }, 'Permission approval callback error');
    }
  }
  
  return { skillName, permissions: updated, approvedBy, expiresAt };
}

/**
 * Revoke approval for a skill
 */
function revokeApproval(skillName, permissions = null) {
  if (permissions === null) {
    approvedPermissions.delete(skillName);
    logger.info({ skill: skillName }, 'All skill permissions revoked');
    return { skillName, revoked: 'all' };
  }
  
  const existing = approvedPermissions.get(skillName);
  if (!existing) {
    return { skillName, revoked: [] };
  }
  
  const updated = existing.filter(p => !permissions.includes(p));
  
  if (updated.length === 0) {
    approvedPermissions.delete(skillName);
  } else {
    approvedPermissions.set(skillName, updated);
  }
  
  logger.info({ skill: skillName, permissions }, 'Skill permissions revoked');
  return { skillName, revoked: permissions };
}

/**
 * Check if a skill can execute with its declared permissions
 * @param {string} skillName - Skill name
 * @param {string[]} declaredPermissions - Permissions declared in manifest
 * @param {Object} options - Check options
 * @param {boolean} options.autoApprove - Auto-approve non-elevated permissions
 * @throws {AuthorizationError} If permissions are not satisfied
 */
function checkExecutionPermission(skillName, declaredPermissions, options = {}) {
  const { autoApprove = false } = options;
  
  // Validate declared permissions
  validatePermissions(declaredPermissions);
  
  const elevated = getElevatedPermissions(declaredPermissions);
  
  // If no elevated permissions, execution is allowed (after logging)
  if (elevated.length === 0) {
    logger.debug({ skill: skillName, permissions: declaredPermissions }, 'Skill execution allowed (no elevated perms)');
    return { allowed: true, requiresApproval: false };
  }
  
  // Check if already approved
  if (isApproved(skillName, declaredPermissions)) {
    logger.debug({ skill: skillName, permissions: elevated }, 'Skill execution allowed (pre-approved)');
    return { allowed: true, requiresApproval: false, approved: true };
  }
  
  // Auto-approve if configured
  if (autoApprove) {
    approveSkill(skillName, elevated, { approvedBy: 'auto' });
    logger.info({ skill: skillName, permissions: elevated }, 'Skill permissions auto-approved');
    return { allowed: true, requiresApproval: false, autoApproved: true };
  }
  
  // Requires explicit approval
  logger.warn({
    skill: skillName,
    permissions: elevated,
    declaredPermissions
  }, 'Skill execution blocked - requires permission approval');
  
  throw new AuthorizationError(
    `Skill "${skillName}" requires explicit approval for elevated permissions: ${elevated.join(', ')}`,
    {
      skill: skillName,
      requiredPermissions: elevated,
      hint: `Use /approve-skill ${skillName} to grant permissions`
    }
  );
}

/**
 * Check a specific permission for a skill (e.g., at runtime)
 */
function assertPermission(skillName, permission, context = {}) {
  validatePermission(permission);
  
  if (isElevatedPermission(permission)) {
    const approved = approvedPermissions.get(skillName) || [];
    if (!approved.includes(permission)) {
      throw new AuthorizationError(
        `Skill "${skillName}" does not have "${permission}" permission`,
        { skill: skillName, permission, context }
      );
    }
  }
  
  return true;
}

/**
 * Subscribe to approval events
 */
function onApproval(callback) {
  approvalCallbacks.add(callback);
  return () => approvalCallbacks.delete(callback);
}

/**
 * Get approval status for a skill
 */
function getApprovalStatus(skillName) {
  const approved = approvedPermissions.get(skillName) || [];
  return {
    skill: skillName,
    approved,
    pending: []
  };
}

/**
 * Reset all approvals (useful for testing)
 */
function reset() {
  approvedPermissions.clear();
  approvalCallbacks.clear();
}

module.exports = {
  PERMISSIONS,
  ELEVATED_PERMISSIONS,
  validatePermission,
  validatePermissions,
  isElevatedPermission,
  getElevatedPermissions,
  isApproved,
  approveSkill,
  revokeApproval,
  checkExecutionPermission,
  assertPermission,
  onApproval,
  getApprovalStatus,
  reset
};
