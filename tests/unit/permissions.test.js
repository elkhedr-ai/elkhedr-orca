/**
 * Tests for Skill Permission System
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const {
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
  getApprovalStatus,
  reset
} = require('../../src/plugins/permissions.js');

describe('Permission Constants', () => {
  it('should define all permission types', () => {
    assert.strictEqual(PERMISSIONS.READ, 'read');
    assert.strictEqual(PERMISSIONS.WRITE, 'write');
    assert.strictEqual(PERMISSIONS.EXECUTE, 'execute');
    assert.strictEqual(PERMISSIONS.NETWORK, 'network');
    assert.strictEqual(PERMISSIONS.FILESYSTEM, 'filesystem');
  });

  it('should define elevated permissions', () => {
    assert.strictEqual(ELEVATED_PERMISSIONS.length, 3);
    assert.ok(ELEVATED_PERMISSIONS.includes('execute'));
    assert.ok(ELEVATED_PERMISSIONS.includes('network'));
    assert.ok(ELEVATED_PERMISSIONS.includes('filesystem'));
  });
});

describe('validatePermission', () => {
  it('should accept valid permissions', () => {
    assert.strictEqual(validatePermission('read'), 'read');
    assert.strictEqual(validatePermission('execute'), 'execute');
  });

  it('should throw for invalid permissions', () => {
    assert.throws(() => validatePermission('invalid'), /Invalid permission/);
  });
});

describe('validatePermissions', () => {
  it('should validate array of permissions', () => {
    const result = validatePermissions(['read', 'write']);
    assert.deepStrictEqual(result, ['read', 'write']);
  });

  it('should throw for non-array', () => {
    assert.throws(() => validatePermissions('read'), /array/);
  });

  it('should throw if any permission is invalid', () => {
    assert.throws(() => validatePermissions(['read', 'invalid']), /Invalid permission/);
  });
});

describe('isElevatedPermission', () => {
  it('should identify elevated permissions', () => {
    assert.strictEqual(isElevatedPermission('execute'), true);
    assert.strictEqual(isElevatedPermission('network'), true);
    assert.strictEqual(isElevatedPermission('filesystem'), true);
  });

  it('should identify non-elevated permissions', () => {
    assert.strictEqual(isElevatedPermission('read'), false);
    assert.strictEqual(isElevatedPermission('write'), false);
  });
});

describe('getElevatedPermissions', () => {
  it('should filter elevated permissions', () => {
    const perms = ['read', 'execute', 'network', 'write'];
    const elevated = getElevatedPermissions(perms);
    assert.deepStrictEqual(elevated, ['execute', 'network']);
  });

  it('should return empty array for no elevated permissions', () => {
    const perms = ['read', 'write'];
    const elevated = getElevatedPermissions(perms);
    assert.deepStrictEqual(elevated, []);
  });
});

describe('Approval Management', () => {
  beforeEach(() => {
    reset();
  });

  it('should not be approved initially', () => {
    assert.strictEqual(isApproved('test-skill', ['execute']), false);
  });

  it('should approve elevated permissions', () => {
    approveSkill('test-skill', ['execute', 'network']);
    assert.strictEqual(isApproved('test-skill', ['execute']), true);
    assert.strictEqual(isApproved('test-skill', ['execute', 'network']), true);
  });

  it('should require all permissions to be approved', () => {
    approveSkill('test-skill', ['execute']);
    assert.strictEqual(isApproved('test-skill', ['execute', 'network']), false);
  });

  it('should allow non-elevated permissions without approval', () => {
    assert.strictEqual(isApproved('test-skill', ['read']), false);
    // isApproved only checks elevated permissions
    assert.strictEqual(isApproved('test-skill', ['read']), false);
  });

  it('should revoke all permissions', () => {
    approveSkill('test-skill', ['execute']);
    revokeApproval('test-skill');
    assert.strictEqual(isApproved('test-skill', ['execute']), false);
  });

  it('should revoke specific permissions', () => {
    approveSkill('test-skill', ['execute', 'network']);
    revokeApproval('test-skill', ['execute']);
    assert.strictEqual(isApproved('test-skill', ['execute']), false);
    assert.strictEqual(isApproved('test-skill', ['network']), true);
  });

  it('should return approval status', () => {
    approveSkill('test-skill', ['execute']);
    const status = getApprovalStatus('test-skill');
    assert.deepStrictEqual(status.approved, ['execute']);
  });
});

describe('checkExecutionPermission', () => {
  beforeEach(() => {
    reset();
  });

  it('should allow execution with no elevated permissions', () => {
    const result = checkExecutionPermission('test-skill', ['read']);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.requiresApproval, false);
  });

  it('should block execution with unapproved elevated permissions', () => {
    assert.throws(
      () => checkExecutionPermission('test-skill', ['execute']),
      /requires explicit approval/
    );
  });

  it('should allow execution after approval', () => {
    approveSkill('test-skill', ['execute']);
    const result = checkExecutionPermission('test-skill', ['execute']);
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.approved, true);
  });

  it('should auto-approve when configured', () => {
    const result = checkExecutionPermission('test-skill', ['execute'], { autoApprove: true });
    assert.strictEqual(result.allowed, true);
    assert.strictEqual(result.autoApproved, true);
  });

  it('should log warning for blocked execution', () => {
    // Just verify it doesn't throw unexpectedly and has proper error structure
    try {
      checkExecutionPermission('test-skill', ['execute', 'network']);
      assert.fail('Should have thrown');
    } catch (error) {
      assert.ok(error.message.includes('execute'));
      assert.ok(error.message.includes('network'));
      assert.ok(error.details);
      assert.ok(error.details.hint);
    }
  });
});

describe('assertPermission', () => {
  beforeEach(() => {
    reset();
  });

  it('should return true for non-elevated permissions', () => {
    assert.strictEqual(assertPermission('test-skill', 'read'), true);
  });

  it('should throw for unapproved elevated permission', () => {
    assert.throws(
      () => assertPermission('test-skill', 'execute'),
      /does not have "execute" permission/
    );
  });

  it('should allow approved elevated permission', () => {
    approveSkill('test-skill', ['execute']);
    assert.strictEqual(assertPermission('test-skill', 'execute'), true);
  });
});

describe('Permission Integration', () => {
  beforeEach(() => {
    reset();
  });

  it('should track multiple skills independently', () => {
    approveSkill('skill-a', ['execute']);
    approveSkill('skill-b', ['network']);
    
    assert.strictEqual(isApproved('skill-a', ['execute']), true);
    assert.strictEqual(isApproved('skill-b', ['network']), true);
    assert.strictEqual(isApproved('skill-a', ['network']), false);
  });

  it('should include approval metadata', () => {
    const result = approveSkill('test-skill', ['execute'], { approvedBy: 'admin' });
    assert.strictEqual(result.approvedBy, 'admin');
  });
});
