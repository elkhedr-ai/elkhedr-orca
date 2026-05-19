# Database Backup Guide

## Overview

Elkhedr Orca includes a comprehensive backup system supporting both SQLite and PostgreSQL databases. Backups can be created via shell scripts, the programmatic API, or scheduled automatically.

## Quick Start

### Create a Backup

**Using npm:**
```bash
npm run db:backup
```

**Using the shell script directly:**
```bash
# SQLite (default)
./scripts/backup.sh

# PostgreSQL
ORCA_DB_TYPE=postgresql ./scripts/backup.sh

# Custom output directory
./scripts/backup.sh --output-dir /mnt/backups/orca
```

**Using the API (admin only):**
```bash
curl -X POST http://localhost:3000/api/v1/backups \
  -H "Authorization: Bearer <admin_token>"
```

### Restore from Backup

```bash
# SQLite restore
./scripts/restore.sh backups/db/orca-sqlite-20250101_120000.db

# PostgreSQL restore
./scripts/restore.sh backups/db/orca-pgsql-20250101_120000.sql.gz

# Dry-run (preview without restoring)
./scripts/restore.sh backups/db/orca-sqlite-20250101_120000.db --dry-run

# Force restore (skip confirmation)
./scripts/restore.sh backups/db/orca-sqlite-20250101_120000.db --force
```

### List Available Backups

```bash
# Via CLI
npm run db:backup:list

# Via API
curl http://localhost:3000/api/v1/backups \
  -H "Authorization: Bearer <admin_token>"
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ORCA_BACKUP_DIR` | `./backups/db` | Backup output directory |
| `ORCA_BACKUP_RETENTION_DAYS` | `30` | Days to keep backups |
| `ORCA_BACKUP_SCHEDULE` | `0 3 * * *` | Cron schedule expression |
| `ORCA_DB_PASSWORD` | — | PostgreSQL password for pg_dump/restore |

### On-Demand Backup (API)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/backups` | List available backups |
| `GET` | `/backups/status` | Get backup system status |
| `GET` | `/backups/:filename` | Get backup details |
| `POST` | `/backups` | Create a new backup |
| `POST` | `/backups/rotate` | Manually trigger rotation |
| `POST` | `/backups/scheduler` | Start/stop backup scheduler |

### Scheduled Backups

The backup scheduler runs automatically every 24 hours by default. Start/stop it via:

```bash
# Start with 24h interval
curl -X POST http://localhost:3000/api/v1/backups/scheduler \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"action": "start", "intervalHours": 24}'

# Stop
curl -X POST http://localhost:3000/api/v1/backups/scheduler \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"action": "stop"}'
```

### Cron Job Setup (Linux/macOS)

For production, add a cron job:

```bash
# Daily at 3 AM
0 3 * * * /path/to/orca/scripts/backup.sh >> /var/log/orca-backup.log 2>&1

# Every 6 hours
0 */6 * * * /path/to/orca/scripts/backup.sh >> /var/log/orca-backup.log 2>&1
```

## Backup Storage

Backups are stored in the configured backup directory (default: `backups/db/`):

```
backups/db/
├── orca-sqlite-20250101_030000.db          # SQLite backup
├── orca-sqlite-20250101_030000.db.sha256   # Checksum
├── orca-pgsql-20250101_030000.sql.gz       # PostgreSQL backup
└── orca-pgsql-20250101_030000.sql.gz.sha256 # Checksum
```

Each backup is accompanied by a SHA-256 checksum file for integrity verification.

## Backup Rotation

Old backups are automatically removed based on `ORCA_BACKUP_RETENTION_DAYS` (default: 30 days). Set to `0` to disable rotation (keep all backups). Rotation runs after every backup creation and can also be triggered manually.

## Recovery Process

1. **Verify the backup integrity** — checksum is checked automatically
2. **Stop the application** — ensures no writes during restore
3. **Run the restore script** — creates a pre-restore backup automatically
4. **Verify the restored data** — run the health check
5. **Restart the application**

## Production Considerations

- **For PostgreSQL**: Ensure `pg_dump` and `pg_restore` are installed on the backup host
- **For SQLite**: The `sqlite3` CLI tool is required for shell script backups
- **Cross-region replication**: For enterprise deployments, configure off-site backup copies
- **RPO**: Recovery Point Objective of 24 hours (configurable via schedule)
- **RTO**: Recovery Time Objective of under 4 hours for typical restore sizes
