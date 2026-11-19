#!/bin/sh
set -eu
find ops/logs -type f -name '*.log' -size +64M -print
