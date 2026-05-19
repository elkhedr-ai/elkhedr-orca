/**
 * Tests for T50: Organization Management
 * Tests OrganizationManager, SSO config, and SCIM provisioning.
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

// Mock database
const mockRows = { orgs: [], members: [], audit: [], users: [] };

const mockDb = {
  getAdapter: () => ({
    execute: async (sql, params) => {
      if (sql.includes('CREATE TABLE')) return [];
      if (sql.includes('CREATE INDEX')) return [];

      // INSERT INTO organizations
      if (sql.includes('INSERT INTO organizations')) {
        const org = {
          id: mockRows.orgs.length + 1,
          name: params?.[0],
          slug: params?.[1],
          domain: params?.[2],
          plan: params?.[3] || 'basic',
          sso_enabled: 0,
          sso_provider: null,
          sso_config: null,
          scim_enabled: 0,
          scim_token: null,
          data_retention_days: 365,
          custom_domain: null,
          settings: params?.[4] || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        mockRows.orgs.push(org);
        return { lastInsertRowid: org.id, insertId: org.id };
      }

      // INSERT INTO organization_members
      if (sql.includes('INSERT INTO organization_members')) {
        // Role may be a SQL literal (e.g., 'owner') or a parameter
        let role = 'member';
        const roleMatch = sql.match(/VALUES\s*\([^)]*,\s*[^)]*,\s*'([^']+)'/);
        if (roleMatch) {
          role = roleMatch[1];
        } else if (params?.[2] && typeof params[2] === 'string') {
          role = params[2];
        }
        mockRows.members.push({
          org_id: params?.[0],
          user_id: params?.[1],
          role,
          invited_at: new Date().toISOString(),
          joined_at: sql.includes('CURRENT_TIMESTAMP') ? new Date().toISOString() : null
        });
        return { lastInsertRowid: mockRows.members.length };
      }

      // INSERT INTO audit_logs
      if (sql.includes('INSERT INTO audit_logs')) {
        mockRows.audit.push({
          id: mockRows.audit.length + 1,
          org_id: params?.[0],
          user_id: params?.[1],
          action: params?.[2],
          resource_type: params?.[3],
          resource_id: params?.[4],
          details: params?.[5],
          created_at: new Date().toISOString()
        });
        return { lastInsertRowid: mockRows.audit.length };
      }

      // SELECT organizations by user
      if (sql.includes('JOIN organization_members')) {
        return mockRows.orgs.filter(o =>
          mockRows.members.some(m => m.org_id === o.id && m.user_id === params?.[0])
        );
      }

      // SELECT single org by slug
      if (sql.includes('WHERE slug = ?')) {
        const org = mockRows.orgs.find(o => o.slug === params?.[0]);
        return org ? [org] : [];
      }

      // SELECT single org by id
      if (sql.includes('SELECT * FROM organizations WHERE id = ?')) {
        const org = mockRows.orgs.find(o => o.id === params?.[0]);
        return org ? [org] : [];
      }

      // SELECT members
      if (sql.includes('SELECT') && sql.includes('organization_members') && sql.includes('WHERE om.org_id = ?')) {
        return mockRows.members.filter(m => m.org_id === params?.[0]);
      }

      // SELECT role check
      if (sql.includes('SELECT role FROM organization_members')) {
        const member = mockRows.members.find(m => m.org_id === params?.[0] && m.user_id === params?.[1]);
        return member ? [{ role: member.role }] : [];
      }

      // SELECT audit logs
      if (sql.includes('SELECT * FROM audit_logs')) {
        return mockRows.audit.filter(a => a.org_id === params?.[0]);
      }

      // UPDATE organization_members role
      if (sql.includes('UPDATE organization_members SET role')) {
        const member = mockRows.members.find(m => m.org_id === params?.[1] && m.user_id === params?.[2]);
        if (member) member.role = params?.[0];
        return { changes: member ? 1 : 0 };
      }

      // UPDATE organizations
      if (sql.includes('UPDATE organizations SET')) {
        const orgId = params?.[params.length - 1];
        const org = mockRows.orgs.find(o => o.id === orgId);
        if (org) {
          if (sql.includes('sso_enabled')) {
            org.sso_enabled = params?.[0];
            org.sso_provider = params?.[1];
            org.sso_config = params?.[2];
          }
          if (sql.includes('scim_enabled')) {
            org.scim_enabled = params?.[0];
            org.scim_token = params?.[1];
          }
          if (sql.includes('name = ?')) org.name = params?.[0];
        }
        return { changes: org ? 1 : 0 };
      }

      // DELETE
      if (sql.includes('DELETE FROM organizations')) {
        const idx = mockRows.orgs.findIndex(o => o.id === params?.[0]);
        if (idx !== -1) {
          mockRows.orgs.splice(idx, 1);
          return { changes: 1 };
        }
        return { changes: 0 };
      }

      if (sql.includes('DELETE FROM organization_members WHERE org_id = ? AND user_id = ?')) {
        const idx = mockRows.members.findIndex(m => m.org_id === params?.[0] && m.user_id === params?.[1]);
        if (idx !== -1) {
          mockRows.members.splice(idx, 1);
          return { changes: 1 };
        }
        return { changes: 0 };
      }

      return [];
    }
  })
};

require.cache[require.resolve('../../src/db')] = {
  loaded: true,
  exports: { getDatabaseInstance: async () => mockDb }
};

require.cache[require.resolve('../../src/utils/logger.js')] = {
  loaded: true,
  exports: { logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } }
};

const { OrganizationManager } = require('../../src/enterprise/orgs.js');
const { validateSSOConfig, SSO_PROVIDERS, generateState, generateNonce, decodeIDToken } = require('../../src/enterprise/sso.js');
const { parseSCIMFilter, formatSCIMUser, formatSCIMList } = require('../../src/enterprise/scim.js');

describe('T50: Organization CRUD', () => {
  let manager;

  beforeEach(() => {
    mockRows.orgs = [];
    mockRows.members = [];
    mockRows.audit = [];
    manager = new OrganizationManager();
  });

  it('should create an organization', async () => {
    const org = await manager.createOrganization(1, { name: 'Acme Corp' });
    assert.ok(org.id);
    assert.strictEqual(org.name, 'Acme Corp');
    assert.ok(org.slug.includes('acme'));
    assert.strictEqual(org.plan, 'basic');
  });

  it('should auto-generate slug from name', async () => {
    const org = await manager.createOrganization(1, { name: 'My Test Organization!' });
    assert.strictEqual(org.slug, 'my-test-organization-');
  });

  it('should use custom slug', async () => {
    const org = await manager.createOrganization(1, { name: 'Acme', slug: 'acme-custom' });
    assert.strictEqual(org.slug, 'acme-custom');
  });

  it('should add creator as owner', async () => {
    await manager.createOrganization(1, { name: 'Acme' });
    const role = await manager.isMember(1, 1);
    assert.strictEqual(role, 'owner');
  });

  it('should get organization by ID', async () => {
    const created = await manager.createOrganization(1, { name: 'Acme' });
    const org = await manager.getOrganization(created.id);
    assert.ok(org);
    assert.strictEqual(org.name, 'Acme');
  });

  it('should get organization by slug', async () => {
    await manager.createOrganization(1, { name: 'Acme', slug: 'acme-corp' });
    const org = await manager.getOrganizationBySlug('acme-corp');
    assert.ok(org);
    assert.strictEqual(org.name, 'Acme');
  });

  it('should list organizations for a user', async () => {
    await manager.createOrganization(1, { name: 'Org A' });
    await manager.createOrganization(1, { name: 'Org B' });
    await manager.createOrganization(2, { name: 'Org C' });

    const orgs = await manager.listOrganizations(1);
    assert.strictEqual(orgs.length, 2);
  });

  it('should update organization', async () => {
    const created = await manager.createOrganization(1, { name: 'Old Name' });
    const updated = await manager.updateOrganization(created.id, { name: 'New Name' });
    assert.strictEqual(updated.name, 'New Name');
  });

  it('should delete organization', async () => {
    const created = await manager.createOrganization(1, { name: 'Acme' });
    const deleted = await manager.deleteOrganization(created.id);
    assert.ok(deleted);
  });
});

describe('T50: Organization Members', () => {
  let manager;

  beforeEach(() => {
    mockRows.orgs = [];
    mockRows.members = [];
    mockRows.audit = [];
    manager = new OrganizationManager();
  });

  it('should add a member', async () => {
    await manager.createOrganization(1, { name: 'Acme' });
    const added = await manager.addMember(1, 2, 'member');
    assert.ok(added);
  });

  it('should list members', async () => {
    await manager.createOrganization(1, { name: 'Acme' });
    await manager.addMember(1, 2, 'admin');
    const members = await manager.listMembers(1);
    assert.strictEqual(members.length, 2); // owner + new member
  });

  it('should update member role', async () => {
    await manager.createOrganization(1, { name: 'Acme' });
    await manager.addMember(1, 2, 'member');
    await manager.updateMemberRole(1, 2, 'admin');
    const role = await manager.isMember(1, 2);
    assert.strictEqual(role, 'admin');
  });

  it('should remove a member', async () => {
    await manager.createOrganization(1, { name: 'Acme' });
    await manager.addMember(1, 2, 'member');
    const removed = await manager.removeMember(1, 2);
    assert.ok(removed);
    const role = await manager.isMember(1, 2);
    assert.strictEqual(role, null);
  });

  it('should check membership', async () => {
    await manager.createOrganization(1, { name: 'Acme' });
    assert.strictEqual(await manager.isMember(1, 1), 'owner');
    assert.strictEqual(await manager.isMember(1, 2), null);
  });
});

describe('T50: SSO Configuration', () => {
  it('should validate SAML2 config', () => {
    const result = validateSSOConfig('saml2', {
      entryPoint: 'https://idp.example.com/sso',
      issuer: 'https://orca.example.com',
      cert: 'MIIDx...'
    });
    assert.strictEqual(result.valid, true);
  });

  it('should reject invalid SAML2 config', () => {
    const result = validateSSOConfig('saml2', {});
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it('should validate OIDC config', () => {
    const result = validateSSOConfig('oidc', {
      clientId: 'test',
      clientSecret: 'secret',
      issuer: 'https://accounts.google.com'
    });
    assert.strictEqual(result.valid, true);
  });

  it('should reject unsupported provider', () => {
    const result = validateSSOConfig('unknown', {});
    assert.strictEqual(result.valid, false);
  });

  it('should list supported providers', () => {
    assert.ok(SSO_PROVIDERS.SAML2);
    assert.ok(SSO_PROVIDERS.OIDC);
    assert.ok(SSO_PROVIDERS.AZURE_AD);
    assert.ok(SSO_PROVIDERS.OKTA);
    assert.ok(SSO_PROVIDERS.GOOGLE);
  });

  it('should generate state parameter', () => {
    const state = generateState();
    assert.strictEqual(state.length, 64);
  });

  it('should generate nonce', () => {
    const nonce = generateNonce();
    assert.strictEqual(nonce.length, 32);
  });

  it('should decode ID token', () => {
    // Create a mock JWT
    const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      sub: '123',
      email: 'test@example.com',
      name: 'Test User',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iss: 'https://accounts.google.com',
      aud: 'test-client-id'
    })).toString('base64url');
    const signature = 'fake-sig';
    const token = `${header}.${payload}.${signature}`;

    const decoded = decodeIDToken(token);
    assert.strictEqual(decoded.sub, '123');
    assert.strictEqual(decoded.email, 'test@example.com');
    assert.strictEqual(decoded.name, 'Test User');
  });
});

describe('T50: SCIM Utilities', () => {
  it('should parse simple eq filter', () => {
    const result = parseSCIMFilter('userName eq "john@example.com"');
    assert.deepStrictEqual(result, { field: 'userName', operator: 'eq', value: 'john@example.com' });
  });

  it('should parse boolean filter', () => {
    const result = parseSCIMFilter('active eq true');
    assert.deepStrictEqual(result, { field: 'active', operator: 'eq', value: true });
  });

  it('should return null for empty filter', () => {
    assert.strictEqual(parseSCIMFilter(null), null);
    assert.strictEqual(parseSCIMFilter(''), null);
  });

  it('should format SCIM user', () => {
    const user = formatSCIMUser({
      id: 1,
      email: 'test@example.com',
      username: 'testuser',
      name: 'Test User',
      first_name: 'Test',
      last_name: 'User',
      active: true,
      created_at: '2026-01-01T00:00:00Z'
    }, 1);

    assert.strictEqual(user.schemas[0], 'urn:ietf:params:scim:schemas:core:2.0:User');
    assert.strictEqual(user.userName, 'testuser');
    assert.strictEqual(user.emails[0].value, 'test@example.com');
    assert.strictEqual(user.active, true);
  });

  it('should format SCIM list response', () => {
    const list = formatSCIMList([{ id: 1 }, { id: 2 }], 2, 1, 100);
    assert.strictEqual(list.totalResults, 2);
    assert.strictEqual(list.Resources.length, 2);
  });
});
