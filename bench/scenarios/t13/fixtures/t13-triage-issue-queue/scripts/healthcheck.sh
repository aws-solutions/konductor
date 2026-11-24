#!/bin/sh
set -eu
endpoint=${1:-http://127.0.0.1:8080/health}
printf 'checking %s\n' "$endpoint"
curl -fsS --max-time 3 "$endpoint" >/dev/null
printf 'healthy\n'
