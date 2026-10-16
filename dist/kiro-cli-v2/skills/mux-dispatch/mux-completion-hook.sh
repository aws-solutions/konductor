#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# mux-completion-hook.sh — Signals task completion to the mux orchestrator.
# Called by kiro-cli on the "stop" event with JSON piped to stdin.
# Works with tmux and zellij backends (reads MUX_WORKSPACE_ID env var).

INPUT=$(cat)

EVENT=$(printf '%s' "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('hook_event_name',''))" 2>/dev/null)
[ "$EVENT" != "stop" ] && exit 0
[ -z "$MUX_WORKSPACE_ID" ] && exit 0

mkdir -p /tmp/konductor-mux
printf '%s' "$INPUT" | python3 -c "
import sys, json, os
data = json.load(sys.stdin)
ws = os.environ['MUX_WORKSPACE_ID']
status = 'error' if data.get('exit_code') not in (None, 0) else 'done'
result = {'workspace_id': ws, 'status': status, 'summary': (data.get('assistant_response') or '')[:200]}
with open(f'/tmp/konductor-mux/{ws}.done', 'w') as f:
    json.dump(result, f)
" 2>/dev/null || {
  python3 -c "
import json, os
ws = os.environ['MUX_WORKSPACE_ID']
json.dump({'workspace_id': ws, 'status': 'error', 'summary': 'hook failed'}, open(f'/tmp/konductor-mux/{ws}.done', 'w'))
"
}
