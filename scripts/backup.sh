#!/usr/bin/env bash
# ============================================================
# Orca Database Backup Script
# Supports SQLite and PostgreSQL backups with rotation.
# Usage: ./scripts/backup.sh [--db-type sqlite|postgresql] [--output-dir ./backups]
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DB_TYPE="${ORCA_DB_TYPE:-sqlite}"
BACKUP_DIR="${1:-${ORCA_BACKUP_DIR:-$PROJECT_DIR/backups/db}}"
RETENTION_DAYS="${ORCA_BACKUP_RETENTION_DAYS:-30}"

mkdir -p "$BACKUP_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
error_exit() { log "ERROR: $*"; exit 1; }

backup_sqlite() {
  local db_path="${ORCA_DB_PATH:-$PROJECT_DIR/data/orca.db}"
  local backup_file="$BACKUP_DIR/orca-sqlite-$TIMESTAMP.db"
  local checksum_file="$backup_file.sha256"

  if [ ! -f "$db_path" ]; then
    error_exit "SQLite database not found at: $db_path"
  fi

  log "Backing up SQLite database: $db_path"

  # Use .backup command for safe online backup (WAL mode compatible)
  sqlite3 "$db_path" ".backup '$backup_file'" || {
    # Fallback: copy with VACUUM
    sqlite3 "$db_path" "VACUUM INTO '$backup_file'" || error_exit "SQLite backup failed"
  }

  # Generate checksum
  sha256sum "$backup_file" | awk '{print $1}' > "$checksum_file"
  log "SQLite backup created: $backup_file ($(du -h "$backup_file" | cut -f1))"
  echo "$backup_file"
}

backup_postgresql() {
  local pg_host="${ORCA_DB_HOST:-localhost}"
  local pg_port="${ORCA_DB_PORT:-5432}"
  local pg_db="${ORCA_DB_NAME:-orca}"
  local pg_user="${ORCA_DB_USER:-orca}"
  local backup_file="$BACKUP_DIR/orca-pgsql-$TIMESTAMP.sql.gz"
  local checksum_file="$backup_file.sha256"

  log "Backing up PostgreSQL database: $pg_db on $pg_host:$pg_port"

  PGPASSWORD="${ORCA_DB_PASSWORD}" pg_dump \
    -h "$pg_host" \
    -p "$pg_port" \
    -U "$pg_user" \
    -d "$pg_db" \
    --clean \
    --if-exists \
    --no-owner \
    --no-acl \
    --format=custom \
    --compress=9 \
    --file="$backup_file" \
    --verbose 2>&1 | tail -1 || error_exit "PostgreSQL backup failed"

  # Also dump plain SQL for readability
  local sql_file="$BACKUP_DIR/orca-pgsql-$TIMESTAMP.sql"
  PGPASSWORD="${ORCA_DB_PASSWORD}" pg_dump \
    -h "$pg_host" \
    -p "$pg_port" \
    -U "$pg_user" \
    -d "$pg_db" \
    --clean \
    --if-exists \
    --no-owner \
    --no-acl \
    --file="$sql_file" 2>/dev/null || true
  gzip -f "$sql_file" 2>/dev/null || true

  # Generate checksum
  sha256sum "$backup_file" | awk '{print $1}' > "$checksum_file"
  log "PostgreSQL backup created: $backup_file ($(du -h "$backup_file" | cut -f1))"
  echo "$backup_file"
}

rotate_backups() {
  log "Rotating backups older than $RETENTION_DAYS days"
  local count=0
  while IFS= read -r -d '' file; do
    rm -f "$file"
    # Remove associated checksum
    rm -f "${file}.sha256"
    count=$((count + 1))
  done < <(find "$BACKUP_DIR" -name "orca-*" -type f -mtime "+$RETENTION_DAYS" -print0)
  log "Removed $count expired backup(s)"
}

# --- Main ---
log "Starting database backup (type: $DB_TYPE)"
case "$DB_TYPE" in
  sqlite|sqlite3)
    backup_sqlite
    ;;
  postgresql|postgres|pg)
    backup_postgresql
    ;;
  *)
    error_exit "Unknown database type: $DB_TYPE (use sqlite or postgresql)"
    ;;
esac

rotate_backups
log "Backup completed successfully"
