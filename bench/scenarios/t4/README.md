# T4: security, IAM and infrastructure tasks

Offline tasks: no cloud account, no network and no MCP server is needed to run or score them. IAM tasks are scored by
a small policy evaluator over the policy JSON the agent writes (`bench/scenarios/lib/hidden/iam-eval.js`, which each
task's hidden dir names in `.bench-lib.json`). Review and threat-model tasks are scored by a findings block the agent writes (`bench/scenarios/lib/hidden/findings.js`). Code
tasks are scored by hidden tests.

| Path | What |
| --- | --- |
| `t4-*.json` | the tasks (schema v3) |
| `fixtures/<id>/`, `hidden/<id>/hidden/`, `solutions/<id>/` | repository, hidden tests (overlaid on the repository root), reference overlay |
| `briefs/<id>.json` | the brief each author got: phase, role, kind, size, public source and licence |
| `edits/<id>.json` | every change made after the author's draft (prompt, checks, limits, review verdicts, mapping, expertKey), with a list of reasons |
| `lib/` | the tests of the IAM evaluator (the evaluator, the findings helper and the Python test bridge are in `bench/scenarios/lib/hidden`) |
| `scenario.config.js` | this batch's config for the shared tools in `bench/scenarios/lib`: the author prompt and the `seed` stage step |
| `prompts/` | author, review and mapping prompts |
| `lib/prompt.js`, `lib/stage.js seed` (shared, with this config) | render an author prompt from a brief; seed the author's empty folder with the hidden helpers |
| `assemble.js` | turns an author's folder plus `edits/<id>.json` into the task files |
| `lib/dry-run.js` (shared, with this config) | free dry run: reference at least 95, stub (untouched fixture) at most 20, same result over 3 repeats, a hung hidden test fails alone; lazy at most 40 and alternative at least 80 when `answers/<id>/` holds them |
| `AUTHORING-LOG.md` | every model call with its credits, and incidents |

Check a task without a model call:

```sh
TMPDIR=$(mktemp -d /tmp/t4.XXXXXX) node bench/scenarios/lib/dry-run.js --config bench/scenarios/t4/scenario.config.js t4-iam-ci-deploy-role
node --test bench/scenarios/t4/t4.test.js bench/scenarios/t4/lib/iam-eval.test.js
node bench/runner/bench.js scenarios lint bench/scenarios/t4 --base <konductor ref>
```

The evaluator follows the documented single-account logic (explicit deny, then allow, else implicit deny) with
conditions, policy variables and layered decisions (identity, resource, boundary, SCP). It is not a full IAM
implementation; an unknown condition operator throws, so a task never scores on a guess.
