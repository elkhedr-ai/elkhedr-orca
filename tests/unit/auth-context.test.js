const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
  setUserContext,
  getUserContext,
  isAuthenticated,
  isAdmin,
  hasPerm,
  canPerform,
  canAccess,
  clearUserContext
} = require('../../src/auth/context');

describe('Auth Context', () => {
  beforeEach(() => {
    clearUserContext();
  });

  it('should start with empty context', () => {
    const ctx = getUserContext();
    assert.strictEqual(ctx.userId, null);
    assert.strictEqual(ctx.userRole, null);
    assert.strictEqual(ctx.sessionId, null);
  });

  it('should set and get user context', () => {
    setUserContext({ userId: 42, userRole: 'admin', sessionId: 'sess-1' });
    const ctx = getUserContext();
    assert.strictEqual(ctx.userId, 42);
    assert.strictEqual(ctx.userRole, 'admin');
    assert.strictEqual(ctx.sessionId, 'sess-1');
  });

  it('should detect authenticated state', () => {
    assert.strictEqual(isAuthenticated(), false);
    setUserContext({ userId: 42, userRole: 'user' });
    assert.strictEqual(isAuthenticated(), true);
  });

  it('should detect admin role', () => {
    assert.strictEqual(isAdmin(), false);
    setUserContext({ userId: 42, userRole: 'user' });
    assert.strictEqual(isAdmin(), false);
    setUserContext({ userId: 1, userRole: 'admin' });
    assert.strictEqual(isAdmin(), true);
  });

  it('should check permissions for current user', () => {
    // Admin has all permissions
    setUserContext({ userId: 1, userRole: 'admin' });
    assert.strictEqual(hasPerm('agent:execute'), true);
    assert.strictEqual(hasPerm('user:delete'), true);

    // User has limited permissions
    clearUserContext();
    setUserContext({ userId: 2, userRole: 'user' });
    assert.strictEqual(hasPerm('agent:execute'), true);
    assert.strictEqual(hasPerm('user:delete'), false);

    // Guest has very limited permissions
    clearUserContext();
    setUserContext({ userId: 3, userRole: 'guest' });
    assert.strictEqual(hasPerm('agent:view'), true);
    assert.strictEqual(hasPerm('agent:execute'), false);

    // Unauthenticated has no permissions
    clearUserContext();
    assert.strictEqual(hasPerm('agent:view'), false);
  });

  it('should check canPerform for actions', () => {
    setUserContext({ userId: 1, userRole: 'user' });
    assert.strictEqual(canPerform('execute', 'agent'), true);
    assert.strictEqual(canPerform('view', 'data', true), true);
    assert.strictEqual(canPerform('view', 'data', false), false);
    assert.strictEqual(canPerform('delete', 'user'), false);

    setUserContext({ userId: 2, userRole: 'admin' });
    assert.strictEqual(canPerform('delete', 'user'), true);
    assert.strictEqual(canPerform('view', 'data', false), true);
  });

  it('should allow admin to access any user data', () => {
    setUserContext({ userId: 1, userRole: 'admin' });
    assert.strictEqual(canAccess(null), true);
    assert.strictEqual(canAccess(42), true);
    assert.strictEqual(canAccess(99), true);
  });

  it('should allow users to access their own data', () => {
    setUserContext({ userId: 42, userRole: 'user' });
    assert.strictEqual(canAccess(42), true);
    assert.strictEqual(canAccess(null), true);
    assert.strictEqual(canAccess(99), false);
  });

  it('should allow guests to access only public data', () => {
    setUserContext({ userId: null, userRole: 'guest' });
    assert.strictEqual(canAccess(null), true);
    assert.strictEqual(canAccess(42), false);
  });

  it('should clear context on logout', () => {
    setUserContext({ userId: 42, userRole: 'admin' });
    clearUserContext();
    const ctx = getUserContext();
    assert.strictEqual(ctx.userId, null);
    assert.strictEqual(ctx.userRole, null);
    assert.strictEqual(isAuthenticated(), false);
    assert.strictEqual(isAdmin(), false);
    assert.strictEqual(hasPerm('agent:execute'), false);
  });
});
