# SPDX-License-Identifier: Apache-2.0
# The message helpers the ops scripts had copied (BACKLOG B-005). Sourced, never run. POSIX sh, as some scripts run
# under sh. A script one folder down sources it as `. "$(dirname "$0")/../lib.sh"`, before it calls any helper and
# before any `cd`. A script that needs another form (a log file, stderr, its own prefix) defines its own after the
# source line, and that one wins.

# say MSG...: MSG with the UTC hour and minute in front, on stdout.
say() { echo "[$(date -u +%H:%M)] $*"; }
# stop MSG...: say "STOP: MSG", then exit 1.
stop() { say "STOP: $*"; exit 1; }
# fail MSG...: "FAIL: MSG" on stdout, then exit 1 (the stub tests' failure line).
fail() { echo "FAIL: $*"; exit 1; }
