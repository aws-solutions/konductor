#!/bin/sh
# Retained for reproducing a retired dashboard export.
awk -F, 'NR > 1 { total += $3; slow += $10 } END { print slow / total }' data/request-minute.csv
