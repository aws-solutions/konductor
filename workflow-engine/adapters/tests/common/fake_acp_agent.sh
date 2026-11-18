#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
#
# A scripted ACP v1 agent for tests. It reads newline-delimited JSON-RPC from standard input and answers on standard
# output, and it ships nowhere. The case is chosen by FAKE_ACP_CASE:
#
#   normal          initialize, session/new, an update stream, a result line, end_turn
#   perm            a permission request for FAKE_ACP_TOOL; FAKE_ACP_OPTIONS=all (default) or always-only
#   chatty          never answers session/prompt and sends message chunks without end
#   hang            never answers session/prompt, and ignores session/cancel
#   waits-for-cancel never answers session/prompt until session/cancel arrives, then answers `cancelled`
#   big-text        2 MiB of message text, then the result line
#   big-frame       a frame over 4 MiB
#   early-exit      exits with status 3 (or FAKE_ACP_EXIT) before it answers initialize
#   exit-in-prompt  exits with status 5 while it works on the prompt
#   v2-only         answers initialize with protocol version 2
#   wrong-id        answers initialize with an id that was not asked
#   not-json        answers initialize with text that is not JSON
#   mode-stuck      claude only: keeps mode auto when asked for default
#   wrong-agent     reports another agent than the one asked for
#
# FAKE_ACP_LOG names a file that the arguments (as an `ARGS` line) and every received line are appended to. FAKE_ACP_ENV_FILE names a file that gets the
# names of the environment variables the agent was started with. FAKE_ACP_FLAVOR is `claude` or `kiro`, and by default
# the name of this program decides it. FAKE_ACP_WRITE names a file to create in the working folder on session/prompt.
# FAKE_ACP_STDERR is a line that the agent writes to its standard error at the start, and FAKE_ACP_STDERR_BULK makes it
# write 400 numbered lines.
# FAKE_ACP_REMOVE names a file in the working folder that is deleted on session/prompt.
# FAKE_ACP_REWRITE names a file in the working folder that gets a line appended on session/prompt, as an adapter that
# rewrites its agent file would.

case_="${FAKE_ACP_CASE:-normal}"
tool="${FAKE_ACP_TOOL:-Write}"
log="${FAKE_ACP_LOG:-/dev/null}"
flavor="${FAKE_ACP_FLAVOR:-}"
if [ -z "$flavor" ]; then
  case "$(basename "$0")" in
    kiro-cli*) flavor=kiro ;;
    *) flavor=claude ;;
  esac
fi
printf 'ARGS %s\n' "$*" >> "$log"
[ -n "${FAKE_ACP_STDERR:-}" ] && printf '%s\n' "$FAKE_ACP_STDERR" >&2
if [ -n "${FAKE_ACP_STDERR_BULK:-}" ]; then
  i=0
  while [ "$i" -lt 400 ]; do
    printf 'noise line %s xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\n' "$i" >&2
    i=$((i + 1))
  done
fi
if [ -n "${FAKE_ACP_ENV_FILE:-}" ]; then
  env | cut -d= -f1 | sort > "$FAKE_ACP_ENV_FILE"
fi

result='KONDUCTOR_RESULT {\"status\": \"success\", \"outputs\": [\"PLAN.md\"]}'
agent=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--agent" ]; then agent="$a"; fi
  prev="$a"
done
prompt_id=""

say() { printf '%s\n' "$1"; }

update() {
  say '{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":'"$1"'}}'
}

chunk() {
  update '{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"'"$1"'"}}'
}

finish() {
  say '{"jsonrpc":"2.0","id":'"$1"',"result":{"stopReason":"'"$2"'"}}'
}

while IFS= read -r line; do
  printf '%s\n' "$line" >> "$log"
  id=$(printf '%s' "$line" | sed -n 's/^{"id":\([0-9][0-9]*\),.*/\1/p')
  method=$(printf '%s' "$line" | sed -n 's/^{.*"method":"\([^"]*\)".*/\1/p')
  case "$method" in
    initialize)
      case "$case_" in
        early-exit) exit "${FAKE_ACP_EXIT:-3}" ;;
        v2-only) say '{"jsonrpc":"2.0","id":'"$id"',"result":{"protocolVersion":2}}' ;;
        wrong-id) say '{"jsonrpc":"2.0","id":99,"result":{"protocolVersion":1}}' ;;
        not-json) say 'this is not json' ;;
        *) say '{"jsonrpc":"2.0","id":'"$id"',"result":{"protocolVersion":1,"agentInfo":{"name":"fake-acp","version":"0.0.0"}}}' ;;
      esac
      ;;
    session/new)
      if [ "$flavor" = claude ]; then
        agent=$(printf '%s' "$line" | sed -n 's/.*"agent":"\([^"]*\)".*/\1/p')
      elif [ -z "$agent" ]; then
        agent=$(printf '%s' "$line" | sed -n 's/.*"modeId":"\([^"]*\)".*/\1/p')
      fi
      [ "$case_" = wrong-agent ] && agent="some-default-agent"
      if [ "$flavor" = claude ]; then
        say '{"jsonrpc":"2.0","id":'"$id"',"result":{"sessionId":"s1","configOptions":[{"id":"mode","currentValue":"auto"},{"id":"agent","currentValue":"'"$agent"'"}]}}'
      else
        say '{"jsonrpc":"2.0","id":'"$id"',"result":{"sessionId":"s1","modes":{"currentModeId":"'"$agent"'"}}}'
      fi
      ;;
    session/set_config_option)
      mode=default
      [ "$case_" = mode-stuck ] && mode=auto
      say '{"jsonrpc":"2.0","id":'"$id"',"result":{"configOptions":[{"id":"mode","currentValue":"'"$mode"'"}]}}'
      ;;
    session/cancel)
      if [ "$case_" = waits-for-cancel ] && [ -n "$prompt_id" ]; then
        finish "$prompt_id" cancelled
      fi
      ;;
    session/prompt)
      prompt_id="$id"
      [ -n "${FAKE_ACP_WRITE:-}" ] && printf 'written by the fake agent\n' > "$FAKE_ACP_WRITE"
      [ -n "${FAKE_ACP_REWRITE:-}" ] && printf '\n' >> "$FAKE_ACP_REWRITE"
      [ -n "${FAKE_ACP_REMOVE:-}" ] && rm -f "$FAKE_ACP_REMOVE"
      update '{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"HIDDEN-THOUGHT"}}'
      update '{"sessionUpdate":"usage_update","used":1,"size":2}'
      say '{"jsonrpc":"2.0","method":"_vendor/status","params":{"x":1}}'
      case "$case_" in
        hang)
          chunk 'started. '
          sleep 300
          ;;
        chatty)
          while :; do chunk 'talking. '; done
          ;;
        waits-for-cancel)
          chunk 'started. '
          ;;
        exit-in-prompt)
          chunk 'started. '
          exit 5
          ;;
        big-frame)
          head -c 4300000 /dev/zero | tr '\0' 'a'
          echo
          ;;
        big-text)
          big=$(head -c 600000 /dev/zero | tr '\0' 'a')
          for n in 1 2 3 4; do chunk "$big"; done
          chunk "\\n$result"
          finish "$id" end_turn
          ;;
        perm)
          if [ "${FAKE_ACP_OPTIONS:-all}" = always-only ]; then
            options='[{"optionId":"allow-always","name":"Always","kind":"allow_always"},{"optionId":"reject","name":"No","kind":"reject_once"}]'
          else
            options='[{"optionId":"allow-once","name":"Yes","kind":"allow_once"},{"optionId":"allow-always","name":"Always","kind":"allow_always"},{"optionId":"reject","name":"No","kind":"reject_once"}]'
          fi
          if [ "$flavor" = kiro ]; then
            say '{"jsonrpc":"2.0","id":7,"method":"session/request_permission","params":{"sessionId":"s1","_meta":{"kiro":{"toolId":"'"$tool"'","consent":{"capability":"'"$tool"'"}}},"toolCall":{"toolCallId":"t1","title":"Using a tool"},"options":'"$options"'}}'
          else
            say '{"jsonrpc":"2.0","id":7,"method":"session/request_permission","params":{"sessionId":"s1","toolCall":{"toolCallId":"t1","name":"'"$tool"'","title":"Using a tool"},"options":'"$options"'}}'
          fi
          IFS= read -r answer
          printf '%s\n' "$answer" >> "$log"
          case "$answer" in
            *'"optionId":"allow-once"'*) chunk 'ALLOWED\n' ;;
            *) chunk 'REFUSED\n' ;;
          esac
          chunk "$result"
          finish "$id" end_turn
          ;;
        *)
          chunk 'Plan written.\n'
          chunk "$result"
          finish "$id" end_turn
          ;;
      esac
      ;;
  esac
done
