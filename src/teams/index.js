/**
 * Workspace Manager
 * Handles team workspaces, members, invites, and workspace-level isolation
 */

const crypto = require('crypto');
const { getDatabaseInstance } = require('../db');

/**
 * Create a new workspace
 * @param {number} ownerId - User ID of the workspace owner
 * @param {string} name - Workspace name
 * @param {string} description - Workspace description
 * @param {string} slug - Unique workspace slug (optional, auto-generated from name)
 * @returns {Promise<Object>} Created workspace
 */
async function createWorkspace(ownerId, name, description = '', slug = null) {
  if (!name || name.trim().length === 0) {
    throw new Error('Workspace name is required');
  }

  const finalSlug = slug || generateSlug(name);
  const db = await getDatabaseInstance();

  // Check if slug already exists
  const existing = await db.getAdapter().query(
    'SELECT id FROM workspaces WHERE slug = ?',
    [finalSlug]
  );

  if (existing.length > 0) {
    throw new Error(`Workspace slug '${finalSlug}' already exists`);
  }

  // Create workspace
  const result = await db.getAdapter().execute(
    'INSERT INTO workspaces (name, slug, description, owner_id) VALUES (?, ?, ?, ?)',
    [name.trim(), finalSlug, description.trim(), ownerId]
  );

  const workspaceId = result.lastInsertRowid;

  // Add owner as workspace member with owner role
  await db.getAdapter().execute(
    'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)',
    [workspaceId, ownerId, 'owner']
  );

  return getWorkspaceById(workspaceId);
}

/**
 * Generate URL-friendly slug from name
 * @param {string} name
 * @returns {string}
 */
function generateSlug(name) {
  const base = name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const randomSuffix = crypto.randomBytes(3).toString('hex');
  return `${base}-${randomSuffix}`;
}

/**
 * Get workspace by ID
 * @param {number} workspaceId
 * @returns {Promise<Object|null>}
 */
async function getWorkspaceById(workspaceId) {
  const db = await getDatabaseInstance();
  const workspaces = await db.getAdapter().query(
    `SELECT w.*, u.username as owner_username
     FROM workspaces w
     JOIN users u ON w.owner_id = u.id
     WHERE w.id = ?`,
    [workspaceId]
  );

  if (workspaces.length === 0) return null;

  const ws = workspaces[0];
  return {
    id: ws.id,
    name: ws.name,
    slug: ws.slug,
    description: ws.description,
    ownerId: ws.owner_id,
    ownerUsername: ws.owner_username,
    settings: JSON.parse(ws.settings || '{}'),
    billingPlan: ws.billing_plan,
    createdAt: ws.created_at,
    updatedAt: ws.updated_at
  };
}

/**
 * Get workspace by slug
 * @param {string} slug
 * @returns {Promise<Object|null>}
 */
async function getWorkspaceBySlug(slug) {
  const db = await getDatabaseInstance();
  const workspaces = await db.getAdapter().query(
    'SELECT id FROM workspaces WHERE slug = ?',
    [slug]
  );

  if (workspaces.length === 0) return null;
  return getWorkspaceById(workspaces[0].id);
}

/**
 * Get all workspaces for a user
 * @param {number} userId
 * @returns {Promise<Array>}
 */
async function getUserWorkspaces(userId) {
  const db = await getDatabaseInstance();
  const workspaces = await db.getAdapter().query(
    `SELECT w.*, wm.role as member_role
     FROM workspaces w
     JOIN workspace_members wm ON w.id = wm.workspace_id
     WHERE wm.user_id = ?
     ORDER BY w.created_at DESC`,
    [userId]
  );

  return workspaces.map(ws => ({
    id: ws.id,
    name: ws.name,
    slug: ws.slug,
    description: ws.description,
    ownerId: ws.owner_id,
    memberRole: ws.member_role,
    settings: JSON.parse(ws.settings || '{}'),
    billingPlan: ws.billing_plan,
    createdAt: ws.created_at,
    updatedAt: ws.updated_at
  }));
}

/**
 * Update workspace
 * @param {number} workspaceId
 * @param {number} userId - User making the update
 * @param {Object} updates - { name?, description?, settings? }
 */
async function updateWorkspace(workspaceId, userId, updates) {
  // Check if user has permission to update
  const memberRole = await getWorkspaceMemberRole(workspaceId, userId);
  if (!memberRole || !['owner', 'admin'].includes(memberRole)) {
    throw new Error('Access denied: insufficient workspace permissions');
  }

  const db = await getDatabaseInstance();
  const sets = [];
  const values = [];

  if (updates.name !== undefined) {
    sets.push('name = ?');
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    sets.push('description = ?');
    values.push(updates.description);
  }
  if (updates.settings !== undefined) {
    sets.push('settings = ?');
    values.push(JSON.stringify(updates.settings));
  }

  if (sets.length === 0) {
    throw new Error('No updates provided');
  }

  sets.push('updated_at = CURRENT_TIMESTAMP');
  values.push(workspaceId);

  await db.getAdapter().execute(
    `UPDATE workspaces SET ${sets.join(', ')} WHERE id = ?`,
    values
  );

  return getWorkspaceById(workspaceId);
}

/**
 * Delete workspace (owner only)
 * @param {number} workspaceId
 * @param {number} userId
 */
async function deleteWorkspace(workspaceId, userId) {
  const memberRole = await getWorkspaceMemberRole(workspaceId, userId);
  if (memberRole !== 'owner') {
    throw new Error('Only workspace owner can delete workspace');
  }

  const db = await getDatabaseInstance();
  await db.getAdapter().execute(
    'DELETE FROM workspaces WHERE id = ?',
    [workspaceId]
  );
}

// ==================== Member Management ====================

/**
 * Get workspace members
 * @param {number} workspaceId
 * @returns {Promise<Array>}
 */
async function getWorkspaceMembers(workspaceId) {
  const db = await getDatabaseInstance();
  const members = await db.getAdapter().query(
    `SELECT wm.*, u.username, u.email
     FROM workspace_members wm
     JOIN users u ON wm.user_id = u.id
     WHERE wm.workspace_id = ?
     ORDER BY wm.joined_at DESC`,
    [workspaceId]
  );

  return members.map(m => ({
    id: m.id,
    userId: m.user_id,
    username: m.username,
    email: m.email,
    role: m.role,
    joinedAt: m.joined_at
  }));
}

/**
 * Get member role in workspace
 * @param {number} workspaceId
 * @param {number} userId
 * @returns {Promise<string|null>}
 */
async function getWorkspaceMemberRole(workspaceId, userId) {
  const db = await getDatabaseInstance();
  const members = await db.getAdapter().query(
    'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
    [workspaceId, userId]
  );

  return members.length > 0 ? members[0].role : null;
}

/**
 * Check if user is workspace member
 * @param {number} workspaceId
 * @param {number} userId
 * @returns {Promise<boolean>}
 */
async function isWorkspaceMember(workspaceId, userId) {
  const role = await getWorkspaceMemberRole(workspaceId, userId);
  return role !== null;
}

/**
 * Add member to workspace
 * @param {number} workspaceId
 * @param {number} userId - User to add
 * @param {string} role - 'admin', 'member', 'viewer'
 * @param {number} invitedBy - User making the invitation
 */
async function addWorkspaceMember(workspaceId, userId, role, invitedBy) {
  if (!['admin', 'member', 'viewer'].includes(role)) {
    throw new Error('Invalid member role');
  }

  // Check if inviter has permission
  const inviterRole = await getWorkspaceMemberRole(workspaceId, invitedBy);
  if (!inviterRole || !['owner', 'admin'].includes(inviterRole)) {
    throw new Error('Access denied: insufficient permissions to add members');
  }

  const db = await getDatabaseInstance();

  // Check if user is already a member
  const existing = await db.getAdapter().query(
    'SELECT id FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
    [workspaceId, userId]
  );

  if (existing.length > 0) {
    throw new Error('User is already a workspace member');
  }

  await db.getAdapter().execute(
    'INSERT INTO workspace_members (workspace_id, user_id, role, invited_by) VALUES (?, ?, ?, ?)',
    [workspaceId, userId, role, invitedBy]
  );
}

/**
 * Remove member from workspace
 * @param {number} workspaceId
 * @param {number} memberUserId - User to remove
 * @param {number} requesterId - User making the request
 */
async function removeWorkspaceMember(workspaceId, memberUserId, requesterId) {
  const requesterRole = await getWorkspaceMemberRole(workspaceId, requesterId);
  const memberRole = await getWorkspaceMemberRole(workspaceId, memberUserId);

  if (!memberRole) {
    throw new Error('User is not a workspace member');
  }

  // Owner can remove anyone except themselves
  if (requesterRole === 'owner') {
    if (memberUserId === requesterId) {
      throw new Error('Owner cannot remove themselves. Transfer ownership first.');
    }
  } else if (requesterRole === 'admin') {
    // Admin can only remove members and viewers, not other admins or owner
    if (memberRole === 'owner' || memberRole === 'admin') {
      throw new Error('Admins cannot remove other admins or owner');
    }
  } else {
    throw new Error('Access denied: insufficient permissions');
  }

  const db = await getDatabaseInstance();
  await db.getAdapter().execute(
    'DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
    [workspaceId, memberUserId]
  );
}

/**
 * Update member role
 * @param {number} workspaceId
 * @param {number} memberUserId
 * @param {string} newRole
 * @param {number} requesterId
 */
async function updateMemberRole(workspaceId, memberUserId, newRole, requesterId) {
  if (!['admin', 'member', 'viewer'].includes(newRole)) {
    throw new Error('Invalid member role');
  }

  const requesterRole = await getWorkspaceMemberRole(workspaceId, requesterId);
  const memberRole = await getWorkspaceMemberRole(workspaceId, memberUserId);

  if (!memberRole) {
    throw new Error('User is not a workspace member');
  }

  // Only owner can change roles
  if (requesterRole !== 'owner') {
    throw new Error('Only workspace owner can change member roles');
  }

  const db = await getDatabaseInstance();
  await db.getAdapter().execute(
    'UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?',
    [newRole, workspaceId, memberUserId]
  );
}

/**
 * Transfer workspace ownership
 * @param {number} workspaceId
 * @param {number} newOwnerId
 * @param {number} currentOwnerId
 */
async function transferOwnership(workspaceId, newOwnerId, currentOwnerId) {
  const currentRole = await getWorkspaceMemberRole(workspaceId, currentOwnerId);
  if (currentRole !== 'owner') {
    throw new Error('Only current owner can transfer ownership');
  }

  const newOwnerRole = await getWorkspaceMemberRole(workspaceId, newOwnerId);
  if (!newOwnerRole) {
    throw new Error('New owner must be a workspace member');
  }

  const db = await getDatabaseInstance();

  // Update new owner to 'owner' role
  await db.getAdapter().execute(
    'UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?',
    ['owner', workspaceId, newOwnerId]
  );

  // Demote current owner to admin
  await db.getAdapter().execute(
    'UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?',
    ['admin', workspaceId, currentOwnerId]
  );

  // Update workspace owner_id
  await db.getAdapter().execute(
    'UPDATE workspaces SET owner_id = ? WHERE id = ?',
    [newOwnerId, workspaceId]
  );
}

// ==================== Invites ====================

/**
 * Create workspace invite
 * @param {number} workspaceId
 * @param {string} email - Email to invite
 * @param {string} role - 'admin', 'member', 'viewer'
 * @param {number} invitedBy
 * @returns {Promise<Object>} { token, expiresAt }
 */
async function createInvite(workspaceId, email, role, invitedBy) {
  if (!['admin', 'member', 'viewer'].includes(role)) {
    throw new Error('Invalid invite role');
  }

  // Check permissions
  const inviterRole = await getWorkspaceMemberRole(workspaceId, invitedBy);
  if (!inviterRole || !['owner', 'admin'].includes(inviterRole)) {
    throw new Error('Access denied: insufficient permissions to invite');
  }

  const db = await getDatabaseInstance();
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

  await db.getAdapter().execute(
    'INSERT INTO workspace_invites (workspace_id, email, token, role, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    [workspaceId, email.toLowerCase(), token, role, invitedBy, expiresAt.toISOString()]
  );

  return { token, expiresAt };
}

/**
 * Accept workspace invite
 * @param {string} token
 * @param {number} userId - User accepting the invite
 */
async function acceptInvite(token, userId) {
  const db = await getDatabaseInstance();

  const invites = await db.getAdapter().query(
    `SELECT * FROM workspace_invites
     WHERE token = ? AND expires_at > CURRENT_TIMESTAMP AND accepted_at IS NULL`,
    [token]
  );

  if (invites.length === 0) {
    throw new Error('Invalid or expired invite token');
  }

  const invite = invites[0];

  // Add user to workspace
  await db.getAdapter().execute(
    `INSERT INTO workspace_members (workspace_id, user_id, role, invited_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [invite.workspace_id, userId, invite.role, invite.invited_by]
  );

  // Mark invite as accepted
  await db.getAdapter().execute(
    'UPDATE workspace_invites SET accepted_at = CURRENT_TIMESTAMP WHERE id = ?',
    [invite.id]
  );

  return getWorkspaceById(invite.workspace_id);
}

/**
 * Cancel workspace invite
 * @param {number} inviteId
 * @param {number} userId - User cancelling the invite
 */
async function cancelInvite(inviteId, userId) {
  const db = await getDatabaseInstance();

  const invites = await db.getAdapter().query(
    `SELECT wi.*, w.owner_id
     FROM workspace_invites wi
     JOIN workspaces w ON wi.workspace_id = w.id
     WHERE wi.id = ?`,
    [inviteId]
  );

  if (invites.length === 0) {
    throw new Error('Invite not found');
  }

  const invite = invites[0];

  // Check permissions (owner, admin, or inviter)
  const requesterRole = await getWorkspaceMemberRole(invite.workspace_id, userId);
  if (invite.invited_by !== userId && !['owner', 'admin'].includes(requesterRole)) {
    throw new Error('Access denied: cannot cancel this invite');
  }

  await db.getAdapter().execute(
    'DELETE FROM workspace_invites WHERE id = ?',
    [inviteId]
  );
}

/**
 * Get pending invites for workspace
 * @param {number} workspaceId
 * @returns {Promise<Array>}
 */
async function getWorkspaceInvites(workspaceId) {
  const db = await getDatabaseInstance();
  const invites = await db.getAdapter().query(
    `SELECT wi.*, inviter.username as invited_by_username
     FROM workspace_invites wi
     JOIN users inviter ON wi.invited_by = inviter.id
     WHERE wi.workspace_id = ? AND wi.accepted_at IS NULL AND wi.expires_at > CURRENT_TIMESTAMP
     ORDER BY wi.created_at DESC`,
    [workspaceId]
  );

  return invites.map(i => ({
    id: i.id,
    email: i.email,
    role: i.role,
    invitedBy: i.invited_by_username,
    expiresAt: i.expires_at,
    createdAt: i.created_at
  }));
}

module.exports = {
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
};
