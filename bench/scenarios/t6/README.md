# T6: product and planning tasks with a scripted user

Batch T6 of the scenario pack (plan "Scenario program v3", section 9): 15 real tasks, 1 near-miss twin and 2 negative
controls. Requirements tasks use `questions: scripted`: the first request is vague on purpose, and a scripted
colleague (no model) holds 4 to 8 facts that it reveals only when the agent asks about their topics.

## Layout

| Path | What |
| --- | --- |
| `<id>.json` | the task (schema v3) |
| `fixtures/<id>/` | the folder the agent starts in |
| `hidden/<id>/hidden/` | hidden tests, copied over the workspace before they run; `doc-key.js` is the shared helper, `answers.json` the scripted answers |
| `solutions/<id>/` | the reference overlay; `ASKS.json` holds the reference asking turns of a scripted task (not part of the overlay) |
| `briefs/<id>.json` | the brief each task was written from (phase, role, folder kind, public source) |
| `prompts/` | the author, mapping and review prompts and the renderer |
| `tools/` | `doc-key.js`, `fake-user.js`, `dryrun.js` and the author's self-check kit |
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

## Interface the scripted-user harness must provide

The hidden tests read the conversation from the file named by `BENCH_CONVERSATION`:
`{"questions": [{"turn", "text", "matched": [factId], "count"?}]}`. `count` is the number of questions in that turn;
without it the tests count `?` in `text` (so `text` must not be clipped). Facts map to the autonomy oracle as
`{id, topic: id, keywords: topics, answer}` with `defaultAnswer = scriptedUser.defaultReply`; `tools/fake-user.js`
does exactly that for the free dry run. Without `BENCH_CONVERSATION` the question count is 0 (no penalty).

## Free dry run

```sh
TMPDIR=/tmp nice -n 19 node bench/scenarios/t6/tools/dryrun.js [--write] [id ...]
```

The reference must score at least 95 and the stub (untouched fixture, no conversation) 20 or less, the same over 3
repeats, on code parts only (hidden 0.5, checks 0.2). `--write` refreshes the hidden `doc-key.js` copies and
`answers.json`. Unit tests: `node --test bench/runner/test/scenarios-t6-tools.test.js`.
