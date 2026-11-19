#!/bin/bash
# Backup script for the reporting service database

set -e

BACKUP_DIR="backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/reports_${TIMESTAMP}.db"

mkdir -p "$BACKUP_DIR"

echo "Backing up database to $BACKUP_FILE..."

if [ -f "data/reports.db" ]; then
    sqlite3 data/reports.db ".backup $BACKUP_FILE"
    echo "Backup completed successfully."
else
    echo "Error: Database file not found at data/reports.db"
    exit 1
fi

# Keep only the last 7 backups
echo "Cleaning up old backups..."
ls -t "$BACKUP_DIR"/reports_*.db | tail -n +8 | xargs -r rm

echo "Backup process completed."