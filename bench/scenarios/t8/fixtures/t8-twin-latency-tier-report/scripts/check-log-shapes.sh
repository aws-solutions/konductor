#!/bin/sh
# Small helper for a quick local sanity check of the day files.
set -eu
for file in logs/checkout-api.log logs/payments-adapter.log logs/inventory-service.log logs/pooler.log; do
  printf '%s: ' "$file"
  wc -l < "$file"
done
