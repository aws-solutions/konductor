#!/bin/sh
set -eu
printf '%s cache health snapshot\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '%s\n' 'check cache nodes, replica lag, and API error rate'
