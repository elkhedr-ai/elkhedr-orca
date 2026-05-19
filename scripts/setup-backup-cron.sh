#!/usr/bin/env bash
# ============================================================
# Setup Automated Backup Cron Job
# Installs a daily backup cron for Orca database.
# Usage: ./scripts/setup-backup-cron.sh [--schedule "0 3 * * *"]
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_SCHEDULE="${ORCA_BACKUP_SCHEDULE:-0 3 * * *}"
CRON_TAG="# orca-backup"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# Build the cron line — load env from .production if present
CRON_CMD="cd $PROJECT_DIR"
if [ -f "$PROJECT_DIR/.env.production" ]; then
  CRON_CMD="$CRON_CMD && set -a && . $PROJECT_DIR/.env.production && set +a"
fi
CRON_CMD="$CRON_CMD && $SCRIPT_DIR/backup.sh >> $PROJECT_DIR/logs/backup.log 2>&1 $CRON_TAG"

# Parse args
while [ $# -gt 0 ]; do
  case "$1" in
    --schedule) BACKUP_SCHEDULE="$2"; shift 2 ;;
    --uninstall)
      log "Removing Orca backup cron entry..."
      crontab -l 2>/dev/null | grep -v "$CRON_TAG" | crontab -
      log "Backup cron removed."
      exit 0
      ;;
    -h|--help)
      echo "Usage: $0 [--schedule \"0 3 * * *\"] [--uninstall]"
      echo ""
      echo "Options:"
      echo "  --schedule CRON   Cron expression (default: daily at 3 AM)"
      echo "  --uninstall       Remove the backup cron entry"
      exit 0
      ;;
    *) shift ;;
  esac
done

# Ensure logs dir exists
mkdir -p "$PROJECT_DIR/logs"

# Remove existing entry if present, then add new one
EXISTING=$(crontab -l 2>/dev/null | grep -v "$CRON_TAG" || true)
NEW_CRON="$EXISTING
$BACKUP_SCHEDULE $CRON_CMD"

# Install
echo "$NEW_CRON" | crontab -
log "Backup cron installed: $BACKUP_SCHEDULE"
log "Logs: $PROJECT_DIR/logs/backup.log"
log "To remove: $0 --uninstall"
