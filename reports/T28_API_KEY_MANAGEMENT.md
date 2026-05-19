# T28 – API Key Management Implementation Report

## Overview
Successfully implemented a complete API key management system for programmatic access. Keys are prefixed with `orca_live_`, hashed in the database, support scoped permissions (read/write/admin), expiration, and immediate revocation.

## Changes Made

### Database Schema (`src/db/schema.sql`)
Added `api_keys` table:
- `id`, `user_id` (FK to users), `key_hash`, `key_prefix`
- `name` (human-readable label)
- `scopes` (JSON array: ['read', 'write', 'admin'])
- `expires_at`, `last_used_at`, `revoked_at`, `created_at`
- Indexes on `user_id`, `key_prefix`, `expires_at`

### API Key Manager (`src/auth/api-keys.js`)
- `generateRawKey()` - Generates keys with `orca_live_` prefix (48 random chars)
- `hashKey(rawKey)` / `verifyKey(rawKey, hash)` - bcrypt hashing for storage
- `createApiKey(userId, name, scopes, expiresInDays)` - Creates new key, returns raw key (shown once)
- `validateApiKey(rawKey)` - Validates key, updates last_used_at, returns userId + scopes
- `getUserApiKeys(userId)` - Lists all keys for user (shows prefix only, never full key)
- `revokeApiKey(keyId, userId)` - User revokes own key
- `adminRevokeApiKey(keyId)` - Admin revokes any key
- `deleteApiKey(keyId)` - Permanent deletion (admin only)
- `cleanupExpiredKeys()` - Revokes expired keys (run periodically)
- `hasScope(keyScopes, requiredScope)` - Checks if key has required scope
- `getApiKeyStats(userId)` - Returns total/active/revoked/expired counts

### Auth Middleware Updates (`src/auth/middleware.js`)
- `requireAuth()` now checks for `X-API-Key` header before JWT Bearer token
- `requireScope(scope)` - Middleware to enforce API key scope restrictions
- `authenticateByApiKey(apiKey)` - CLI equivalent for non-HTTP contexts
- API key auth sets `req.authType = 'api-key'` and `req.apiKeyScopes`

### Features
✅ **Prefix keys with orca_live_**: All generated keys start with `orca_live_` prefix
✅ **Keys hashed in DB**: bcrypt hashing with 10 rounds, raw key never stored
✅ **Scopes**: read, write, admin - admin grants all permissions
✅ **Expiration**: Optional expiration in days, automatic cleanup available
✅ **Revocation immediate**: Setting `revoked_at` immediately invalidates key
✅ **Usage tracking**: `last_used_at` updated on each successful validation
✅ **Stats**: Per-user statistics on key counts by status

## Tests
- **23 tests passing** across 2 suites:
  - API Key Generation (3 tests): Prefix, uniqueness, hash/verify
  - API Key Management (20 tests): Create, validate, scopes, expiration, revoke, delete, cleanup, stats

## Files Modified/Created
1. `src/db/schema.sql` - Added `api_keys` table with indexes
2. `src/auth/api-keys.js` - New: Complete API key management
3. `src/auth/middleware.js` - Updated: API key auth integration + requireScope
4. `tests/unit/api-keys.test.js` - New: Comprehensive API key tests
5. `ORCA_PRODUCTION_ROADMAP.csv` - Updated: T28 status → Done

## Next Steps (T29 - Role-Based Access Control)
- Expand permission matrices for Admin/Manager/User/Guest roles
- Implement fine-grained permissions per agent/tool
- Add route-level middleware for all endpoints
- Create admin dashboard commands
