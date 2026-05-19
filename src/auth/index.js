/**
 * Authentication System
 * Handles user registration, login, token management, and password reset
 */

const bcrypt = require('bcryptjs');
const { getDatabaseInstance } = require('../db');
const {
  generateTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  refreshAccessToken
} = require('./jwt');
const { setUserContext, clearUserContext } = require('./context');
const { logAuthEvent, logSystemEvent } = require('../audit/logger');

const SALT_ROUNDS = 12;

// In-memory store for password reset tokens (in production, use DB or Redis)
const resetTokens = new Map();

/**
 * Register a new user
 * @param {string} username
 * @param {string} email
 * @param {string} password
 * @param {string} role - 'user', 'admin', 'manager', 'guest'
 * @returns {Promise<Object>} { user: {id, username, email, role}, tokens: {accessToken, refreshToken} }
 */
async function registerUser(username, email, password, role = 'user') {
  if (!username || !email || !password) {
    throw new Error('Username, email, and password are required');
  }

  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }

  const db = await getDatabaseInstance();

  // Check if username or email already exists
  const existingUser = await db.getAdapter().query(
    'SELECT id FROM users WHERE username = ? OR email = ?',
    [username, email]
  );

  if (existingUser.length > 0) {
    throw new Error('Username or email already exists');
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  // Insert user
  const result = await db.getAdapter().execute(
    'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [username, email, passwordHash, role]
  );

  const userId = result.lastInsertRowid;

  // Generate tokens
  const tokens = generateTokenPair({
    userId,
    username,
    role
  });

    // Store refresh token in DB
  await db.getAdapter().execute(
    'UPDATE users SET refresh_token = ? WHERE id = ?',
    [tokens.refreshToken, userId]
  );

  // Log registration
  await logAuthEvent('register', 'success', {
    userId,
    userRole: role,
    method: 'email'
  });

  return {
    user: {
      id: userId,
      username,
      email,
      role
    },
    tokens
  };
}

/**
 * Login user
 * @param {string} usernameOrEmail - Username or email
 * @param {string} password
 * @returns {Promise<Object>} { user: {id, username, email, role}, tokens: {accessToken, refreshToken} }
 */
async function loginUser(usernameOrEmail, password) {
  if (!usernameOrEmail || !password) {
    throw new Error('Username/email and password are required');
  }

  const db = await getDatabaseInstance();

  // Find user by username or email
  const users = await db.getAdapter().query(
    'SELECT id, username, email, password_hash, role FROM users WHERE username = ? OR email = ?',
    [usernameOrEmail, usernameOrEmail]
  );

  if (users.length === 0) {
    // Log failed login
    await logAuthEvent('login', 'failure', {
      reason: 'user_not_found',
      method: 'email'
    });
    throw new Error('Invalid credentials');
  }

  const user = users[0];

  // Verify password
  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    // Log failed login
    await logAuthEvent('login', 'failure', {
      userId: user.id,
      userRole: user.role,
      reason: 'invalid_password',
      method: 'email'
    });
    throw new Error('Invalid credentials');
  }

  // Generate tokens
  const tokens = generateTokenPair({
    userId: user.id,
    username: user.username,
    role: user.role
  });

  // Store refresh token in DB
  await db.getAdapter().execute(
    'UPDATE users SET refresh_token = ? WHERE id = ?',
    [tokens.refreshToken, user.id]
  );

  // Set user context
  setUserContext({
    userId: user.id,
    userRole: user.role,
    sessionId: null
  });

  // Log successful login
  await logAuthEvent('login', 'success', {
    userId: user.id,
    userRole: user.role,
    method: 'email'
  });

  return {
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    },
    tokens
  };
}

/**
 * Logout user
 * @param {number} userId
 */
async function logoutUser(userId) {
  const db = await getDatabaseInstance();

  // Clear refresh token from DB
  await db.getAdapter().execute(
    'UPDATE users SET refresh_token = NULL WHERE id = ?',
    [userId]
  );

  // Log logout
  await logAuthEvent('logout', 'success', {
    userId,
    method: 'manual'
  });

  clearUserContext();
}

/**
 * Verify access token and set user context
 * @param {string} accessToken
 * @returns {Promise<Object|null>} User object or null
 */
async function verifyAndSetUser(accessToken) {
  const decoded = verifyAccessToken(accessToken);
  if (!decoded) {
    return null;
  }

  // Verify user still exists
  const db = await getDatabaseInstance();
  const users = await db.getAdapter().query(
    'SELECT id, username, email, role FROM users WHERE id = ?',
    [decoded.userId]
  );

  if (users.length === 0) {
    return null;
  }

  const user = users[0];

  // Set user context
  setUserContext({
    userId: user.id,
    userRole: user.role,
    sessionId: null
  });

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role
  };
}

/**
 * Refresh tokens using refresh token
 * @param {string} refreshToken
 * @returns {Promise<Object|null>} { accessToken, refreshToken, user } or null
 */
async function refreshUserTokens(refreshToken) {
  const decoded = verifyRefreshToken(refreshToken);
  if (!decoded) {
    return null;
  }

  const db = await getDatabaseInstance();

  // Verify refresh token matches what's in DB
  const users = await db.getAdapter().query(
    'SELECT id, username, email, role, refresh_token FROM users WHERE id = ?',
    [decoded.userId]
  );

  if (users.length === 0 || users[0].refresh_token !== refreshToken) {
    return null;
  }

  const user = users[0];

  // Generate new tokens
  const tokens = generateTokenPair({
    userId: user.id,
    username: user.username,
    role: user.role
  });

  // Update refresh token in DB
  await db.getAdapter().execute(
    'UPDATE users SET refresh_token = ? WHERE id = ?',
    [tokens.refreshToken, user.id]
  );

  return {
    tokens,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    }
  };
}

/**
 * Request password reset
 * @param {string} email
 * @returns {Promise<Object>} { resetToken, expiresAt }
 */
async function requestPasswordReset(email) {
  const db = await getDatabaseInstance();

  const users = await db.getAdapter().query(
    'SELECT id, username FROM users WHERE email = ?',
    [email]
  );

  if (users.length === 0) {
    throw new Error('No user found with that email');
  }

  const user = users[0];

  // Generate reset token (simple random string)
  const crypto = require('crypto');
  const resetToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 3600000); // 1 hour

  // Store in memory (in production, use DB or Redis)
  resetTokens.set(resetToken, {
    userId: user.id,
    expiresAt
  });

  // Also store in DB for persistence
  await db.getAdapter().execute(
    'UPDATE users SET reset_token = ?, reset_token_expires_at = ? WHERE id = ?',
    [resetToken, expiresAt.toISOString(), user.id]
  );

  // Log password reset request
  await logAuthEvent('password_reset_request', 'success', {
    userId: user.id,
    method: 'email'
  });

  return { resetToken, expiresAt };
}

/**
 * Reset password using reset token
 * @param {string} resetToken
 * @param {string} newPassword
 */
async function resetPassword(resetToken, newPassword) {
  if (!resetToken || !newPassword) {
    throw new Error('Reset token and new password are required');
  }

  if (newPassword.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }

  // Check memory first
  const resetData = resetTokens.get(resetToken);
  if (!resetData || resetData.expiresAt < new Date()) {
    // Fall back to DB
    const db = await getDatabaseInstance();
    const users = await db.getAdapter().query(
      'SELECT id FROM users WHERE reset_token = ? AND reset_token_expires_at > CURRENT_TIMESTAMP',
      [resetToken]
    );

    if (users.length === 0) {
      throw new Error('Invalid or expired reset token');
    }

    const userId = users[0].id;
    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await db.getAdapter().execute(
      'UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires_at = NULL WHERE id = ?',
      [passwordHash, userId]
    );

    // Log password reset
    await logAuthEvent('password_reset', 'success', { userId });

    resetTokens.delete(resetToken);
    return;
  }

  const db = await getDatabaseInstance();
  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

  await db.getAdapter().execute(
    'UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires_at = NULL WHERE id = ?',
    [passwordHash, resetData.userId]
  );

  // Log password reset
  await logAuthEvent('password_reset', 'success', { userId: resetData.userId });

  resetTokens.delete(resetToken);
}

/**
 * Get user by ID
 * @param {number} userId
 * @returns {Promise<Object|null>}
 */
async function getUserById(userId) {
  const db = await getDatabaseInstance();
  const users = await db.getAdapter().query(
    'SELECT id, username, email, role, created_at FROM users WHERE id = ?',
    [userId]
  );

  if (users.length === 0) {
    return null;
  }

  const user = users[0];
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    createdAt: user.created_at
  };
}

/**
 * Update user role (admin only)
 * @param {number} userId
 * @param {string} newRole
 */
async function updateUserRole(userId, newRole) {
  const validRoles = ['admin', 'manager', 'user', 'guest'];
  if (!validRoles.includes(newRole)) {
    throw new Error(`Invalid role. Must be one of: ${validRoles.join(', ')}`);
  }

  const db = await getDatabaseInstance();
  const result = await db.getAdapter().execute(
    'UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [newRole, userId]
  );

  if (result.changes === 0) {
    throw new Error('User not found');
  }
}

/**
 * Change user password (authenticated user)
 * @param {number} userId
 * @param {string} currentPassword
 * @param {string} newPassword
 */
async function changePassword(userId, currentPassword, newPassword) {
  if (newPassword.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }

  const db = await getDatabaseInstance();
  const users = await db.getAdapter().query(
    'SELECT password_hash FROM users WHERE id = ?',
    [userId]
  );

  if (users.length === 0) {
    throw new Error('User not found');
  }

  const isValid = await bcrypt.compare(currentPassword, users[0].password_hash);
  if (!isValid) {
    throw new Error('Current password is incorrect');
  }

  const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await db.getAdapter().execute(
    'UPDATE users SET password_hash = ? WHERE id = ?',
    [passwordHash, userId]
  );

  // Log password change
  await logAuthEvent('password_change', 'success', { userId });
}

module.exports = {
  registerUser,
  loginUser,
  logoutUser,
  verifyAndSetUser,
  refreshUserTokens,
  requestPasswordReset,
  resetPassword,
  getUserById,
  updateUserRole,
  changePassword
};
