/**
 * JWT Token Management
 * Handles generation, validation, and refresh of JWT tokens
 */

const jwt = require('jsonwebtoken');

// JWT secret — prefer ORCA_JWT_SECRET (schema convention), fall back to JWT_SECRET for compat
const JWT_SECRET = process.env.ORCA_JWT_SECRET || process.env.JWT_SECRET || process.env.OPENROUTER_API_KEY || 'orca-default-secret-change-me';
const JWT_REFRESH_SECRET = process.env.ORCA_JWT_REFRESH_SECRET || process.env.JWT_REFRESH_SECRET || `${JWT_SECRET}-refresh`;
const ACCESS_TOKEN_EXPIRY = '15m'; // 15 minutes
const REFRESH_TOKEN_EXPIRY = '7d'; // 7 days

/**
 * Generate access token
 * @param {Object} payload - { userId, username, role }
 * @returns {string} JWT access token
 */
function generateAccessToken(payload) {
  return jwt.sign(
    {
      userId: payload.userId,
      username: payload.username,
      role: payload.role || 'user',
      type: 'access'
    },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

/**
 * Generate refresh token
 * @param {Object} payload - { userId }
 * @returns {string} JWT refresh token
 */
function generateRefreshToken(payload) {
  return jwt.sign(
    {
      userId: payload.userId,
      type: 'refresh'
    },
    JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRY }
  );
}

/**
 * Generate token pair (access + refresh)
 * @param {Object} payload - { userId, username, role }
 * @returns {Object} { accessToken, refreshToken }
 */
function generateTokenPair(payload) {
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload)
  };
}

/**
 * Verify access token
 * @param {string} token
 * @returns {Object|null} Decoded payload or null if invalid
 */
function verifyAccessToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'access') {
      return null;
    }
    return decoded;
  } catch (error) {
    return null;
  }
}

/**
 * Verify refresh token
 * @param {string} token
 * @returns {Object|null} Decoded payload or null if invalid
 */
function verifyRefreshToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_REFRESH_SECRET);
    if (decoded.type !== 'refresh') {
      return null;
    }
    return decoded;
  } catch (error) {
    return null;
  }
}

/**
 * Refresh access token using refresh token
 * @param {string} refreshToken
 * @returns {Object|null} { accessToken, refreshToken, userId } or null
 */
function refreshAccessToken(refreshToken) {
  const decoded = verifyRefreshToken(refreshToken);
  if (!decoded) return null;

  // Generate new token pair
  const tokens = generateTokenPair({
    userId: decoded.userId
  });

  return {
    ...tokens,
    userId: decoded.userId
  };
}

/**
 * Decode token without verification (for debugging)
 * @param {string} token
 * @returns {Object|null}
 */
function decodeToken(token) {
  try {
    return jwt.decode(token);
  } catch {
    return null;
  }
}

/**
 * Extract bearer token from authorization header
 * @param {string} authHeader
 * @returns {string|null}
 */
function extractBearerToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  generateTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  refreshAccessToken,
  decodeToken,
  extractBearerToken
};
