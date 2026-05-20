# Migration Guide: v1 (JSON) to v2 (Database)

This guide covers migrating from Orca v1 (JSON file storage) to v2 (SQLite/PostgreSQL database).

## Overview

Orca v2 replaces flat JSON files with a proper database for sessions, analytics, agents, and events. This provides:

- Concurrent access without file locking
- Structured queries and aggregation
- User isolation and RBAC
- Automatic daily/weekly/monthly analytics rollups
- PostgreSQL support for production deployments

## Breaking Changes

| Area | v1 | v2 |
|------|----|----|
| Session storage | `sessions/history.json` | `sessions` table in DB |
| Analytics | `data/analytics.json` | `costs` + `analytics_*` tables |
| Events | `data/events.jsonl` | `events` table |
| Agent definitions | `src/agents.json` (read-only) | `agents` table (editable via API) |
| Skills | `skills/registry.json` | `skills` table |
| Authentication | None | JWT + API keys (required for API) |
| Rate limiting | None | 100 req/min per key |

## Prerequisites

- Node.js >= 18.0.0
- Existing v1 data files (or starting fresh)
- `better-sqlite3` (included) or PostgreSQL connection

## Migration Steps

### 1. Backup your data

```bash
# Create a backup of all JSON files
mkdir -p backups/v1
cp -r sessions/ backups/v1/sessions/
cp -r data/ backups/v1/data/
cp -r skills/ backups/v1/skills/
cp src/agents.json backups/v1/agents.json

# Or use the built-in backup script
npm run db:backup
```

### 2. Initialize the database schema

```bash
npm run db:migrate
```

This creates all required tables in `data/orca.db` (SQLite) or your configured PostgreSQL database.

### 3. Run the migration script

```bash
# Preview what will be migrated (dry run)
node scripts/migrate.js --dry-run

# Run the actual migration
node scripts/migrate.js

# Skip confirmation prompts
node scripts/migrate.js --force
```

The migration script:
- Reads `sessions/history.json` into the `sessions` table
- Reads `src/agents.json` into the `agents` table
- Reads `data/events.jsonl` into the `events` table
- Reads `skills/registry.json` into the `skills` table
- Records SHA-256 checksums for verification
- Skips tables that already have data (idempotent)

### 4. Verify the migration

```bash
# Check database contents
node -e "
const db = require('./src/db');
(async () => {
  const d = await db.getDatabaseInstance();
  const sessions = await d.getAdapter().query('SELECT COUNT(*) as cnt FROM sessions');
  const agents = await d.getAdapter().query('SELECT COUNT(*) as cnt FROM agents');
  const events = await d.getAdapter().query('SELECT COUNT(*) as cnt FROM events');
  console.log('Sessions:', sessions[0].cnt);
  console.log('Agents:', agents[0].cnt);
  console.log('Events:', events[0].cnt);
})();
"
```

### 5. Configure authentication (new in v2)

```bash
# Set JWT secret in .env
echo "ORCA_JWT_SECRET=$(openssl rand -hex 32)" >> .env

# Register an admin user
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","email":"admin@example.com","password":"your-secure-password","role":"admin"}'
```

### 6. Start the server

```bash
npm start
```

## Rollback

If you need to revert to v1:

```bash
# View rollback instructions
node scripts/migrate.js --rollback

# Remove the database
rm data/orca.db

# Restore from backup
cp -r backups/v1/sessions/ sessions/
cp -r backups/v1/data/ data/
cp backups/v1/agents.json src/agents.json
```

## Environment Variables (v2 additions)

| Variable | Default | Description |
|----------|---------|-------------|
| `ORCA_DB_TYPE` | `sqlite` | Database type: `sqlite` or `postgresql` |
| `ORCA_DB_URL` | - | PostgreSQL connection string |
| `ORCA_JWT_SECRET` | - | Secret for JWT token signing (required, min 32 chars) |
| `ORCA_JWT_REFRESH_SECRET` | derived | Refresh token secret |
| `ORCA_REDIS_URL` | - | Redis URL for caching (optional) |
| `ORCA_RATE_LIMIT_MAX` | `100` | Max requests per minute per key |

## New Features in v2

- **REST API**: Full CRUD for agents, sessions, analytics, skills, billing
- **GraphQL**: Schema-first API with subscriptions
- **Authentication**: JWT + API key auth with role-based access
- **Rate limiting**: Configurable per-key request limits
- **Cache layer**: Redis-backed with graceful degradation
- **Agent performance metrics**: Per-agent success rate, latency, leaderboard
- **Load testing**: k6 suite + Node.js benchmark (`npm run test:load`)
- **Backup/restore**: Automated with rotation (`npm run db:backup`)

## Troubleshooting

### Migration says "Table already has rows"

The script is idempotent — it skips tables with existing data. To re-migrate:

```sql
-- Clear the specific table
DELETE FROM sessions;
-- Then re-run
node scripts/migrate.js
```

### Database not initialized

```
❌ Database schema not initialized. Run npm run db:migrate first.
```

Run `npm run db:migrate` before the migration script.

### JSON parse errors

Corrupt JSON files will cause migration to fail. Validate with:

```bash
node -e "JSON.parse(require('fs').readFileSync('sessions/history.json'))"
```

### Permission errors

Ensure the `data/` directory is writable:

```bash
ls -la data/
chmod 755 data/
```

### PostgreSQL connection issues

Check your connection string and ensure the database exists:

```bash
psql $DATABASE_URL -c "SELECT 1"
```
