# Skill regression tests

Standalone Bash regression tests for shell scripts under `skills/`. These
live here — outside `skills/<name>/tests/` — because every file under
`skills/<name>/` ships unconditionally into every installed AIM plugin
bundle with no exclusion mechanism; keeping test-only content here means it
never gets bundled into what end users install.

Each subdirectory mirrors the skill it tests (e.g. `mux-dispatch/` covers
`skills/mux-dispatch/`), to avoid filename collisions between skills that
happen to test the same concept (e.g. both `mux-dispatch` and
`cmux-dispatch` have a `test-registry-lock.sh`).

## What's covered here

| File                                            | Tests                                                                                                                                                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mux-dispatch/test-registry-lock.sh`            | `tmux-dispatch.sh` / `zellij-dispatch.sh`: concurrent dispatches never lose a `dispatched.json` registry entry.                                                                                                                                        |
| `mux-dispatch/test-close-pane-registry-lock.sh` | `mux-close-pane.sh`: concurrent pane closes race correctly against concurrent dispatches; a lock-open failure surfaces a distinct error instead of being misreported as "not found"/"registry is empty".                                               |
| `mux-dispatch/test-worktree-provision-cmd.sh`   | `tmux-dispatch.sh` / `zellij-dispatch.sh`: `WORKTREE_PROVISION_CMD` is forwarded intact into the dispatched pane, survives shell metacharacters, and is never forced into the launcher when unset.                                                     |
| `cmux-dispatch/test-registry-lock.sh`           | `cmux-dispatch.sh`: concurrent dispatches never lose a `dispatched.json` registry entry.                                                                                                                                                               |
| `cmux-dispatch/test-worktree-provision-cmd.sh`  | `cmux-dispatch.sh`: `WORKTREE_PROVISION_CMD` is forwarded intact into the dispatched surface, survives shell metacharacters, and is never forced into the pane command when unset.                                                                     |
| `cmux-dispatch/test-cwd-injection.sh`           | `cmux-dispatch.sh`: a malicious `--cwd` value cannot break out of the generated `PANE_CMD`'s quoting to inject arbitrary shell commands (CWE-78); a benign `--cwd` containing a space still changes directory correctly.                               |
| `persistent-memory/test-nonbullet-injection.sh` | `memory-validator.sh`: non-bullet-formatted lines (headings, paragraphs, blockquotes, numbered items) still run through every content check (instruction-like language, URL allowlist, code-block ban, length cap) instead of bypassing them (CWE-20). |

Each test is self-contained: it mocks the `tmux`/`zellij`/`cmux`/`kiro-cli`
binaries it needs, points the script under test at an isolated `mktemp`
registry directory (via the script's `KONDUCTOR_MUX_REGISTRY_DIR` /
`KONDUCTOR_CMUX_REGISTRY_DIR` env override — never the real, shared
`/tmp/konductor-mux` or `/tmp/konductor-cmux` production registry), and
cleans up its own temp directory on exit. `test-cwd-injection.sh` and
`test-nonbullet-injection.sh` follow the same self-contained pattern (mocked
binaries or an isolated throwaway git repo, respectively) but predate this
directory — they were relocated here from `skills/cmux-dispatch/tests/` and
`skills/persistent-memory/tests/` respectively, for the same
plugin-bundling reason as every other file here, with their script-under-test
paths updated to the three-levels-up `PKG_ROOT` convention below.

## Running

Prerequisites: `bash` (4+), `python3` (3.6+, stdlib only — no extra
packages). No build or install step; run any file directly:

```bash
bash tests/skills/mux-dispatch/test-registry-lock.sh
bash tests/skills/mux-dispatch/test-close-pane-registry-lock.sh
bash tests/skills/mux-dispatch/test-worktree-provision-cmd.sh
bash tests/skills/cmux-dispatch/test-registry-lock.sh
bash tests/skills/cmux-dispatch/test-worktree-provision-cmd.sh
bash tests/skills/cmux-dispatch/test-cwd-injection.sh
bash tests/skills/persistent-memory/test-nonbullet-injection.sh
```

Each script prints `PASS`/`FAIL` lines and a final `Results: N passed, M
failed` summary, exiting 0 only if every assertion passed. They can be run
from any working directory — each resolves its own package root and the
script under test relative to its own location, not the caller's `cwd`.

To run all of them:

```bash
for f in tests/skills/*/*.sh; do
  echo "=== $f ==="
  bash "$f" || echo "FAILED: $f"
done
```

Optional: run `shellcheck` over this directory before committing changes to
any test here:

```bash
shellcheck tests/skills/*/*.sh
```

## Adding a new test here

- Place it under `tests/skills/<skill-name>/`, matching the skill it covers.
- Resolve the script under test relative to the test file's own location
  (`$(dirname "${BASH_SOURCE[0]}")`), not the caller's `cwd` — see the
  existing tests for the pattern (`PKG_ROOT` computed from `SCRIPT_DIR`,
  then the target script referenced from `$PKG_ROOT/skills/...`).
- If the test needs to write files the real script also writes (e.g. a
  registry file, `.done` markers), point the script under test at an
  isolated temp directory via whatever env override it exposes for this —
  never the real, shared production path. Add the override to the script
  itself if one doesn't exist yet.
- Update this README's table with the new file and what it covers.
