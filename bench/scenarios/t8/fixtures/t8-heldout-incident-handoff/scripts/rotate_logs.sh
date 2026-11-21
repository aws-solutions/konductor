#!/bin/sh
# Old helper from the VM days; logs now ship to the log store.
for f in /var/log/ledgerly/*.log; do
  gzip -c "$f" > "$f.$(date +%F).gz" && : > "$f"
done
