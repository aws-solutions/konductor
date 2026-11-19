#!/bin/sh
set -eu
for region in noria solmere kestrel veyra; do
  printf '%s\t%s\n' "$region" "$(date -u +%FT%TZ)"
done
