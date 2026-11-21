# T8: SRE, release and ops tasks

Batch T8 of the scenario pack (plan "Scenario program v3", section 9): incident reports and postmortems from logs,
rollout plans, a runbook, an alert review, an SLO task, a deploy-strategy decision, a production bug fix, one near-miss
twin and two negative controls. Folders are synthetic: logs, metric CSVs, deploy histories, config diffs and alert
definitions written by a seeded generator. Each incident folder seeds one root cause that the logs prove and one red
herring.

Two held-out tasks came from the coverage review of 2026-11-20 (worker CV-E): `t8-heldout-rollback-decision` (a release
manager's roll back, hold or roll forward call under conflicting signals) and `t8-heldout-incident-handoff` (the hand-off
note for an ongoing incident: diagnosis, the one safe mitigation, the open risk and the owner). Both ids land in
HELD-OUT under the SR-32 split (`bench/scenarios/split.js`; hashes 1850953913 and 1473558289, recorded in their briefs).

## Layout

| Path | What |
| --- | --- |
| `<id>.json` | the task (schema v3) |
| `fixtures/<id>/` | the folder the agent starts in |
| `hidden/<id>/` | the hidden scorer, copied over a scratch copy of the workspace before the tests run; `.bench-lib.json` names the shared helpers (`block.test.js`, `block-key.js`, `regress.test.js` from `bench/scenarios/lib/hidden/`) the tests check copies in |
| `solutions/<id>/` | the reference overlay |
| `authoring/<id>/gen/` | the generator that wrote the fixture's large data files (Python 3.12, fixed seed) |
| `briefs/<id>.json` | the brief the task was written from (phase, role, kind, public source; expert key where one applies) |
| `prompts/` | author, twin and review prompts; `scenario.config.js` fills them from a brief |
| `lib/` | the author's kit: the self-check and the hidden-dir builder |
| `answers/<id>/` | the lazy and alternative answers the dry run scores |
| `scenario.config.js` | this batch's config for the shared tools in `bench/scenarios/lib` |
| `AUTHORING-LOG.md` | every model call: task, step, model, credits |

## How a task is scored

| Kind | Hidden part |
| --- | --- |
| Document (incident, postmortem, rollout plan, runbook, alert review, SLO, decision) | The agent's document ends with a JSON block. `block.test.js` grades it with `block-kit/block-key.js` against `block-kit/key.json`: one test per key item (times its weight). Items check the root cause text (and that it does not blame the decoy), the cited `path:line` evidence and its precision, timeline times within a tolerance, impact numbers within a tolerance, action items, plan step order (a small canary before any full step, the schema expand step before the new code), that every gate and rollback metric exists in the folder's metrics catalogue, that no step starts in a freeze window, and list lengths (a list that names everything does not win). Six keys (dec-deploy-strategy, inc-memory-leak, inc-queue-backlog, oncall-alert-review, pm-cache-stampede, pm-cert-expiry-region) use `"scoring": "sections"`: each section of the report earns all with no item missed, half with one, nothing with more, and the root cause or decision is a gate (`gate: true`): when it fails, every test fails. Item types: header of `bench/scenarios/lib/hidden/block-key.js`. |
| Bug fix | `hidden-behaviour.test.js` tests the fixed behaviour; `regress.test.js` runs the agent's own suite on its fix (must pass) and with the original files from `regress-kit/original/` put back (must fail). |
| Twin, negative control | Plain hidden tests (`hidden-twin.test.js`, `hidden-check.test.js`). |

Rollout, runbook, SLO and decision tasks also carry an `expertKey` for the judges (rubric share only, at most 30%).
Their items ask only what the hidden key cannot check (for example why a schema step is safe, not whether it comes first).
The block key lives only in the hidden dir, not in the task file (the task schema is closed).
Negative controls have no target; the units the mapper proposed for them are their `mustNotLoad` list.

## Lazy and alternative answers

`answers/<id>/lazy/` and `answers/<id>/alt/` hold the mechanical answers of `bench/scenarios/lib/answers.js` (free:
half of the reference's substance with numbers skewed, and the reference reordered and reworded). The paid
`variants <id>` stage step instead has a model of a third family (glm-5) answer the request on a copy of the fixture
twice: once normally (an answer shaped unlike the reference) and once told to skim the README and two small files only
(a plausible shallow answer); it writes the same two folders. The dry run scores both: the lazy answer must score 40
or less and the alternative 80 or more. On 2026-11-20 the mechanical lazy answers scored 54.8 to 100 (DEBT D-97). When the alternative misses for a reason the key should accept, the key is fixed; when the
alternative is wrong on substance, that is recorded in `AUTHORING-LOG.md`.

## Authorship

Version 1 of all 15 tasks was written by gpt-5.6-luna and reviewed by qwen3-coder-next. A second-family rewrite (qwen3-coder-next or minimax-m2.5 as author, the other as reviewer) was tried on seven tasks on 2026-11-19 and 20. No draft passed the gates (several were caught by the lazy-answer check), and the combined T7 and T8 rewrite spend stop was reached, so every task is still version 1 and the batch has one author family; each brief records its tries in `secondFamilyRewrite`. Claude hand edits are listed in `HAND-EDITS.md`. Four deepseek-3.2 drafts were
discarded (the request named the decoy or listed every constraint and its file, key matchers used fields the grader
does not read, the author's answer or key files sat in the fixture) and re-authored; the last three deepseek briefs
were moved to gpt-5.6-luna before authoring for the same reason. The discarded drafts and the worker's hand fixes
are listed in `AUTHORING-LOG.md`.

The two CV-E held-out tasks were written by hand (Claude) and reviewed by qwen3-coder-next. A gpt-5.6-luna two-step
draft of `t8-heldout-incident-handoff` (step `a`: `prompts/step-a.md`, step `b`: `prompts/step-b.md`, then one fix)
still failed the stub and lazy gates and was dropped; its brief records it in `secondFamilyTry`. The batch stays
single-family-authored (DEBT D-122).

## Tools

All through the shared tools with `--config bench/scenarios/t8/scenario.config.js` (`bench/scenarios/lib/README.md`):

- `lib/prompt.js <id>`: the author prompt.
- `lib/stage.js audit|log-author|normalize|map|review|variants|assemble <id>`: after the author call (needs `T8_AUTH`). `audit` is the blindness audit of every stream of the task.
- `lib/dry-run.js [id ...] [--record]`: the free dry run (reference, stub, lazy, alternative; gates 95, 20, 40, 80; three repeats; per-test timeouts; the task file loads). Run it as `TMPDIR=/tmp nice -n 19 node bench/scenarios/lib/dry-run.js --config bench/scenarios/t8/scenario.config.js`.
- `lib/selfcheck.js` (this batch's): the author's own check (builds the hidden dir from the draft and runs the tests on reference and stub). Unit tests of the grader: `node --test bench/runner/test/scenarios-t8-block-key.test.js`.

To regenerate a fixture's data files, copy `fixtures/<id>` to `<dir>/fixture` and `authoring/<id>/gen` to `<dir>/gen`,
then run `python3.12 gen/generate.py` in `<dir>`; the output matches the committed files.

Fixtures have no git history (a nested `.git` cannot be committed; see DEBT D-59).
