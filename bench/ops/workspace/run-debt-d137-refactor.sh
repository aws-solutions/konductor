#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# deepseek-3.2 writes the two T1 refactor tasks again from their briefs, each with a glm-5 recheck (D-137).
# PAID with --go, free with --plan (the default); job and cap in debt-paid/jobs.txt, engine debt-paid/run.sh.
#   bash run-debt-d137-refactor.sh [--plan|--go]
exec bash "$(dirname "$0")/debt-paid/run.sh" D-137 "$@"
