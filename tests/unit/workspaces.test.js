const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { initializeDatabaseInstance } = require('../../src/db');
const { registerUser } = require('../../src/auth/index');
const {
  createWorkspace,
  getWorkspaceById,
  getWorkspaceBySlug,
  getUserWorkspaces,
  updateWorkspace,
  deleteWorkspace,
  getWorkspaceMembers,
  getWorkspaceMemberRole,
  isWorkspaceMember,
  addWorkspaceMember,
  removeWorkspaceMember,
  updateMemberRole,
  transferOwnership,
  createInvite,
  acceptInvite,
  cancelInvite,
  getWorkspaceInvites,
  generateSlug
} = require('../../src/teams/index');

describe('Workspace Management', () => {
  let db;
  let ownerId;
  let memberId;

  beforeEach(async () => {
    process.env.ORCA_DB_URL = ':memory:';
    db = await initializeDatabaseInstance();
    const owner = await registerUser('owner', 'owner@test.com', 'password123');
    ownerId = owner.user.id;
    const member = await registerUser('member', 'member@test.com', 'password123');
    memberId = member.user.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it('should create workspace', async () => {
    const ws = await createWorkspace(ownerId, 'Test Workspace', 'A test workspace');
    assert.ok(ws);
    assert.strictEqual(ws.name, 'Test Workspace');
    assert.strictEqual(ws.description, 'A test workspace');
    assert.strictEqual(ws.ownerId, ownerId);
    assert.ok(ws.slug);
  });

  it('should generate unique slug', async () => {
    const ws1 = await createWorkspace(ownerId, 'My Workspace');
    const ws2 = await createWorkspace(ownerId, 'My Workspace');
    assert.notStrictEqual(ws1.slug, ws2.slug);
  });

  it('should reject duplicate slug', async () => {
    await createWorkspace(ownerId, 'Test', '', 'custom-slug');
    await assert.rejects(
      createWorkspace(ownerId, 'Test 2', '', 'custom-slug'),
      /already exists/
    );
  });

  it('should get workspace by id', async () => {
    const created = await createWorkspace(ownerId, 'Test');
    const ws = await getWorkspaceById(created.id);
    assert.ok(ws);
    assert.strictEqual(ws.name, 'Test');
    assert.strictEqual(ws.ownerId, ownerId);
  });

  it('should get workspace by slug', async () => {
    const created = await createWorkspace(ownerId, 'Test', '', 'test-slug-123');
    const ws = await getWorkspaceBySlug(created.slug);
    assert.ok(ws);
    assert.strictEqual(ws.id, created.id);
  });

  it('should return null for non-existent workspace', async () => {
    const ws = await getWorkspaceById(99999);
    assert.strictEqual(ws, null);
  });

  it('should get user workspaces', async () => {
    await createWorkspace(ownerId, 'Workspace 1');
    await createWorkspace(ownerId, 'Workspace 2');
    const workspaces = await getUserWorkspaces(ownerId);
    assert.strictEqual(workspaces.length, 2);
    assert.ok(workspaces.some(w => w.name === 'Workspace 1'));
    assert.ok(workspaces.some(w => w.name === 'Workspace 2'));
  });

  it('should not show workspaces user is not a member of', async () => {
    await createWorkspace(ownerId, 'Private Workspace');
    const workspaces = await getUserWorkspaces(memberId);
    assert.strictEqual(workspaces.length, 0);
  });

  it('should update workspace', async () => {
    const ws = await createWorkspace(ownerId, 'Old Name');
    const updated = await updateWorkspace(ws.id, ownerId, { name: 'New Name', description: 'New desc' });
    assert.strictEqual(updated.name, 'New Name');
    assert.strictEqual(updated.description, 'New desc');
  });

  it('should reject update by non-admin', async () => {
    const ws = await createWorkspace(ownerId, 'Test');
    await assert.rejects(
      updateWorkspace(ws.id, memberId, { name: 'Hacked' }),
      /Access denied/
    );
  });

  it('should delete workspace by owner', async () => {
    const ws = await createWorkspace(ownerId, 'To Delete');
    await deleteWorkspace(ws.id, ownerId);
    const deleted = await getWorkspaceById(ws.id);
    assert.strictEqual(deleted, null);
  });

  it('should reject delete by non-owner', async () => {
    const ws = await createWorkspace(ownerId, 'Test');
    await assert.rejects(
      deleteWorkspace(ws.id, memberId),
      /Only workspace owner/
    );
  });
});

describe('Workspace Members', () => {
  let db;
  let ownerId;
  let adminId;
  let memberId;
  let viewerId;
  let workspaceId;

  beforeEach(async () => {
    process.env.ORCA_DB_URL = ':memory:';
    db = await initializeDatabaseInstance();
    const owner = await registerUser('owner', 'owner@test.com', 'password123');
    ownerId = owner.user.id;
    const admin = await registerUser('admin', 'admin@test.com', 'password123');
    adminId = admin.user.id;
    const member = await registerUser('member', 'member@test.com', 'password123');
    memberId = member.user.id;
    const viewer = await registerUser('viewer', 'viewer@test.com', 'password123');
    viewerId = viewer.user.id;

    const ws = await createWorkspace(ownerId, 'Test Workspace');
    workspaceId = ws.id;

    // Add admin
    await addWorkspaceMember(workspaceId, adminId, 'admin', ownerId);
    // Add member
    await addWorkspaceMember(workspaceId, memberId, 'member', ownerId);
  });

  afterEach(async () => {
    await db.close();
  });

  it('should get workspace members', async () => {
    const members = await getWorkspaceMembers(workspaceId);
    assert.strictEqual(members.length, 3); // owner, admin, member
    assert.ok(members.some(m => m.userId === ownerId && m.role === 'owner'));
    assert.ok(members.some(m => m.userId === adminId && m.role === 'admin'));
    assert.ok(members.some(m => m.userId === memberId && m.role === 'member'));
  });

  it('should get member role', async () => {
    assert.strictEqual(await getWorkspaceMemberRole(workspaceId, ownerId), 'owner');
    assert.strictEqual(await getWorkspaceMemberRole(workspaceId, adminId), 'admin');
    assert.strictEqual(await getWorkspaceMemberRole(workspaceId, memberId), 'member');
    assert.strictEqual(await getWorkspaceMemberRole(workspaceId, viewerId), null);
  });

  it('should check workspace membership', async () => {
    assert.strictEqual(await isWorkspaceMember(workspaceId, ownerId), true);
    assert.strictEqual(await isWorkspaceMember(workspaceId, viewerId), false);
  });

  it('should add member by owner', async () => {
    await addWorkspaceMember(workspaceId, viewerId, 'viewer', ownerId);
    const members = await getWorkspaceMembers(workspaceId);
    assert.strictEqual(members.length, 4);
    assert.ok(members.some(m => m.userId === viewerId && m.role === 'viewer'));
  });

  it('should add member by admin', async () => {
    const newUser = await registerUser('newuser', 'new@test.com', 'password123');
    await addWorkspaceMember(workspaceId, newUser.user.id, 'member', adminId);
    const role = await getWorkspaceMemberRole(workspaceId, newUser.user.id);
    assert.strictEqual(role, 'member');
  });

  it('should reject add member by non-admin', async () => {
    const newUser = await registerUser('newuser', 'new@test.com', 'password123');
    await assert.rejects(
      addWorkspaceMember(workspaceId, newUser.user.id, 'member', memberId),
      /Access denied/
    );
  });

  it('should reject duplicate member', async () => {
    await assert.rejects(
      addWorkspaceMember(workspaceId, memberId, 'viewer', ownerId),
      /already a workspace member/
    );
  });

  it('should remove member by owner', async () => {
    await removeWorkspaceMember(workspaceId, memberId, ownerId);
    const members = await getWorkspaceMembers(workspaceId);
    assert.strictEqual(members.length, 2);
    assert.ok(!members.some(m => m.userId === memberId));
  });

  it('should remove member by admin', async () => {
    await removeWorkspaceMember(workspaceId, memberId, adminId);
    const members = await getWorkspaceMembers(workspaceId);
    assert.strictEqual(members.length, 2);
  });

  it('should reject admin removal by admin', async () => {
    await assert.rejects(
      removeWorkspaceMember(workspaceId, adminId, adminId),
      /cannot remove other admins/
    );
  });

  it('should reject owner removal by owner', async () => {
    await assert.rejects(
      removeWorkspaceMember(workspaceId, ownerId, ownerId),
      /Owner cannot remove themselves/
    );
  });

  it('should update member role by owner', async () => {
    await updateMemberRole(workspaceId, memberId, 'admin', ownerId);
    const role = await getWorkspaceMemberRole(workspaceId, memberId);
    assert.strictEqual(role, 'admin');
  });

  it('should reject role update by non-owner', async () => {
    await assert.rejects(
      updateMemberRole(workspaceId, memberId, 'admin', adminId),
      /Only workspace owner/
    );
  });

  it('should transfer ownership', async () => {
    await transferOwnership(workspaceId, adminId, ownerId);
    const ws = await getWorkspaceById(workspaceId);
    assert.strictEqual(ws.ownerId, adminId);

    const roles = await getWorkspaceMembers(workspaceId);
    assert.ok(roles.some(m => m.userId === adminId && m.role === 'owner'));
    assert.ok(roles.some(m => m.userId === ownerId && m.role === 'admin'));
  });

  it('should reject ownership transfer by non-owner', async () => {
    await assert.rejects(
      transferOwnership(workspaceId, memberId, adminId),
      /Only current owner/
    );
  });
});

describe('Workspace Invites', () => {
  let db;
  let ownerId;
  let memberId;
  let workspaceId;

  beforeEach(async () => {
    process.env.ORCA_DB_URL = ':memory:';
    db = await initializeDatabaseInstance();
    const owner = await registerUser('owner', 'owner@test.com', 'password123');
    ownerId = owner.user.id;
    const member = await registerUser('member', 'member@test.com', 'password123');
    memberId = member.user.id;

    const ws = await createWorkspace(ownerId, 'Test Workspace');
    workspaceId = ws.id;
  });

  afterEach(async () => {
    await db.close();
  });

  it('should create invite by owner', async () => {
    const invite = await createInvite(workspaceId, 'invited@test.com', 'member', ownerId);
    assert.ok(invite.token);
    assert.ok(invite.expiresAt);
  });

  it('should get pending invites', async () => {
    await createInvite(workspaceId, 'user1@test.com', 'member', ownerId);
    await createInvite(workspaceId, 'user2@test.com', 'admin', ownerId);
    const invites = await getWorkspaceInvites(workspaceId);
    assert.strictEqual(invites.length, 2);
  });

  it('should accept invite and join workspace', async () => {
    const newUser = await registerUser('invited', 'invited@test.com', 'password123');
    const invite = await createInvite(workspaceId, 'invited@test.com', 'member', ownerId);

    const ws = await acceptInvite(invite.token, newUser.user.id);
    assert.ok(ws);
    assert.strictEqual(ws.id, workspaceId);

    const role = await getWorkspaceMemberRole(workspaceId, newUser.user.id);
    assert.strictEqual(role, 'member');
  });

  it('should reject expired invite', async () => {
    const newUser = await registerUser('invited', 'invited@test.com', 'password123');
    const invite = await createInvite(workspaceId, 'invited@test.com', 'member', ownerId);

    // Manually expire the invite
    await db.getAdapter().execute(
      "UPDATE workspace_invites SET expires_at = datetime('now', '-1 day') WHERE token = ?",
      [invite.token]
    );

    await assert.rejects(
      acceptInvite(invite.token, newUser.user.id),
      /Invalid or expired/
    );
  });

  it('should cancel invite by owner', async () => {
    await createInvite(workspaceId, 'to-cancel@test.com', 'member', ownerId);
    const invites = await getWorkspaceInvites(workspaceId);
    const inviteId = invites[0].id;

    await cancelInvite(inviteId, ownerId);
    const remaining = await getWorkspaceInvites(workspaceId);
    assert.strictEqual(remaining.length, 0);
  });

  it('should reject invite by non-admin', async () => {
    await addWorkspaceMember(workspaceId, memberId, 'member', ownerId);
    await assert.rejects(
      createInvite(workspaceId, 'test@test.com', 'member', memberId),
      /Access denied/
    );
  });
});
