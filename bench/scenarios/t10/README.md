# T10: long multi-phase tasks (idea to ship)

Each task is one request that spans phases: a short product ask, a design note, the feature built in a 50+ file
repository with tests and CI, a rollout plan and a release note. Wave 1 landed 4 of 8 briefs; see `AUTHORING-LOG.md`
for every call and `HAND-EDITS.md` for edits by anyone other than the author.

| Path | What |
| --- | --- |
| `t10-*.json` | the task files (schema v3) |
| `fixtures/<id>/`, `hidden/<id>/`, `solutions/<id>/`, `answers/<id>/` | the repository, the hidden tests and keys, the reference overlay, the scripted lazy and alternative answers |
| `briefs/<id>.json` | the brief the author got (phase, role, kind, public source and licence); a dropped brief carries `dropped` or `firstAttempt` |
| `prompts/` | author prompts (one call, or step A and step B of the two-step method), review, re-check and the small-control kind |
| `lib/selfcheck.js` | the author's own check; builds `hidden/` from the draft (design key in `block-kit/`, rollout key in `rollout-kit/`) |
| `scenario.config.js` | the batch config for the shared tools in `bench/scenarios/lib` |

Scoring: three `tests` checks (the feature's behaviour tests; the design note's key and the rollout plan's key, each over
the document's closing JSON block, graded by the shared `block.test.js` with `BLOCK_KIT=rollout-kit` for the second),
other checks, and an `expertKey` for the judges (rubric share 30% at most).

Free commands (run from the repository root, `TMPDIR` under `/tmp`):

```
node bench/scenarios/lib/dry-run.js --config bench/scenarios/t10/scenario.config.js [id ...] [--record]
node bench/runner/bench.js scenarios ready --batch t10
```
