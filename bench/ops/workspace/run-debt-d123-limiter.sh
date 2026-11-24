#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# gpt-5.6-luna makes t5-qa-flaky-fix's shared limiter a real order bug, then a deepseek-3.2 recheck (D-123).
# PAID with --go, free with --plan (the default); job and cap in debt-paid/jobs.txt, engine debt-paid/run.sh.
#   bash run-debt-d123-limiter.sh [--plan|--go]
exec bash "$(dirname "$0")/debt-paid/run.sh" D-123 "$@"
