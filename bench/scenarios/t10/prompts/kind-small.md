## What this task is: a small, clear change in a big repository (a control task)

This is a negative control: a SMALL, CLEAR request that a competent engineer finishes in a few minutes by reading the code around it. No design note, no rollout plan and no investigation is needed, and nothing in the work calls for a special method. It is still realistic: the repository is lived in, and the ask is something people really ask. The agent must change the right places and leave the rest alone.

## The fixture

Write `fixture/`: {{SIZE}} files. {{STACK}} It holds `package.json` (with a `test` script), `README.md`, `CHANGELOG.md`, `.github/workflows/ci.yml`, `docs/`, `config/`, `scripts/`, `src/` split into several modules, and `test/` with a passing suite of at least 25 tests that finishes in under 5 seconds with no network. Plant the traps listed in the brief (places the change must reach that a quick search misses, and look-alikes that must NOT change). Nothing may hint at them. No `.git` directory.

## The request and the hidden part

- `prompt` in `task-draft.json`: in the voice of {{VOICE}}, 60 to 150 words, one message. It says exactly what to change and why. It gives every name, path and value the hidden tests rely on. It names no method and does not list the places to change.
- `hidden/hidden-check.test.js` (laid over the repository root before it runs): 8 to 12 tests with node:test and node:assert of the result the request states (parse files instead of grepping where possible, call the real modules), plus 2 tests that nothing else changed (the look-alikes keep their old values; the public behaviour not mentioned is the same). Deterministic, no network, each under 2 seconds. At most 20% pass on the untouched fixture.
- `solution/`: the reference overlay (every changed or added file in full), including the updated visible tests and the CHANGELOG entry.
- `checks`: one `tests` check `{ "type": "tests", "cmd": "node --test --test-timeout=30000 hidden-check.test.js", "min": <number of tests>, "weight": 3, "kind": "substance" }`; one `cmd` check that the visible suite passes (`node --test`, weight 2); one `fixture_unchanged` check on a file the change must not touch (weight 1); optionally one `contains` check for the CHANGELOG entry that fails on the fixture. Every check passes on fixture plus solution plus hidden.
- `rubric`: `[]`. `limits`: `{ "softSec": 600, "hardSec": 1200 }`. `notes`: 3 to 5 sentences for the reviewer.
- `id`: `{{ID}}`.

## Finish

Write `kit/selfcheck.js`-compatible output: run `node kit/selfcheck.js` (it runs every `tests` check on fixture plus solution and on the plain fixture and prints the estimated score of each; the reference must estimate 95 or more and the plain fixture 20 or less). Fix what fails and run it again. Keep everything plain, original and free of internal names, real company names, host paths, usernames or secrets. Stop when the files are written and verified.
