const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { initializeDatabaseInstance } = require('../../src/db');
const {
  generateAccessToken,
  generateRefreshToken,
  generateTokenPair,
  verifyAccessToken,
  verifyRefreshToken,
  refreshAccessToken,
  extractBearerToken
} = require('../../src/auth/jwt');
const {
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
} = require('../../src/auth/index');
const { getUserContext, clearUserContext } = require('../../src/auth/context');

describe('JWT Token Management', () => {
  it('should generate and verify access token', () => {
    const payload = { userId: 42, username: 'testuser', role: 'user' };
    const token = generateAccessToken(payload);
    assert.ok(token);
    assert.strictEqual(typeof token, 'string');

    const decoded = verifyAccessToken(token);
    assert.ok(decoded);
    assert.strictEqual(decoded.userId, 42);
    assert.strictEqual(decoded.username, 'testuser');
    assert.strictEqual(decoded.role, 'user');
    assert.strictEqual(decoded.type, 'access');
  });

  it('should generate and verify refresh token', () => {
    const payload = { userId: 42 };
    const token = generateRefreshToken(payload);
    assert.ok(token);

    const decoded = verifyRefreshToken(token);
    assert.ok(decoded);
    assert.strictEqual(decoded.userId, 42);
    assert.strictEqual(decoded.type, 'refresh');
  });

  it('should reject invalid access token', () => {
    const decoded = verifyAccessToken('invalid.token.here');
    assert.strictEqual(decoded, null);
  });

  it('should reject refresh token as access token', () => {
    const payload = { userId: 42 };
    const refreshToken = generateRefreshToken(payload);
    const decoded = verifyAccessToken(refreshToken);
    assert.strictEqual(decoded, null);
  });

  it('should generate token pair', () => {
    const payload = { userId: 42, username: 'testuser', role: 'user' };
    const tokens = generateTokenPair(payload);
    assert.ok(tokens.accessToken);
    assert.ok(tokens.refreshToken);
    assert.notStrictEqual(tokens.accessToken, tokens.refreshToken);
  });

  it('should extract bearer token from header', () => {
    const token = extractBearerToken('Bearer abc123');
    assert.strictEqual(token, 'abc123');

    const noToken = extractBearerToken('Basic abc123');
    assert.strictEqual(noToken, null);

    const empty = extractBearerToken(null);
    assert.strictEqual(empty, null);
  });

  it('should refresh access token', () => {
    const payload = { userId: 42, username: 'testuser', role: 'user' };
    const tokens = generateTokenPair(payload);
    const result = refreshAccessToken(tokens.refreshToken);
    assert.ok(result);
    assert.ok(result.accessToken);
    assert.ok(result.refreshToken);
    assert.strictEqual(result.userId, 42);
  });

  it('should reject invalid refresh token', () => {
    const result = refreshAccessToken('invalid.token');
    assert.strictEqual(result, null);
  });
});

describe('User Authentication System', () => {
  let db;

  beforeEach(async () => {
    process.env.ORCA_DB_URL = ':memory:';
    db = await initializeDatabaseInstance();
    clearUserContext();
  });

  afterEach(async () => {
    clearUserContext();
    await db.close();
  });

  it('should register a new user', async () => {
    const result = await registerUser('testuser', 'test@test.com', 'password123');
    assert.ok(result.user);
    assert.ok(result.tokens);
    assert.strictEqual(result.user.username, 'testuser');
    assert.strictEqual(result.user.email, 'test@test.com');
    assert.strictEqual(result.user.role, 'user');
    assert.ok(result.tokens.accessToken);
    assert.ok(result.tokens.refreshToken);
  });

  it('should reject duplicate username', async () => {
    await registerUser('testuser', 'test1@test.com', 'password123');
    await assert.rejects(
      registerUser('testuser', 'test2@test.com', 'password123'),
      /Username or email already exists/
    );
  });

  it('should reject duplicate email', async () => {
    await registerUser('user1', 'test@test.com', 'password123');
    await assert.rejects(
      registerUser('user2', 'test@test.com', 'password123'),
      /Username or email already exists/
    );
  });

  it('should reject short password', async () => {
    await assert.rejects(
      registerUser('user1', 'test@test.com', 'short'),
      /Password must be at least 8 characters long/
    );
  });

  it('should login with valid credentials', async () => {
    await registerUser('testuser', 'test@test.com', 'password123');
    const result = await loginUser('testuser', 'password123');
    assert.ok(result.user);
    assert.ok(result.tokens);
    assert.strictEqual(result.user.username, 'testuser');
    assert.strictEqual(getUserContext().userId, result.user.id);
    assert.strictEqual(getUserContext().userRole, 'user');
  });

  it('should login with email', async () => {
    await registerUser('testuser', 'test@test.com', 'password123');
    const result = await loginUser('test@test.com', 'password123');
    assert.ok(result.user);
    assert.strictEqual(result.user.username, 'testuser');
  });

  it('should reject invalid credentials', async () => {
    await registerUser('testuser', 'test@test.com', 'password123');
    await assert.rejects(
      loginUser('testuser', 'wrongpassword'),
      /Invalid credentials/
    );
  });

  it('should reject non-existent user', async () => {
    await assert.rejects(
      loginUser('nouser', 'password123'),
      /Invalid credentials/
    );
  });

  it('should logout user', async () => {
    await registerUser('testuser', 'test@test.com', 'password123');
    const login = await loginUser('testuser', 'password123');
    await logoutUser(login.user.id);
    const ctx = getUserContext();
    assert.strictEqual(ctx.userId, null);
  });

  it('should verify and set user from token', async () => {
    const reg = await registerUser('testuser', 'test@test.com', 'password123');
    const user = await verifyAndSetUser(reg.tokens.accessToken);
    assert.ok(user);
    assert.strictEqual(user.id, reg.user.id);
    assert.strictEqual(getUserContext().userId, reg.user.id);
  });

  it('should reject invalid token', async () => {
    const user = await verifyAndSetUser('invalid.token');
    assert.strictEqual(user, null);
  });

  it('should refresh user tokens', async () => {
    const reg = await registerUser('testuser', 'test@test.com', 'password123');
    const result = await refreshUserTokens(reg.tokens.refreshToken);
    assert.ok(result);
    assert.ok(result.tokens.accessToken);
    assert.ok(result.tokens.refreshToken);
    assert.strictEqual(result.user.id, reg.user.id);
  });

  it('should reject invalid refresh token', async () => {
    const result = await refreshUserTokens('invalid.token');
    assert.strictEqual(result, null);
  });

  it('should request password reset', async () => {
    await registerUser('testuser', 'test@test.com', 'password123');
    const result = await requestPasswordReset('test@test.com');
    assert.ok(result.resetToken);
    assert.ok(result.expiresAt);
  });

  it('should reject password reset for non-existent email', async () => {
    await assert.rejects(
      requestPasswordReset('nobody@test.com'),
      /No user found with that email/
    );
  });

  it('should reset password with valid token', async () => {
    await registerUser('testuser', 'test@test.com', 'password123');
    const reset = await requestPasswordReset('test@test.com');

    await resetPassword(reset.resetToken, 'newpassword123');

    // Login with new password
    const result = await loginUser('testuser', 'newpassword123');
    assert.ok(result.user);
  });

  it('should reject invalid reset token', async () => {
    await assert.rejects(
      resetPassword('invalid-token', 'newpassword123'),
      /Invalid or expired reset token/
    );
  });

  it('should reject short new password', async () => {
    await registerUser('testuser', 'test@test.com', 'password123');
    const reset = await requestPasswordReset('test@test.com');
    await assert.rejects(
      resetPassword(reset.resetToken, 'short'),
      /Password must be at least 8 characters long/
    );
  });

  it('should get user by id', async () => {
    const reg = await registerUser('testuser', 'test@test.com', 'password123');
    const user = await getUserById(reg.user.id);
    assert.ok(user);
    assert.strictEqual(user.username, 'testuser');
    assert.strictEqual(user.email, 'test@test.com');
  });

  it('should return null for non-existent user', async () => {
    const user = await getUserById(9999);
    assert.strictEqual(user, null);
  });

  it('should update user role', async () => {
    const reg = await registerUser('testuser', 'test@test.com', 'password123');
    await updateUserRole(reg.user.id, 'admin');
    const user = await getUserById(reg.user.id);
    assert.strictEqual(user.role, 'admin');
  });

  it('should reject invalid role', async () => {
    const reg = await registerUser('testuser', 'test@test.com', 'password123');
    await assert.rejects(
      updateUserRole(reg.user.id, 'superuser'),
      /Invalid role/
    );
  });

  it('should change password with valid current password', async () => {
    const reg = await registerUser('testuser', 'test@test.com', 'password123');
    await changePassword(reg.user.id, 'password123', 'newpassword456');

    // Login with new password
    const result = await loginUser('testuser', 'newpassword456');
    assert.ok(result.user);
  });

  it('should reject change password with wrong current password', async () => {
    const reg = await registerUser('testuser', 'test@test.com', 'password123');
    await assert.rejects(
      changePassword(reg.user.id, 'wrongpassword', 'newpassword456'),
      /Current password is incorrect/
    );
  });
});
