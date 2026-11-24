#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# glm-5 map of the two CV-E held-out T8 tasks (D-132).
# PAID with --go, free with --plan (the default); job and cap in debt-paid/jobs.txt, engine debt-paid/run.sh.
#   bash run-debt-d132-map.sh [--plan|--go]
exec bash "$(dirname "$0")/debt-paid/run.sh" D-132 "$@"
