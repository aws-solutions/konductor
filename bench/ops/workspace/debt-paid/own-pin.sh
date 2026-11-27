# SPDX-License-Identifier: Apache-2.0
# Sourced by a job wrapper whose job reads tasks from its own checkout. own_pin JOB DIR: sets PIN_REPO to DIR (unless the
# caller set PIN_REPO itself, the test hook, which is never moved), and moves an existing DIR to the branch head while
# the job has spent nothing (no ledger) and DIR is clean, so a job not yet started reads the pushed task versions.
# run.sh adds DIR on the first run when it is missing.
own_pin() {
  local job=$1 dir=$2 move=${PIN_REPO:+0}
  export PIN_REPO=${PIN_REPO:-$dir}
  if [ "${move:-1}" = 1 ] && [ -e "$PIN_REPO/.git" ] && [ ! -s "${ROOT:-$KONDUCTOR_WS/reports/debt-paid/$job}/ledger" ] && [ -z "$(git -C "$PIN_REPO" status --porcelain)" ]; then
    git -C "$PIN_REPO" fetch -q origin feat/bench-pilot-nk && git -C "$PIN_REPO" checkout -q --detach FETCH_HEAD
  fi
}
