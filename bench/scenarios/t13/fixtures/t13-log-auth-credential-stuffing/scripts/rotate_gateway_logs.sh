#!/bin/sh
set -eu
# The host timer owns compression and retention.
for file in logs/gw-*.jsonl; do
  test -s "$file" || exit 1
done
printf '%s\n' 'gateway log inputs present'
