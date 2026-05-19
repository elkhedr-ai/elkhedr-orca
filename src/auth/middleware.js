/**
 * Authentication Middleware
 * Provides route protection and auth context injection
 */

const { verifyAccessToken, extractBearerToken } = require('./jwt');
const { setUserContext, getUserContext, clearUserContext } = require('./context');
const { getUserById } = require('./index');
const { validateApiKey, hasScope } = require('./api-keys');
const { hasPermission } = require('./rbac');

/**
 * Express/Fastify middleware to require authentication
 * Usage: app.use(requireAuth()) or app.get('/route', requireAuth(), handler)
 * @param {Object} options - { allowGuest: boolean }
 * @returns {Function} Middleware function
 */
function requireAuth(options = {}) {
  return async function(req, res, next) {
    try {
      const authHeader = req.headers?.authorization || req.headers?.Authorization;
      const token = extractBearerToken(authHeader);

      // Check for API key authentication
      const apiKeyHeader = req.headers?.['x-api-key'] || req.headers?.['X-API-Key'];
      if (apiKeyHeader) {
        const apiKeyData = await validateApiKey(apiKeyHeader);
        if (apiKeyData) {
          const user = await getUserById(apiKeyData.userId);
          if (user) {
            setUserContext({
              userId: user.id,
              userRole: user.role,
              sessionId: null
            });
            req.user = user;
            req.authType = 'api-key';
            req.apiKeyScopes = apiKeyData.scopes;
            if (next) next();
            return;
          }
        }
        return res.status(401).json({
          error: 'Invalid API key',
          code: 'INVALID_API_KEY'
        });
      }

      if (!token) {
        if (options.allowGuest) {
          clearUserContext();
          if (next) next();
          return;
        }
        return res.status(401).json({
          error: 'Authentication required',
          code: 'NO_TOKEN'
        });
      }

      const decoded = verifyAccessToken(token);
      if (!decoded) {
        return res.status(401).json({
          error: 'Invalid or expired token',
          code: 'INVALID_TOKEN'
        });
      }

      // Verify user still exists
      const user = await getUserById(decoded.userId);
      if (!user) {
        return res.status(401).json({
          error: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }

      // Set user context
      setUserContext({
        userId: user.id,
        userRole: user.role,
        sessionId: null
      });

      // Attach user to request
      req.user = user;
      req.authType = 'jwt';

      if (next) next();
    } catch (error) {
      return res.status(500).json({
        error: 'Authentication error',
        code: 'AUTH_ERROR'
      });
    }
  };
}

/**
 * Middleware to require specific role(s)
 * Must be used after requireAuth
 * @param {string|string[]} roles - Required role(s)
 * @returns {Function} Middleware function
 */
function requireRole(roles) {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];

  return function(req, res, next) {
    const ctx = getUserContext();

    if (!ctx.userId) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'NO_AUTH'
      });
    }

    if (!allowedRoles.includes(ctx.userRole)) {
      return res.status(403).json({
        error: `Required role: ${allowedRoles.join(' or ')}`,
        code: 'FORBIDDEN',
        currentRole: ctx.userRole
      });
    }

    if (next) next();
  };
}

/**
 * Middleware to require admin role
 * Convenience wrapper around requireRole('admin')
 */
function requireAdmin() {
  return requireRole('admin');
}

/**
 * Middleware to require specific permission
 * Must be used after requireAuth
 * @param {string} permission - Required permission string
 * @returns {Function} Middleware function
 */
function requirePermission(permission) {
  return function(req, res, next) {
    const ctx = getUserContext();

    if (!ctx.userId) {
      return res.status(401).json({
        error: 'Authentication required',
        code: 'NO_AUTH'
      });
    }

    if (!hasPermission(ctx.userRole, permission)) {
      return res.status(403).json({
        error: `Required permission: ${permission}`,
        code: 'FORBIDDEN',
        currentRole: ctx.userRole
      });
    }

    if (next) next();
  };
}

/**
 * Middleware to require API key scope
 * Must be used after requireAuth when using API keys
 * @param {string} scope - Required scope: 'read', 'write', or 'admin'
 * @returns {Function} Middleware function
 */
function requireScope(scope) {
  return function(req, res, next) {
    // JWT auth (not API key) bypasses scope checks (uses role-based instead)
    if (req.authType !== 'api-key') {
      if (next) next();
      return;
    }

    if (!req.apiKeyScopes || !hasScope(req.apiKeyScopes, scope)) {
      return res.status(403).json({
        error: `API key requires '${scope}' scope`,
        code: 'INSUFFICIENT_SCOPE',
        currentScopes: req.apiKeyScopes || []
      });
    }

    if (next) next();
  };
}

/**
 * CLI middleware equivalent
 * For use in CLI/TUI contexts where HTTP middleware doesn't apply
 * @param {string} token - JWT access token
 * @returns {Promise<Object|null>} User object or null
 */
async function authenticateCli(token) {
  if (!token) {
    clearUserContext();
    return null;
  }

  const decoded = verifyAccessToken(token);
  if (!decoded) {
    clearUserContext();
    return null;
  }

  const user = await getUserById(decoded.userId);
  if (!user) {
    clearUserContext();
    return null;
  }

  setUserContext({
    userId: user.id,
    userRole: user.role,
    sessionId: null
  });

  return user;
}

/**
 * Authenticate by API key for CLI usage
 * @param {string} apiKey - Raw API key
 * @returns {Promise<Object|null>} User object or null
 */
async function authenticateByApiKey(apiKey) {
  if (!apiKey) {
    clearUserContext();
    return null;
  }

  const apiKeyData = await validateApiKey(apiKey);
  if (!apiKeyData) {
    clearUserContext();
    return null;
  }

  const user = await getUserById(apiKeyData.userId);
  if (!user) {
    clearUserContext();
    return null;
  }

  setUserContext({
    userId: user.id,
    userRole: user.role,
    sessionId: null
  });

  return { ...user, scopes: apiKeyData.scopes };
}

/**
 * Get current auth status for health checks
 * @returns {Object} { authenticated, userId, role }
 */
function getAuthStatus() {
  const ctx = getUserContext();
  return {
    authenticated: ctx.userId !== null,
    userId: ctx.userId,
    role: ctx.userRole
  };
}

module.exports = {
  requireAuth,
  requireRole,
  requireAdmin,
  requirePermission,
  requireScope,
  authenticateCli,
  authenticateByApiKey,
  getAuthStatus
};
