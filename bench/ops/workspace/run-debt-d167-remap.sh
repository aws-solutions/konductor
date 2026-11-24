#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# glm-5 re-map of the 12 coverage-gap stage 1 tasks from the filled catalogue (D-167).
# PAID with --go, free with --plan (the default); job and cap in debt-paid/jobs.txt, engine debt-paid/run.sh.
#   bash run-debt-d167-remap.sh [--plan|--go]
exec bash "$(dirname "$0")/debt-paid/run.sh" D-167 "$@"
