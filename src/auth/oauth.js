/**
 * OAuth 2.0 Integration
 * Supports Google and GitHub OAuth login
 * Note: In production, these require setting up OAuth apps with the providers
 */

const axios = require('axios');

// OAuth configuration
const OAUTH_CONFIG = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    scopes: ['openid', 'email', 'profile']
  },
  github: {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    redirectUri: process.env.GITHUB_REDIRECT_URI || 'http://localhost:3000/auth/github/callback',
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    userEmailUrl: 'https://api.github.com/user/emails',
    scopes: ['read:user', 'user:email']
  }
};

/**
 * Get OAuth authorization URL
 * @param {string} provider - 'google' or 'github'
 * @param {string} state - CSRF state parameter
 * @returns {string} Authorization URL
 */
function getAuthorizationUrl(provider, state) {
  const config = OAUTH_CONFIG[provider];
  if (!config) {
    throw new Error(`Unsupported OAuth provider: ${provider}`);
  }

  if (!config.clientId) {
    throw new Error(`OAuth not configured for ${provider}. Set ${provider.toUpperCase()}_CLIENT_ID environment variable.`);
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: config.scopes.join(' '),
    state
  });

  if (provider === 'google') {
    params.append('access_type', 'offline');
    params.append('prompt', 'consent');
  }

  return `${config.authUrl}?${params.toString()}`;
}

/**
 * Exchange authorization code for access token
 * @param {string} provider - 'google' or 'github'
 * @param {string} code - Authorization code
 * @returns {Promise<Object>} { accessToken, refreshToken?, user }
 */
async function exchangeCodeForToken(provider, code) {
  const config = OAUTH_CONFIG[provider];
  if (!config) {
    throw new Error(`Unsupported OAuth provider: ${provider}`);
  }

  if (provider === 'google') {
    const response = await axios.post(config.tokenUrl, {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code'
    });

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresIn: response.data.expires_in,
      tokenType: response.data.token_type
    };
  }

  if (provider === 'github') {
    const response = await axios.post(config.tokenUrl, {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri
    }, {
      headers: {
        Accept: 'application/json'
      }
    });

    return {
      accessToken: response.data.access_token,
      tokenType: response.data.token_type,
      scope: response.data.scope
    };
  }
}

/**
 * Get user info from OAuth provider
 * @param {string} provider - 'google' or 'github'
 * @param {string} accessToken
 * @returns {Promise<Object>} { id, email, name, picture? }
 */
async function getUserInfo(provider, accessToken) {
  const config = OAUTH_CONFIG[provider];

  if (provider === 'google') {
    const response = await axios.get(config.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    return {
      id: response.data.id,
      email: response.data.email,
      name: response.data.name,
      picture: response.data.picture,
      verified: response.data.verified_email
    };
  }

  if (provider === 'github') {
    // Get user profile
    const userResponse = await axios.get(config.userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    });

    // Get primary email
    const emailsResponse = await axios.get(config.userEmailUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    });

    const primaryEmail = emailsResponse.data.find(e => e.primary) || emailsResponse.data[0];

    return {
      id: userResponse.data.id.toString(),
      email: primaryEmail ? primaryEmail.email : userResponse.data.email,
      name: userResponse.data.name || userResponse.data.login,
      picture: userResponse.data.avatar_url,
      verified: primaryEmail ? primaryEmail.verified : false
    };
  }
}

/**
 * Find or create user from OAuth profile
 * @param {Object} profile - { id, email, name, picture, verified }
 * @param {string} provider
 * @returns {Promise<Object>} { user, isNew }
 */
async function findOrCreateOAuthUser(profile, provider) {
  const db = await require('../db').getDatabaseInstance();

  // Check if user exists by email
  const users = await db.getAdapter().query(
    'SELECT id, username, email, role FROM users WHERE email = ?',
    [profile.email]
  );

  if (users.length > 0) {
    return { user: users[0], isNew: false };
  }

  // Create new user
  const username = `${profile.name.replace(/\s+/g, '_').toLowerCase()}_${provider}`;
  const result = await db.getAdapter().execute(
    'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [username, profile.email, 'oauth-user-no-password', 'user']
  );

  return {
    user: {
      id: result.lastInsertRowid,
      username,
      email: profile.email,
      role: 'user'
    },
    isNew: true
  };
}

/**
 * Handle OAuth callback
 * @param {string} provider
 * @param {string} code
 * @returns {Promise<Object>} { user, tokens, isNew }
 */
async function handleOAuthCallback(provider, code) {
  const tokenData = await exchangeCodeForToken(provider, code);
  const profile = await getUserInfo(provider, tokenData.accessToken);
  const { user, isNew } = await findOrCreateOAuthUser(profile, provider);

  // Generate our own JWT tokens
  const jwt = require('./jwt');
  const tokens = jwt.generateTokenPair({
    userId: user.id,
    username: user.username,
    role: user.role
  });

  return { user, tokens, isNew };
}

module.exports = {
  getAuthorizationUrl,
  exchangeCodeForToken,
  getUserInfo,
  findOrCreateOAuthUser,
  handleOAuthCallback,
  OAUTH_CONFIG
};
