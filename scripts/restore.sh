#!/usr/bin/env bash
# ============================================================
# Orca Database Restore Script
# Restores from a backup file. Supports SQLite and PostgreSQL.
# Usage: ./scripts/restore.sh <backup-file> [--db-type sqlite|postgresql]
#   --dry-run    Preview what would be restored
#   --force      Skip confirmation prompt
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DB_TYPE="${ORCA_DB_TYPE:-sqlite}"
DRY_RUN=false
FORCE=false

usage() {
  echo "Usage: $0 <backup-file> [options]"
  echo ""
  echo "Options:"
  echo "  --db-type sqlite|postgresql   Database type (default: $DB_TYPE)"
  echo "  --dry-run                     Preview what would be restored"
  echo "  --force                       Skip confirmation prompt"
  echo ""
  echo "Examples:"
  echo "  $0 backups/db/orca-sqlite-20250101_120000.db"
  echo "  $0 backups/db/orca-pgsql-20250101_120000.sql.gz"
  echo "  ORCA_DB_HOST=prod-host $0 backups/db/orca-pgsql-20250101_120000.sql.gz"
  exit 1
}

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
error_exit() { log "ERROR: $*"; exit 1; }

verify_backup() {
  local file="$1"
  local checksum_file="${file}.sha256"

  if [ ! -f "$file" ]; then
    error_exit "Backup file not found: $file"
  fi

  # Verify checksum if available
  if [ -f "$checksum_file" ]; then
    local expected=$(cat "$checksum_file" | tr -d ' \n')
    local actual=$(sha256sum "$file" | awk '{print $1}')
    if [ "$expected" != "$actual" ]; then
      error_exit "Checksum mismatch! File may be corrupted. Expected: $expected, Got: $actual"
    fi
    log "Checksum verified successfully"
  else
    log "WARNING: No checksum file found for verification"
  fi

  # Detect type from file extension
  case "$file" in
    *.db)     DB_TYPE_FROM_FILE="sqlite" ;;
    *.sql.gz) DB_TYPE_FROM_FILE="postgresql" ;;
    *.dump)   DB_TYPE_FROM_FILE="postgresql" ;;
    *.sql)    DB_TYPE_FROM_FILE="sqlite" ;; # Treat .sql as SQLite plain dump
    *)
      error_exit "Cannot determine database type from file extension. Use --db-type"
      ;;
  esac

  log "Backup file verified: $file ($(du -h "$file" | cut -f1))"
}

restore_sqlite() {
  local backup_file="$1"
  local db_path="${ORCA_DB_PATH:-$PROJECT_DIR/data/orca.db}"

  if [ "$DRY_RUN" = true ]; then
    log "[DRY RUN] Would restore SQLite: $backup_file -> $db_path"
    return 0
  fi

  # Create backup of current database before restore
  local pre_restore_backup="$PROJECT_DIR/data/orca-pre-restore-$(date +%Y%m%d_%H%M%S).db"
  if [ -f "$db_path" ]; then
    sqlite3 "$db_path" ".backup '$pre_restore_backup'"
    log "Pre-restore backup created: $pre_restore_backup"
  fi

  # Close existing connections by restoring to a temp file first, then replacing
  local temp_restore="$PROJECT_DIR/data/orca-restore-tmp.db"
  case "$backup_file" in
    *.db)
      sqlite3 "$temp_restore" ".restore '$backup_file'" || {
        sqlite3 "$backup_file" "VACUUM INTO '$temp_restore'" || error_exit "SQLite restore failed"
      }
      ;;
    *.sql)
      sqlite3 "$temp_restore" < "$backup_file" || error_exit "SQLite restore from SQL failed"
      ;;
    *)
      error_exit "Unsupported SQLite backup format: $backup_file"
      ;;
  esac

  # Verify the restored database
  sqlite3 "$temp_restore" "SELECT COUNT(*) FROM sqlite_master;" > /dev/null || error_exit "Restored database verification failed"

  # Atomically replace
  mv "$temp_restore" "$db_path"
  log "SQLite database restored: $db_path"
}

restore_postgresql() {
  local backup_file="$1"
  local pg_host="${ORCA_DB_HOST:-localhost}"
  local pg_port="${ORCA_DB_PORT:-5432}"
  local pg_db="${ORCA_DB_NAME:-orca}"
  local pg_user="${ORCA_DB_USER:-orca}"

  if [ "$DRY_RUN" = true ]; then
    log "[DRY RUN] Would restore PostgreSQL: $backup_file -> $pg_db on $pg_host:$pg_port"
    return 0
  fi

  # Verify connection
  PGPASSWORD="${ORCA_DB_PASSWORD}" psql \
    -h "$pg_host" -p "$pg_port" -U "$pg_user" -d "$pg_db" \
    -c "SELECT 1;" > /dev/null 2>&1 || error_exit "Cannot connect to PostgreSQL"

  # Drop and recreate database (in a transaction)
  log "Recreating database: $pg_db"
  PGPASSWORD="${ORCA_DB_PASSWORD}" psql \
    -h "$pg_host" -p "$pg_port" -U "$pg_user" -d "postgres" \
    -c "DROP DATABASE IF EXISTS \"$pg_db\";" > /dev/null
  PGPASSWORD="${ORCA_DB_PASSWORD}" psql \
    -h "$pg_host" -p "$pg_port" -U "$pg_user" -d "postgres" \
    -c "CREATE DATABASE \"$pg_db\";" > /dev/null

  case "$backup_file" in
    *.sql.gz)
      log "Restoring from compressed SQL dump..."
      gunzip -c "$backup_file" | PGPASSWORD="${ORCA_DB_PASSWORD}" psql \
        -h "$pg_host" -p "$pg_port" -U "$pg_user" -d "$pg_db" > /dev/null || error_exit "PostgreSQL restore failed"
      ;;
    *.dump)
      log "Restoring from custom-format dump..."
      PGPASSWORD="${ORCA_DB_PASSWORD}" pg_restore \
        -h "$pg_host" -p "$pg_port" -U "$pg_user" \
        -d "$pg_db" \
        --clean \
        --no-owner \
        --no-acl \
        "$backup_file" || error_exit "PostgreSQL restore failed"
      ;;
    *.sql)
      log "Restoring from plain SQL..."
      PGPASSWORD="${ORCA_DB_PASSWORD}" psql \
        -h "$pg_host" -p "$pg_port" -U "$pg_user" -d "$pg_db" \
        -f "$backup_file" > /dev/null || error_exit "PostgreSQL restore failed"
      ;;
    *)
      error_exit "Unsupported PostgreSQL backup format: $backup_file"
      ;;
  esac

  log "PostgreSQL database restored: $pg_db"
}

# --- Parse Arguments ---
if [ $# -eq 0 ]; then
  usage
fi

BACKUP_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --db-type)        DB_TYPE="$2"; shift 2 ;;
    --dry-run)        DRY_RUN=true; shift ;;
    --force)          FORCE=true; shift ;;
    -h|--help)        usage ;;
    *)                BACKUP_FILE="$1"; shift ;;
  esac
done

if [ -z "$BACKUP_FILE" ]; then
  usage
fi

# --- Main ---
BACKUP_FILE="$(cd "$(dirname "$BACKUP_FILE")" 2>/dev/null && pwd)/$(basename "$BACKUP_FILE")"

log "Starting database restore"
verify_backup "$BACKUP_FILE"

# Use file-detected type if --db-type not explicitly set
if [ -n "${DB_TYPE_FROM_FILE:-}" ] && [ "${DB_TYPE:-}" = "${ORCA_DB_TYPE:-sqlite}" ]; then
  DB_TYPE="$DB_TYPE_FROM_FILE"
fi

log "Restore type: $DB_TYPE"

if [ "$DRY_RUN" = false ] && [ "$FORCE" = false ]; then
  echo ""
  echo "WARNING: This will OVERWRITE the current database!"
  echo "  Backup file: $BACKUP_FILE"
  echo "  Database type: $DB_TYPE"
  echo ""
  read -r -p "Are you sure? (type 'yes' to continue): " confirm
  if [ "$confirm" != "yes" ]; then
    log "Restore cancelled"
    exit 0
  fi
fi

case "$DB_TYPE" in
  sqlite|sqlite3)
    restore_sqlite "$BACKUP_FILE"
    ;;
  postgresql|postgres|pg)
    restore_postgresql "$BACKUP_FILE"
    ;;
  *)
    error_exit "Unknown database type: $DB_TYPE"
    ;;
esac

log "Restore completed successfully"
