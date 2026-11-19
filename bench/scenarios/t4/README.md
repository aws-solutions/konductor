# T4: security, IAM and infrastructure tasks

Offline tasks: no cloud account, no network and no MCP server is needed to run or score them. IAM tasks are scored by
a small policy evaluator over the policy JSON the agent writes (`lib/iam-eval.js`, copied into each task's hidden
directory). Review and threat-model tasks are scored by a findings block the agent writes (`lib/findings.js`). Code
tasks are scored by hidden tests.

| Path | What |
| --- | --- |
| `t4-*.json` | the tasks (schema v3) |
| `fixtures/<id>/`, `hidden/<id>/hidden/`, `solutions/<id>/` | repository, hidden tests (overlaid on the repository root), reference overlay |
| `briefs/<id>.json` | the brief each author got: phase, role, kind, size, public source and licence |
| `edits/<id>.json` | every change made after the author's draft (prompt, checks, limits, review verdicts, mapping, expertKey), with a list of reasons |
| `lib/` | the evaluator and its tests, the findings helper, the Python test bridge (same as T1) |
| `prompts/` | author, review and mapping prompts |
| `render-prompt.js` | renders an author prompt from a brief and seeds the author's empty folder with the hidden helpers |
| `assemble.js` | turns an author's folder plus `edits/<id>.json` into the task files |
| `dry-run.js` | free dry run: reference at least 95, stub (untouched fixture) at most 20, same result over 3 repeats |
| `AUTHORING-LOG.md` | every model call with its credits, and incidents |

Check a task without a model call:

```sh
TMPDIR=$(mktemp -d /tmp/t4.XXXXXX) node bench/scenarios/t4/dry-run.js t4-iam-ci-deploy-role
node --test bench/scenarios/t4/t4.test.js bench/scenarios/t4/lib/iam-eval.test.js
node bench/runner/bench.js scenarios lint bench/scenarios/t4 --base <konductor ref>
```

The evaluator follows the documented single-account logic (explicit deny, then allow, else implicit deny) with
conditions, policy variables and layered decisions (identity, resource, boundary, SCP). It is not a full IAM
implementation; an unknown condition operator throws, so a task never scores on a guess.
