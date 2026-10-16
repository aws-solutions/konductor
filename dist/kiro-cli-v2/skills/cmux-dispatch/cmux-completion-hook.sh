#!/bin/bash
# SPDX-License-Identifier: Apache-2.0
# cmux-completion-hook.sh — Signals task completion to the cmux orchestrator.
# Called by kiro-cli on the "stop" event with JSON piped to stdin.
# NOTE: Does NOT send cmux notify — an external notification tool handles notifications if installed.

INPUT=$(cat)

EVENT=$(printf '%s' "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('hook_event_name',''))" 2>/dev/null)
[ "$EVENT" != "stop" ] && exit 0
[ -z "$ASDLC_DONE_KEY" ] && [ -z "$CMUX_WORKSPACE_ID" ] && exit 0

mkdir -p /tmp/konductor-cmux
printf '%s' "$INPUT" | python3 -c "
import sys, json, os
data = json.load(sys.stdin)
key = os.environ.get('ASDLC_DONE_KEY') or os.environ.get('CMUX_WORKSPACE_ID')
status = 'error' if data.get('exit_code') not in (None, 0) else 'done'
result = {'workspace_id': os.environ.get('CMUX_WORKSPACE_ID', key), 'status': status, 'summary': (data.get('assistant_response') or '')[:200]}
with open(f'/tmp/konductor-cmux/{key}.done', 'w') as f:
    json.dump(result, f)
" 2>/dev/null || {
  python3 -c "
import json, os
key = os.environ.get('ASDLC_DONE_KEY') or os.environ.get('CMUX_WORKSPACE_ID')
json.dump({'workspace_id': os.environ.get('CMUX_WORKSPACE_ID', key), 'status': 'error', 'summary': 'hook failed'}, open(f'/tmp/konductor-cmux/{key}.done', 'w'))
"
}
