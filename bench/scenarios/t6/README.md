# T6: product and planning tasks with a scripted user

Batch T6 of the scenario pack (plan "Scenario program v3", section 9): 15 real tasks, 1 near-miss twin and 2 negative
controls. Requirements tasks use `questions: scripted`: the first request is vague on purpose, and a scripted
colleague (no model) holds 4 to 8 facts that it reveals only when the agent asks about their topics.

## Layout

| Path | What |
| --- | --- |
| `<id>.json` | the task (schema v3) |
| `fixtures/<id>/` | the folder the agent starts in |
| `hidden/<id>/hidden/` | hidden tests, copied over the workspace before they run; `.bench-lib.json` names the shared helper `doc-key.js` (in `bench/scenarios/lib/hidden`), `answers.json` holds the scripted answers |
| `solutions/<id>/` | the reference overlay; `ASKS.json` holds the reference asking turns of a scripted task (not part of the overlay) |
| `briefs/<id>.json` | the brief each task was written from (phase, role, folder kind, public source) |
| `prompts/` | the author, mapping and review prompts |
| `scenario.config.js` | this batch's config for the shared tools in `bench/scenarios/lib`: prompt renderer, scripted conversation of the dry run, task builder |
| `tools/` | `fake-user.js`, the expert keys and the author's self-check kit |
| `AUTHORING-LOG.md` | every model call: task, step, model, credits |

## Scoring of a scripted task

The output ends with a JSON block `{"requirements": [{"id", "text"}], "assumptions": [...]}`. `hidden/requirements.test.js`
calls `scriptedSuite` from `doc-key.js`, which registers:

- one test per hidden fact: some requirement matches all of that fact's patterns (the facts unlocked and used);
- no requirement contradicts a fact (patterns of plausible wrong values);
- precision: at least 80% of requirements use no invented number (a number found in no scripted answer and no listed
  fixture file);
- at most 6 questions asked (the small penalty after 6).

Plus 2 or 3 tests for requirements that come from the fixture itself, and the usual checks.

## The scripted user in a run

The bench runner plays `scriptedUser` (topics are plain case-insensitive substrings of the question, each fact is
given once, anything else gets `defaultReply`; see `bench/README.md`, Autonomy tier). Before the checks run it writes
the conversation to a file named by `BENCH_CONVERSATION`: `{"questions": [{"turn", "text", "count", "matched"}]}`,
where `count` is the number of questions in that turn. The hidden tests read it for the question count.
`tools/fake-user.js` plays the same oracle over `solutions/<id>/ASKS.json` for the free dry run.

## Free dry run

```sh
TMPDIR=/tmp nice -n 19 node bench/scenarios/lib/dry-run.js --config bench/scenarios/t6/scenario.config.js [id ...]
```

The reference must score at least 95 and the stub (untouched fixture, no conversation) 20 or less, the same over 3
repeats, on code parts only (hidden 0.5, checks 0.2); the lazy answer 40 or less and the alternative 80 or more
(`answers/<id>/`, each with its own `ASKS.json`). `lib/stage.js --config bench/scenarios/t6/scenario.config.js
write-answers all` refreshes `answers.json`. Unit tests: `node --test bench/runner/test/scenarios-t6-tools.test.js`.

## Expert answer key

Framing, ideation and planning tasks (the ones scored by a findings script, not the requirements tasks scored by
hidden facts) carry `expertKey`: `items` (risks and trade-offs a good answer addresses, each with its public source
by name, URL and licence) and 3 to 5 `weakAnswers`. It is for the judges only and sits inside the rubric share. The
lead writes the keys in `tools/expert-keys.json`; `lib/stage.js assemble` copies them into the task. Items do not repeat
what a hidden test already checks. The judge does not read the key yet (DEBT D-62).

## Coverage-review tasks (CV-D, 2026-11-20)

`t6-architect-idea-spike` (a vague idea turned into a bounded spike plan) and `t6-developer-feasibility-spike` (a product premise proved or rejected with a script the hidden tests run on files they generate) were added by the coverage review. Both were written by claude-sonnet-5.5 in one call, so they carry `authorship.singleFamily: true`; the planned second-family task `t6-research-backed-framing` was dropped (see DROPPED.md). `prompts/author-data.md` and `prompts/author-key.md` are the two-step author prompts (`prompt.js ... <id> data|key`): step `data` writes the fixture and the request, step `key` writes the hidden tests, the reference and the checks.
