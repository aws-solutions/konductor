#!/bin/sh
set -eu
awk -F, 'NR > 1 { count[$1]++ } END { for (name in count) print count[name], name }' history/alert-firings.csv | sort -nr
