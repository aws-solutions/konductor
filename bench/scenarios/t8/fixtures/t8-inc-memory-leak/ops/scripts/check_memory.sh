#!/bin/sh
set -eu
for f in ops/metrics/container-*.csv; do
  awk -F, 'NR == 1 { next } $4 > 1900 { print f ":" NR ":" $4 " MiB" }' f="$f" "$f"
done
