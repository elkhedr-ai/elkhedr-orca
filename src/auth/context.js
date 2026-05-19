const { hasPermission, can } = require('./rbac');

/**
 * User Context Module
 * Manages the current user context for request/session isolation.
 * This is a simple in-memory context store that should be set per-request or per-session.
 */

// Default context with no user (anonymous)
let currentContext = {
  userId: null,
  userRole: null, // 'admin', 'user', 'guest', etc.
  sessionId: null
};

/**
 * Set the current user context
 * @param {Object} ctx - { userId, userRole, sessionId }
 */
function setUserContext(ctx) {
  currentContext = {
    userId: ctx.userId || null,
    userRole: ctx.userRole || null,
    sessionId: ctx.sessionId || null
  };
}

/**
 * Get the current user context
 * @returns {Object} { userId, userRole, sessionId }
 */
function getUserContext() {
  return { ...currentContext };
}

/**
 * Check if current user is authenticated
 * @returns {boolean}
 */
function isAuthenticated() {
  return currentContext.userId !== null;
}

/**
 * Check if current user has admin role
 * @returns {boolean}
 */
function isAdmin() {
  return currentContext.userRole === 'admin';
}

/**
 * Check if current user has a specific permission
 * @param {string} permission
 * @returns {boolean}
 */
function hasPerm(permission) {
  if (!isAuthenticated()) return false;
  return hasPermission(currentContext.userRole, permission);
}

/**
 * Check if current user can perform action on resource
 * @param {string} action - Action being attempted
 * @param {string} resource - Resource type
 * @param {boolean} isOwnResource - Whether resource belongs to user
 * @returns {boolean}
 */
function canPerform(action, resource, isOwnResource = true) {
  if (!isAuthenticated()) return false;
  return can(currentContext.userRole, action, resource, isOwnResource);
}

/**
 * Check if current user can access data for a specific user_id
 * Admin can access all data; regular users can only access their own
 * @param {number|null} targetUserId - The user_id of the resource being accessed
 * @returns {boolean}
 */
function canAccess(targetUserId) {
  // Admin can access everything
  if (isAdmin()) return true;
  // Unauthenticated can only access public/null resources
  if (!isAuthenticated()) return targetUserId === null;
  // Authenticated users can access their own data or public data
  return currentContext.userId === targetUserId || targetUserId === null;
}

/**
 * Clear the user context (e.g., on logout)
 */
function clearUserContext() {
  currentContext = {
    userId: null,
    userRole: null,
    sessionId: null
  };
}

module.exports = {
  setUserContext,
  getUserContext,
  isAuthenticated,
  isAdmin,
  hasPerm,
  canPerform,
  canAccess,
  clearUserContext
};
