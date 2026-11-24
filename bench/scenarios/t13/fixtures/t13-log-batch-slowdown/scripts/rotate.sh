#!/bin/sh
set -eu
# Keep the local diagnostics directory bounded during manual investigations.
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
printf 'logs available under %s\n' "$root/logs"
