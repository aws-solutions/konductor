#!/bin/bash
# Deletes build artifacts older than N days and rotates the deploy log.
DAYS=$1
cd /var/app/builds
rm -rf $(find . -mtime +$DAYS)
mv deploy.log deploy.log.1
touch deploy.log
echo "cleanup done"
