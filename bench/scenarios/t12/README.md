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

## Worker and route tasks (batch CV-A, 2026-11-20)

Four tasks added from the coverage review of 2026-11-20: they prove delegation, route choice and multiplexer work
from what is left in the repository, never from session labels, plan text or the tool log. Each fixture has its own
git repository (`fixtures/<id>/dotgit`, built by `node bench/scenarios/t12/build-git-fixture.js <id>`, which prints the
commit id the hidden `work.json` or `work.test.js` names as the base; rebuild and update it when the fixture changes).

| Task | What the agent produces | Targets | Scored by |
| --- | --- | --- | --- |
| `t12-delegated-worker-fix` | two issue fixes (PD-41 weights, PD-44 business days), each by its own worker on its own branch, reviewed against CONTRIBUTING.md, merged with one merge commit each, worktrees and branches removed | agent `konductor`, SOP `k-delegate`, skill `delegation-protocol` | the shared grader `lib/hidden/git-work.js`: per issue, fixed on main, a merged branch that changes only that issue's file and passes the issue's hidden test on its own, and a regression test that fails on the code the branch started from; then green at every merge, a merged-result test, and the clean-up |
| `t12-sop-route-choice` | four requests from an inbox, each on its own route: the live refund bug fixed first with a test, the agreed BK-215 change with its test and changelog line, a spec and no code for the unsigned waitlist, a review of a patch that is left unapplied | agent `konductor`, skills `sdlc-navigator`, `pre-planning-analysis` | `work.test.js`: two tests per route from the files at the paths CONTRIBUTING.md gives (code and hidden behaviour tests, regression tests found by putting the route's source file back, the spec's facts and open question, the review's json block and the untouched patch), then the order of the commits (the refund fix is the first route work, no commit mixes requests), green where each request ends, and everything committed |
| `t12-mux-parallel-merge` | three disjoint tickets done side by side, one worker per ticket in its own tmux window, worktree and branch, merged one by one and cleaned up | agent `konductor-mux-orchestrator`, skills `mux-dispatch`, `git-merge` | the shared grader (three tickets) |
| `t12-cmux-parallel-merge` | the same outcome under cmux, with two tickets that share the command registry and the CLI test, so the second merge must keep both changes | agent `konductor-cmux-orchestrator`, skills `cmux-dispatch`, `git-merge` | the shared grader (three tickets) plus a merged-result test (both commands registered, the shared reading time) |

Each grader test needs at least one worker merge (or one committed piece of work), and the merged-result, green and
clean-up tests need every ticket or request done, so an untouched repository scores 0, one agent fixing everything
straight on main scores 0 (`shallow`), and doing half the tickets or routes scores 25 to 36.4 (`lazy`).

Their answers are scripted git agents: an answer dir holding `PLAY.json` (see `play()` in `scenario.config.js`) gives
workers their own worktrees and branches from main, merges them with one merge commit each, settles a conflict with
the files it names, or commits dirs straight onto main.

`t12-mux-parallel-merge` was written by a second family (gpt-5.6-luna) in two calls: the fixture and the request,
then the hidden tests, the ticket files and the reference and alternative work. The batch added only glue (the git
build, `work.json`'s base and hidden list, the `PLAY.json` files and the mechanical lazy and shallow answers).

## Limits

The first four tasks were written by hand by a Claude worker (no author model call was approved), so they carry
`handEdited` and `authorship.singleFamily` and wait for a non-Claude recheck (DEBT D-108). Of the CV-A four, three
were written by hand by a Claude worker (rechecked by a non-Claude family, `review.recheck`) and one by a second
family. No agent has run any of them yet.

Two parts of the delegation proof rest on what the work reports: the hand-off's second step lists the files it read
(`readFiles`), and nothing shows that the hand-off was left unchanged after that step began. The changed files, the
test results and the merge replay are checked from the files themselves.

The worker tasks prove from the history that each ticket was done apart on its own branch and merged; they cannot
prove that the workers ran at the same time, or that a separate agent rather than the parent wrote a branch: files
carry no reliable trace of either. cmux is not installed on the bench host or in its sandbox, so in
`t12-cmux-parallel-merge` an agent cannot open cmux workspaces; the task runs and is scored the same way, but the
cmux routing it targets cannot be exercised here (DEBT row).

The three split-part tasks of the prompt-fix study (`t12-split-three-modules`, `t12-split-four-jobs`,
`t12-split-shared-file`) are described in [README-split-tasks.md](README-split-tasks.md).
