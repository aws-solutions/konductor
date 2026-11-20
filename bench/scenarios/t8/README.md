# T8: SRE, release and ops tasks

Batch T8 of the scenario pack (plan "Scenario program v3", section 9): incident reports and postmortems from logs,
rollout plans, a runbook, an alert review, an SLO task, a deploy-strategy decision, a production bug fix, one near-miss
twin and two negative controls. Folders are synthetic: logs, metric CSVs, deploy histories, config diffs and alert
definitions written by a seeded generator. Each incident folder seeds one root cause that the logs prove and one red
herring.

## Layout

| Path | What |
| --- | --- |
| `<id>.json` | the task (schema v3) |
| `fixtures/<id>/` | the folder the agent starts in |
| `hidden/<id>/` | the hidden scorer, copied over a scratch copy of the workspace before the tests run |
| `solutions/<id>/` | the reference overlay |
| `authoring/<id>/gen/` | the generator that wrote the fixture's large data files (Python 3.12, fixed seed) |
| `briefs/<id>.json` | the brief the task was written from (phase, role, kind, public source; expert key where one applies) |
| `prompts/` | author, twin and review prompts; `render-prompt.js` fills them from a brief |
| `lib/` | the shared scoring kit and the author's self-check |
| `AUTHORING-LOG.md` | every model call: task, step, model, credits |

## How a task is scored

| Kind | Hidden part |
| --- | --- |
| Document (incident, postmortem, rollout plan, runbook, alert review, SLO, decision) | The agent's document ends with a JSON block. `block.test.js` grades it with `block-kit/block-key.js` against `block-kit/key.json`: one test per key item (times its weight). Items check the root cause text (and that it does not blame the decoy), the cited `path:line` evidence and its precision, timeline times within a tolerance, impact numbers within a tolerance, action items, plan step order (a small canary before any full step, the schema expand step before the new code), that every gate and rollback metric exists in the folder's metrics catalogue, that no step starts in a freeze window, and list lengths (a list that names everything does not win). Item types: header of `lib/block-key.js`. |
| Bug fix | `hidden-behaviour.test.js` tests the fixed behaviour; `regress.test.js` runs the agent's own suite on its fix (must pass) and with the original files from `regress-kit/original/` put back (must fail). |
| Twin, negative control | Plain hidden tests (`hidden-twin.test.js`, `hidden-check.test.js`). |

Rollout, runbook, SLO and decision tasks also carry an `expertKey` for the judges (rubric share only, at most 30%).
Their items ask only what the hidden key cannot check (for example why a schema step is safe, not whether it comes first).
The block key lives only in the hidden dir, not in the task file (the task schema is closed).
Negative controls have no target; the units the mapper proposed for them are their `mustNotLoad` list.

## Authorship

All 15 tasks were finally written by gpt-5.6-luna and reviewed by qwen3-coder-next. Four deepseek-3.2 drafts were
discarded (the request named the decoy or listed every constraint and its file, key matchers used fields the grader
does not read, the author's answer or key files sat in the fixture) and re-authored; the last three deepseek briefs
were moved to gpt-5.6-luna before authoring for the same reason. The discarded drafts and the worker's hand fixes
are listed in `AUTHORING-LOG.md`.

## Tools

- `render-prompt.js <id>`: the author prompt.
- `stage.js audit|log-author|normalize|map|review|assemble <id>`: after the author call (needs `T8_AUTH`, see the file header). `audit` is the blindness audit of every stream of the task.
- `dry-run.js [id ...]`: free check on T5's scorer: reference at least 95, untouched fixture 20 or less, three repeats agree, a per-test timeout on every tests check, and a valid task file. Run it as `TMPDIR=/tmp nice -n 19 node bench/scenarios/t8/dry-run.js`.
- `lib/selfcheck.js`: the author's own check (builds the hidden dir from the draft and runs the tests on reference and stub). Unit tests of the grader: `node --test bench/runner/test/scenarios-t8-block-key.test.js`.

To regenerate a fixture's data files, copy `fixtures/<id>` to `<dir>/fixture` and `authoring/<id>/gen` to `<dir>/gen`,
then run `python3.12 gen/generate.py` in `<dir>`; the output matches the committed files.

Fixtures have no git history (a nested `.git` cannot be committed; see DEBT D-59).
