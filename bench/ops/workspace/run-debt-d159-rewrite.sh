#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# qwen3-coder-next rewrites t3-db-order-history and its key, then a gpt-5.6-luna recheck (D-159).
# PAID with --go, free with --plan (the default); job and cap in debt-paid/jobs.txt, engine debt-paid/run.sh.
#   bash run-debt-d159-rewrite.sh [--plan|--go]
exec bash "$(dirname "$0")/debt-paid/run.sh" D-159 "$@"
