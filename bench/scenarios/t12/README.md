# T12: the orchestration core

Before this batch no task targeted the part konductor is built around: the `konductor` agent, the `k-full-sdlc`,
`k-delegate` and `kiro-spec-workflow` SOPs and the `delegation-protocol` skill (task review of 2026-11-20). These
four tasks ask for work where that core should help: a spec a teammate can build from, a feature taken from request
to done, a hand-off a stranger can finish, and a plan that runs work in parallel without collisions. Each is scored on
the outcome (what the documents and code say and do), never on whether a procedure was followed.

| Task | What the agent produces | Targets | Scored by |
| --- | --- | --- | --- |
| `t12-spec-rate-limits` | `.kiro/specs/api-rate-limits/` requirements, design and tasks for per-key API limits | SOP `kiro-spec-workflow`; the three kiro spec skills | block key on the tasks.md JSON block: the agreed rules (per key, plan figures from config, 429 shape, exempt callers, one count across instances), traced tasks in a sound order, the unexplained burst figure as an open question |
| `t12-sdlc-contact-import` | `src/import.js`, its tests, a help page and a feature note | agent `konductor`, SOP `k-full-sdlc` | five hidden behaviour tests (one per agreed rule, all cases of the rule in one test) plus a block key on the feature note's requirements, decisions and test plan |
| `t12-handoff-export-dates` | a hand-off brief for a half-diagnosed bug, then the fix finished from that brief alone as a second step, with a result file | SOP `k-delegate`, skill `delegation-protocol` | block key on the hand-off: cause file, reproduction, known facts, the rules the change could break, checkable done criteria, the deadline; plus `work.test.js` on the second step: dates right in three zones, suite green in UTC and Auckland, a new test that fails on the old code under UTC, columns and `src/legacy/` unchanged, files read and changed inside the hand-off's list, every done criterion answered, a hand-off command run |
| `t12-parallel-backlog` | a release plan for three people, then each package done apart in `work/<package>/` with its own report, and merged in the planned order with a merge log | agent `konductor`, skills `delegation-protocol`, `task-decomposition` | block key on the plan: what overlaps in the code (the model's FIELDS list, the configuration file), waves, packages with files and done criteria, the on-hold item left out; plus `work.test.js`: each package folder holds only its own files and a report with its test result, the merges replayed one at a time from the original code stay green, the repository holds the last merged version of each file, the merge log follows mergeOrder, A5 merges before A4, and the release works (currency, config move with fallback, login limit and its setting, help text, CI in two zones) |

Every key uses `"scoring": "sections"` (a section earns all with nothing missed, half with one item missed, nothing
with more) and most have a gate item; see `bench/scenarios/lib/hidden/block-key.js`.

The two delegation tasks require the work to be split and finished, not only planned, and score that from the
deliverables alone, never from session labels or the tool log. Each `work.test.js` needs the plan or hand-off block
and the work (no work, no credit) and counts each check twice, so a plan with no work scores 20 to 27. Their
`hidden/<id>/.bench-base/` is a copy of the fixture's code before any change, used to replay the merges and to put
the old code back; keep it equal to the fixture when the fixture's code changes.

The fixtures run their suites with `node --test test/*.test.js`: Node 22 and later read the arguments of
`node --test` as globs, so `node --test test/` fails there.

## Answers the dry run scores

- `answers/<id>/lazy/`: for the two delegation tasks the full reference plan or hand-off with no work done (one
  agent writing a plan only); for the SDLC task a hand-written half-done importer; for the spec the mechanical half
  answer (`bench/scenarios/lib/answers.js`).
- `answers/<id>/alt/`: a hand-written, independently designed correct answer for every task: the spec groups the
  rules by caller, counts with a sliding window from two counters, puts the tests first and fails open to a
  per-instance count; the importer reads records with a state machine and lets `book.add()` give the skip reasons;
  the hand-off is a numbered walk-through, and its second step fixes with `toISOString()` and a new test file that
  sets the zone in-process; the release plan splits currency into two packages, nests `config/app.json` and counts
  login failures from the first failure of a minute.
- `answers/<id>/shallow/`: a hand-written shallow fake that uses the right words and does none of the work (gate 40).

```
node bench/scenarios/lib/dry-run.js --config bench/scenarios/t12/scenario.config.js [id ...] [--record]
```

## Limits

The tasks were written by hand by a Claude worker (no author model call was approved), so they carry `handEdited` and
`authorship.singleFamily` and wait for a non-Claude recheck (DEBT D-108). No agent has run them yet.

Two parts of the delegation proof rest on what the work reports: the hand-off's second step lists the files it read
(`readFiles`), and nothing shows that the hand-off was left unchanged after that step began. The changed files, the
test results and the merge replay are checked from the files themselves.
