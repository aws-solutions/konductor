# Skill regression tests

Standalone Bash regression tests for shell scripts under `skills/`. These
live here, outside `skills/<name>/tests/`, because the installer copies each
`skills/<name>/` directory as a whole, with no way to exclude files; keeping
test-only content here means it never gets installed with the skill.

Each subdirectory mirrors the skill it tests (e.g. `persistent-memory/`
covers `skills/persistent-memory/`), to avoid filename collisions between
skills that happen to test the same concept.

## What's covered here

| File                                            | Tests                                                                                                                                                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `persistent-memory/test-nonbullet-injection.sh` | `memory-validator.sh`: non-bullet-formatted lines (headings, paragraphs, blockquotes, numbered items) still run through every content check (instruction-like language, URL allowlist, code-block ban, length cap) instead of bypassing them (CWE-20). |

Each test is self-contained: it mocks the binaries it needs or works in an
isolated throwaway git repository, and cleans up its own temp directory on
exit. `test-nonbullet-injection.sh` was relocated here from
`skills/persistent-memory/tests/` for the packaging reason above, with
its script-under-test path updated to the three-levels-up `PKG_ROOT`
convention below.

## Running

Prerequisites: `bash` (4+) and `bun`. No build or install step; run any
file directly:

```bash
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
- If the test needs to write files the real script also writes, point the
  script under test at an isolated temp directory via whatever env override it exposes for this —
  never the real, shared production path. Add the override to the script
  itself if one doesn't exist yet.
- Update this README's table with the new file and what it covers.
