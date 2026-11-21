#!/bin/sh
# Counts 5xx answers per orders-api host in today's logs.
for f in logs/orders-api/*.log; do
  printf '%s %s\n' "$(basename "$f" .log)" "$(grep -c ' status=5[0-9][0-9] ' "$f")"
done
