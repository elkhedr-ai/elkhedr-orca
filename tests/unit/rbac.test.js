const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
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
} = require('../../src/auth/rbac');

describe('RBAC - Roles and Permissions', () => {
  it('should define correct role hierarchy', () => {
    assert.deepStrictEqual(ROLE_HIERARCHY, ['guest', 'user', 'manager', 'admin']);
  });

  it('should return all roles', () => {
    const roles = getRoles();
    assert.deepStrictEqual(roles, ['guest', 'user', 'manager', 'admin']);
  });

  it('should validate roles correctly', () => {
    assert.strictEqual(isValidRole('admin'), true);
    assert.strictEqual(isValidRole('user'), true);
    assert.strictEqual(isValidRole('guest'), true);
    assert.strictEqual(isValidRole('manager'), true);
    assert.strictEqual(isValidRole('superuser'), false);
    assert.strictEqual(isValidRole(''), false);
  });

  it('should return correct display names', () => {
    assert.strictEqual(getRoleDisplayName('admin'), 'Administrator');
    assert.strictEqual(getRoleDisplayName('manager'), 'Manager');
    assert.strictEqual(getRoleDisplayName('user'), 'User');
    assert.strictEqual(getRoleDisplayName('guest'), 'Guest');
    assert.strictEqual(getRoleDisplayName('unknown'), 'unknown');
  });

  it('should return permissions for each role', () => {
    const guestPerms = getRolePermissions('guest');
    assert.ok(guestPerms.includes(PERMISSIONS.AGENT.VIEW));
    assert.ok(!guestPerms.includes(PERMISSIONS.AGENT.EXECUTE));

    const userPerms = getRolePermissions('user');
    assert.ok(userPerms.includes(PERMISSIONS.AGENT.EXECUTE));
    assert.ok(userPerms.includes(PERMISSIONS.TOOL.USE));
    assert.ok(!userPerms.includes(PERMISSIONS.SYSTEM.CONFIG));

    const adminPerms = getRolePermissions('admin');
    assert.ok(adminPerms.includes(PERMISSIONS.SYSTEM.CONFIG));
    assert.ok(adminPerms.includes(PERMISSIONS.USER.DELETE));
  });

  it('should fallback to guest for invalid roles', () => {
    const perms = getRolePermissions('invalid');
    assert.deepStrictEqual(perms, ROLE_PERMISSIONS.guest);
  });
});

describe('RBAC - Permission Checking', () => {
  it('should check hasPermission correctly', () => {
    assert.strictEqual(hasPermission('admin', 'agent:execute'), true);
    assert.strictEqual(hasPermission('user', 'agent:execute'), true);
    assert.strictEqual(hasPermission('guest', 'agent:execute'), false);
    assert.strictEqual(hasPermission('guest', 'agent:view'), true);
    assert.strictEqual(hasPermission('manager', 'user:view'), true);
    assert.strictEqual(hasPermission('user', 'user:view'), false);
  });

  it('should compare role hierarchy', () => {
    assert.strictEqual(hasHigherOrEqualRole('admin', 'user'), true);
    assert.strictEqual(hasHigherOrEqualRole('manager', 'user'), true);
    assert.strictEqual(hasHigherOrEqualRole('user', 'user'), true);
    assert.strictEqual(hasHigherOrEqualRole('user', 'admin'), false);
    assert.strictEqual(hasHigherOrEqualRole('guest', 'admin'), false);
    assert.strictEqual(hasHigherOrEqualRole('invalid', 'user'), false);
  });

  it('should check can() for actions', () => {
    // Admin can do everything
    assert.strictEqual(can('admin', 'delete', 'data', false), true);
    assert.strictEqual(can('admin', 'view', 'analytics', false), true);

    // User can do own data operations
    assert.strictEqual(can('user', 'view', 'data', true), true);
    assert.strictEqual(can('user', 'modify', 'data', true), true);
    assert.strictEqual(can('user', 'delete', 'data', true), true);
    assert.strictEqual(can('user', 'view', 'data', false), false);
    assert.strictEqual(can('user', 'modify', 'data', false), false);

    // Manager can view all data but only modify own
    assert.strictEqual(can('manager', 'view', 'data', false), true);
    assert.strictEqual(can('manager', 'modify', 'data', true), true);
    assert.strictEqual(can('manager', 'modify', 'data', false), false);

    // Guest is very limited
    assert.strictEqual(can('guest', 'view', 'data', true), true);
    assert.strictEqual(can('guest', 'modify', 'data', true), false);
    assert.strictEqual(can('guest', 'view', 'data', false), false);
  });

  it('should check data access helpers', () => {
    assert.strictEqual(canView('user'), true);
    assert.strictEqual(canView('user', false), false);
    assert.strictEqual(canView('manager', false), true);

    assert.strictEqual(canModify('user'), true);
    assert.strictEqual(canModify('user', false), false);
    assert.strictEqual(canModify('admin', false), true);

    assert.strictEqual(canDelete('user'), true);
    assert.strictEqual(canDelete('user', false), false);
    assert.strictEqual(canDelete('admin', false), true);
  });

  it('should check agent execution', () => {
    assert.strictEqual(canExecuteAgent('admin'), true);
    assert.strictEqual(canExecuteAgent('user'), true);
    assert.strictEqual(canExecuteAgent('guest'), false);
  });

  it('should check user management', () => {
    assert.strictEqual(canManageUsers('admin'), true);
    assert.strictEqual(canManageUsers('manager'), false);
    assert.strictEqual(canManageUsers('user'), false);
  });

  it('should check analytics viewing', () => {
    assert.strictEqual(canViewAnalytics('admin'), true);
    assert.strictEqual(canViewAnalytics('user'), true);
    assert.strictEqual(canViewAnalytics('user', false), false);
    assert.strictEqual(canViewAnalytics('manager', false), true);
    assert.strictEqual(canViewAnalytics('guest'), true);
    assert.strictEqual(canViewAnalytics('guest', false), false);
  });
});

describe('RBAC - Permission Constants', () => {
  it('should have all permission categories', () => {
    assert.ok(PERMISSIONS.AGENT);
    assert.ok(PERMISSIONS.TOOL);
    assert.ok(PERMISSIONS.DATA);
    assert.ok(PERMISSIONS.SESSION);
    assert.ok(PERMISSIONS.KB);
    assert.ok(PERMISSIONS.ANALYTICS);
    assert.ok(PERMISSIONS.USER);
    assert.ok(PERMISSIONS.SYSTEM);
  });

  it('should have specific permissions defined', () => {
    assert.strictEqual(PERMISSIONS.AGENT.VIEW, 'agent:view');
    assert.strictEqual(PERMISSIONS.AGENT.EXECUTE, 'agent:execute');
    assert.strictEqual(PERMISSIONS.DATA.VIEW_OWN, 'data:view:own');
    assert.strictEqual(PERMISSIONS.DATA.VIEW_ALL, 'data:view:all');
    assert.strictEqual(PERMISSIONS.SYSTEM.CONFIG, 'system:config');
  });
});
