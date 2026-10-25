# Runtime Hook Behavior

This page records what Claude Code and Kiro CLI (v2 and v3 engines) send to a pre-tool hook, which
hook results block the tool call, and the order hook events fire for one prompt. Every statement
comes from a real run. The redacted runs are in
[`tests/fixtures/runtime-hooks/`](../../tests/fixtures/runtime-hooks/), one file per runtime and
experiment, and each file's `observed` block holds the values this page reports. Fixture strings
are normalized, so they are not verbatim: dashes become hyphens, ids and local paths become
placeholders, and long text is cut at 200 characters with a `...<truncated>` marker.

## Runs

| Runtime | Version | Engine | Session model | Date |
| --- | --- | --- | --- | --- |
| Claude Code | 2.1.308 | n/a | `claude-opus-5` | 2026-10-25 |
| Kiro CLI | 2.34.0 | v2 (`--v2`) | `auto` | 2026-10-25 |
| Kiro CLI | 2.34.0 | v3 (`--v3`) | `auto` | 2026-10-25 |

The operator recorded the model. For Claude Code it matches the stream: assistant messages report
`claude-opus-5` and the init event reports `claude-opus-5[1m]`. For Kiro CLI it matches the
session store.

Five experiments per runtime, two runs each (30 runs). Rep 1 is committed. A later rerun added one
more run per experiment on the same versions (rep 3, 15 runs). Reps 2 and 3 matched rep 1 on every
blocking verdict, every payload field set and every event order, except one Kiro CLI v2 exit 2 run
where the model made an extra tool call. The answer the model wrote varied between runs, so
[Blocking](#blocking) gives answer wording as a count over all three reps.

The pre-tool hook ran `hook_probe.py` in one of these modes, with matcher `*` (every tool):

| Experiment | Hook mode | Prompt |
| --- | --- | --- |
| `log-only` | log, exit 0 | Read probe.txt and reply with its first line only. |
| `exit-1` | `hook-probe: blocked (exit 1)` on stderr, exit 1 | same |
| `exit-2` | `hook-probe: blocked (exit 2)` on stderr, exit 2 | same |
| `deny-output` | JSON `permissionDecision: deny` on stdout, exit 0 | same |
| `ordering` | log, exit 0 | Read probe.txt, then read other.txt, then reply DONE. |

`probe.txt` starts with the line `SENTINEL-7Q4`. A call counts as blocked when at least one
pre-tool event fired, no post-tool event fired, and the sentinel is in neither the answer nor the
runtime's stdout. A call counts as not blocked when the sentinel is in the answer. Anything else is
`unclear` (no run here was), and `ordering` runs are `not-tested`. On Kiro CLI v2 stdout is the
answer, so the v2 verdict rests on the answer and the post-tool count.

## Blocking

| Result of the pre-tool hook | Claude Code | Kiro CLI v2 | Kiro CLI v3 |
| --- | --- | --- | --- |
| Exit 1 | not blocked | not blocked | not blocked |
| Exit 2 | blocked | blocked | blocked |
| Claude Code style JSON deny on stdout, exit 0 | blocked | not blocked | not blocked |
| Post-tool event after a blocked call | no | no | no |

What the runtime returned after a block (`observed.failed_tool_results` in each fixture), and what
the model then wrote (`answer`). The runtime part held in every run. The answer part depends on the
model, so it is a count over reps 1 to 3.

- Claude Code, exit 2. Runtime: the call is blocked, no post-tool event fires, and the tool result
  is the error `PreToolUse:Read hook error: [<hook command>]: hook-probe: blocked (exit 2)`. Model:
  the answer quoted the stderr text in 3 of 3 runs.
- Claude Code, JSON deny. Runtime: the call is blocked, no post-tool event fires, and the tool
  result is the error `PreToolUse:Read hook error: <reason>` (here `hook-probe deny`). Model: the
  answer quoted the reason in 2 of 3 runs. In the third it said the hook denied the call without
  quoting the reason.
- Kiro CLI v2, exit 2. Runtime: the call is blocked and no post-tool event fires. Stdout is plain
  text, so there is no separate tool result to inspect. Model: the answer quoted
  `hook-probe: blocked` in 2 of 3 runs. In the third it wrote `hook-probe: exit 2` and tried a
  second tool (`glob`), which was blocked too (two pre-tool events, no post-tool event).
- Kiro CLI v3, exit 2. Runtime: the call is blocked, no post-tool event fires, the stream reports
  the tool call as `failed` with no content, and no hook stderr text appears on stdout. Model: the
  answer named the hook and exit code 2 without quoting the stderr text in 3 of 3 runs.
- Exit 1 on all three runtimes. Runtime: the call ran, the post-tool event fired, and the stderr
  text appeared in neither the runtime's stdout nor its stderr (9 of 9 runs). The answer was the
  sentinel line in every run.

## Pre-tool payload

| Field | Claude Code | Kiro CLI v2 | Kiro CLI v3 |
| --- | --- | --- | --- |
| `hook_event_name` | `PreToolUse` | `preToolUse` | `PreToolUse` |
| `tool_name` (file read) | `Read` | `read` | `read_file` |
| `tool_input` | `{"file_path": "<absolute path>"}` | `{"__tool_use_purpose", "operations": [{"mode", "path", "limit"}]}`, path relative | `{"path", "offset", "limit"}`, path absolute or relative as the model wrote it |
| `cwd` | yes | yes | yes |
| `session_id` | yes | yes | yes |
| `transcript_path` | yes | no | no |
| `tool_use_id` | yes | no | no |
| `prompt_id` | yes | no | no |
| `permission_mode` | yes (`bypassPermissions`) | no | no |
| `effort` | yes (`{"level": "high"}`) | no | no |
| `tool_tags` | no | yes (`["read", "@builtin"]`) | no |
| Agent name | no | no | no |

Other events:

- Claude Code: `SessionStart` adds `source` (`startup`). `PostToolUse` adds `tool_response` and
  `duration_ms`. `Stop` adds `last_assistant_message`, `stop_hook_active`, `background_tasks` and
  `session_crons`.
- Kiro CLI v2: `userPromptSubmit` adds `prompt`. `postToolUse` adds `tool_response`. `stop` adds
  `assistant_response`.
- Kiro CLI v3: `UserPromptSubmit` adds `prompt`. `PostToolUse` adds `tool_response`. `SessionStart`
  and `Stop` carry only `cwd`, `hook_event_name` and `session_id`.

Environment variable names starting with `CLAUDE_` or `KIRO_` seen by the hook (names only; values
were not recorded). `CLAUDE_CONFIG_DIR`,
`CLAUDE_CODE_USE_BEDROCK` and `KIRO_HOME` were set by the test setup, not by the runtime.

- Claude Code: `CLAUDE_PROJECT_DIR`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_PID`, `CLAUDE_EFFORT`,
  `CLAUDE_ENV_FILE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_CHILD_SESSION`,
  `CLAUDE_CODE_SESSION_ATTENDED`, `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`.
- Kiro CLI v2: `KIRO_SESSION_ID`, `KIRO_CLI_PATH`, `KIRO_CLI_ACP_CLIENT_NAME`,
  `KIRO_CLI_IS_CHILD_PROCESS`.
- Kiro CLI v3: `KIRO_SESSION_ID`, `KIRO_CLI_PATH`, `KIRO_CONTENT_COLLECTION_ENABLED`,
  `KIRO_CUSTOM_USER_AGENT`, `KIRO_REMOTE_SESSIONS_ENDPOINT`, plus two names outside this list,
  which the fixtures collapse into one `<OTHER_ENV_KEY>` entry.

## Event order for one prompt

From the `ordering` experiment (two file reads):

- Claude Code: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreToolUse`,
  `PostToolUse`, `Stop`.
- Kiro CLI v2: `userPromptSubmit`, `preToolUse`, `postToolUse`, `stop`. The model read both files
  in one `read` call with two `operations` (3 of 3 runs), so there is one pre/post pair.
  `agentSpawn` did not fire in any of the 15 non-interactive v2 runs.
- Kiro CLI v3: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreToolUse`,
  `PostToolUse`, `Stop`.

## Hook config used

Templates are in [`tools/hook-probe/configs/`](../../tools/hook-probe/configs/). `{{PROBE}}` is the
path to `hook_probe.py` and `{{MODE}}` is the pre-tool mode.

- Claude Code: project `.claude/settings.json`, a `hooks` map keyed by `SessionStart`,
  `UserPromptSubmit`, `PreToolUse`, `PostToolUse` and `Stop`.

  ```json
  {"PreToolUse": [{"matcher": "*", "hooks": [{"type": "command", "command": "python3 {{PROBE}} {{MODE}} PreToolUse"}]}]}
  ```

- Kiro CLI v2: an agent file at `.kiro/agents/hook-probe.json` with `mcpServers: {}` and a `hooks`
  map keyed by `agentSpawn`, `userPromptSubmit`, `preToolUse`, `postToolUse` and `stop`.

  ```json
  {"preToolUse": [{"command": "python3 {{PROBE}} {{MODE}} preToolUse", "matcher": "*"}]}
  ```

- Kiro CLI v3: `.kiro/hooks/hook-probe.json`, no agent file.

  ```json
  {"version": "v1", "hooks": [{"name": "hook-probe-PreToolUse", "trigger": "PreToolUse", "matcher": "*",
    "action": {"type": "command", "command": "python3 {{PROBE}} {{MODE}} PreToolUse"}, "timeout": 10, "enabled": true}]}
  ```

## How to reproduce

Run this only in a throwaway directory. The flags below let the model run any tool without asking,
and the raw hook log holds full prompts and tool output, unredacted. Never commit the raw log.

1. Make a fresh project directory with `probe.txt` (first line `SENTINEL-7Q4`) and `other.txt`
   (first line `OTHER-3K8`).
2. Copy `tools/hook-probe/hook_probe.py` somewhere outside the project, on a path without spaces
   (the templates do not quote it), and fill the runtime's template from
   `tools/hook-probe/configs/` with its path and the mode.
3. Point the runtime at an empty config directory so no user hooks, agents or MCP servers load:
   `CLAUDE_CONFIG_DIR` for Claude Code (with only your auth and model settings), `KIRO_HOME` for
   Kiro CLI. Set `HOOK_PROBE_LOG` to the log file path. The macOS runs here also used
   `sandbox-exec` to deny reads of the real home config directories, and an `env -i` environment
   for Kiro CLI.
4. Before and after the run, list the config directory and the project's `.claude` or `.kiro`
   tree, and confirm that no MCP servers or agents beyond the probe loaded. Launch the runtime
   binary directly, not through a wrapper that may add its own config.
5. Run from the project directory, with stdout and stderr captured to separate files:
   - Claude Code: `claude -p "<prompt>" --output-format stream-json --verbose --permission-mode bypassPermissions`
   - Kiro CLI v2: `kiro-cli chat --v2 --agent hook-probe --no-interactive --trust-all-tools "<prompt>"`
   - Kiro CLI v3: `kiro-cli chat --v3 --trust-workspace --output-format stream-json --no-interactive --trust-all-tools "<prompt>"`
6. Redact: `tools/hook-probe/redact.py <log> <stdout> <out.json> --stderr <stderr> --runtime ... --sandbox-root <dir>`
   (see `--help`). Without `--stderr`, `block_message_in_stderr` is always false. It replaces local
   paths, the login name, the host name, ids and tokens with placeholders, and exits 1 without
   writing if anything local, an email, a URL or a cloud access key id is left.

Pass `--trust-workspace` on Kiro CLI v3. Its help says project hooks load without the trust prompt
only with that flag. These runs did not test v3 without it.

## Limits

- One model per runtime, non-interactive mode only. Interactive sessions may differ, for example
  in whether Kiro CLI v2 fires `agentSpawn`.
- The probe used file reads. Other tools may send different `tool_input` shapes.
- On Kiro CLI 2.34.0 with `--v2`, an agent file that also set `includeMcpJson` or
  `useLegacyMcpJson` failed to load (`Mode 'hook-probe' not found`), so the probe agent omits them.
- Results hold for the versions above. Rerun the probe after a runtime upgrade before relying on
  them.
