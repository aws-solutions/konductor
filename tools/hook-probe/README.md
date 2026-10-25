# hook-probe

Two scripts for recording what Claude Code and Kiro CLI send to their hooks, and for turning a raw
run into a fixture that is safe to commit.

- `hook_probe.py <mode> <event-label>` is the hook. It appends one JSON line per call to the file
  named by `HOOK_PROBE_LOG`. It records env var names that start with `CLAUDE_` or `KIRO_`, never
  their values. On a pre-tool event the mode decides the result: `log` (exit 0), `exit1`, `exit2`
  (message on stderr) or `deny` (Claude Code style JSON deny on stdout, exit 0).
- `redact.py` reads the hook log and the runtime's stdout and stderr, and writes one fixture with
  local paths, the login name, the host name, ids and tokens replaced by placeholders. It exits 1
  and writes nothing if anything local, an email, a URL or a cloud access key id is left.
- `configs/` holds the hook config templates. `{{PROBE}}` is the path to `hook_probe.py` and
  `{{MODE}}` is the pre-tool mode.

## Running a capture

Run this only in a throwaway directory. The runtime flags used for a capture let the model run any
tool without asking, and the raw hook log holds full prompts and tool output, unredacted. Never
commit the raw log.

1. Copy `hook_probe.py` outside the project, on a path without spaces (the templates do not quote
   it), and fill the runtime's template with its path and the mode.
2. Point the runtime at an empty config directory (`CLAUDE_CONFIG_DIR` or `KIRO_HOME`) and set
   `HOOK_PROBE_LOG`.
3. Before and after the run, list the config directory and the project's `.claude` or `.kiro`
   tree, and confirm that no MCP servers or agents beyond the probe loaded. Launch the runtime
   binary directly, not through a wrapper that may add its own config.
4. Capture the runtime's stdout and stderr to separate files.
5. Redact on the same host that ran the capture:

   ```sh
   tools/hook-probe/redact.py <log> <stdout> <out.json> --stderr <stderr> --runtime ... --sandbox-root <dir>
   ```

   See `--help` for the other required flags. Without `--stderr`, `block_message_in_stderr` is
   always false.

Tests: `python3 -m pytest -q tests/test_hook_probe.py`.
