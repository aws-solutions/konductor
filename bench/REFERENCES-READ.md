# References read: can a Kiro agent read a skill's reference files?

Skills are moving detail out of `SKILL.md` into `references/*.md` (PRs 155 to 158 and the fold of the Asana skill into `sprint-planning`). Install copies those files next to the skill. Kiro's `get_skill` returns the `SKILL.md` body and its path, so the agent has to open `references/x.md` itself, from the skills root (`~/.konductor/skills/<skill>/`), which is outside its workspace. On Claude Code this works. On Kiro nobody has checked whether the file-read tool may read outside the workspace, or whether the agent tries at all.

This study answers one question with a script, no judge: when a skill keeps a fact only in a reference file, does the agent **read** the file, is the read **refused**, or does the agent **skip** it?

Nothing here has run yet. The numbers and the decision below are rules written before any data.

## What is tested

Two tasks, each built around one fact that lives only in a reference file at the pinned commit.

| Task | Entry agent | Skill | Reference file | Planted fact (counted as "used the reference") |
|---|---|---|---|---|
| `refs-dynamodb-design` | k-architect | `dynamodb-design` | `references/aws-best-practices.md` | The write-sharding suffix range is **200** (`hash(id) % 200`). A second signal is the **5 GSI** maximum, recorded but not decisive. |
| `refs-sprint-capacity` | k-product-manager | `sprint-planning` | `references/asana.md` | A rollover through the Asana integration **recreates** each task, so subtasks and their points are **lost** and the board shows **22** of 27, not 27. |

The prompts never mention references, skills, files in a skill folder or an agent. The dynamodb prompt asks for "our DynamoDB standards" for sharding and for the GSI count and for the numbers used, which an agent can only get from the skill. The sprint prompt asks for the load "the board will show", which an agent can only get right if it knows the rollover loses the subtasks.

A third task, `refs-dynamodb-readable`, has the same prompt and checks. Its fixture also holds an excerpt of the reference at `references/aws-best-practices.md` inside the workspace. It is the positive control (see Arms).

The planted facts were chosen by reading the files at the pinned commits. `bench/runner/test/references-read-suite.test.js` re-reads them (when the commits are in the checkout) and asserts that each fact is in the reference file, is not in the slim `SKILL.md`, and is inline on main.

## Arms

All arms are git commits, named by full commit id, built by the runner from `git archive`. `refs-study.js build-arms` checks that each commit and each file it needs exist, and writes the forced-load prefix files.

| Arm | Commit | Forced load | Tasks | Role |
|---|---|---|---|---|
| `refs-main` | `ed3a5968143b5e1bbb6a98ea462a5d73bcb6501c` (origin/main when written) | no | both | Control. Skill bodies are inline, so the fact needs no reference. Shows how often the skill loads on its own. |
| `refs-main-forced` | same | yes (`dynamodb-design`; `asana-sprint-planning` for the sprint task) | both | Control. Shows whether the fact reaches the answer when the body carries it and the skill is loaded. |
| `refs-pr155` | `5ecf044b3cddaed1c8875b5bde520627b1377d6f` (head of PR 155, slim dynamodb-design) | no | dynamodb | Reference arm, skill on demand. |
| `refs-pr155-forced` | same | yes (`dynamodb-design`) | dynamodb | Reference arm with a reliable load. |
| `refs-asana` | `87ce9008c2a3a69047eb0381533b188ca764df85` (fold of the Asana skill into `sprint-planning`) | no | sprint | Reference arm, skill on demand. |
| `refs-asana-forced` | same | yes (`sprint-planning`) | sprint | Reference arm with a reliable load. |
| `refs-readable` | PR 155 commit | yes (`dynamodb-design`) | dynamodb-readable | Positive control: the reference text is also in the workspace. |

The Asana commit is on a local branch (`refactor/fold-asana-into-sprint-planning`) and on no remote branch when this was written. `build-arms` prints that. The runner builds it from the object store of the checkout it runs in, so the study must run from a checkout that has the commit. `build-arms --freeze` (driver hook `REFS_FREEZE=1`) extracts each commit to `<base>/trees/<ref>` and builds the arms from those directories (`dir:`), which survives a moved or deleted branch.

The forced prefix is the one from `bench/cap/forced.js`: it asks the agent to load the named skill with the `get_skill` tool before anything else and to follow it. It is the only difference between a plain arm and its forced twin. On the main arms the sprint task is forced to `asana-sprint-planning`, the standalone skill that holds the same rollover text inline.

Why the controls matter. If `refs-main-forced` does not produce the fact either, a miss in `refs-pr155-forced` says nothing about references. If `refs-readable` reads its file and the reference arms are refused, the cause is the path outside the workspace. If `refs-readable` does not read it either, the pointer is not followed even when the file is reachable. (The excerpt is at `references/aws-best-practices.md` relative to the workspace, which is where a relative reading of the skill's pointer lands.)

## What is recorded per run

From `stream.jsonl`, with `kiroTimeline` from `bench/runner/lib/trace.js`:

1. **Skill loaded.** A successful `get_skill` (not one deferred before the tool schema was loaded), a `load_resource` of `skill::<name>`, or a read of the skill's `SKILL.md`. Names counted: the task's skill, plus `asana-sprint-planning` for the sprint task.
2. **Read attempts** on `/skills/<skill>/references/...` (read tool calls, and shell `cat`, `head`, `sed`, `grep` and similar on such a path), plus a relative `references/...` read for the readable arm. Each attempt has an outcome:
   - **succeeded**: the file came back;
   - **REFUSED**: the call failed, or returned a short result, with workspace-boundary or permission wording ("outside the workspace", "not allowed", "permission denied", "access denied", "blocked", "not trusted" and similar). The exact text is kept and printed;
   - **error**: any other failure (no such file, a bad range).
3. **usedReference.** The planted fact is in the artifact the task writes (`docs/data-model.md`, `docs/rollover-plan.md`). The final message is recorded too, as a second signal only.
4. **Credits and wall time** from `result.json`.
5. **sandboxErrno.** A run whose stderr, error, or tool results show `Function not implemented`, `Error 38` or `ENOSYS` is excluded from every rate and listed apart.

A run's outcome is the last stage it reached: `not-loaded`, `no-attempt` (loaded, never tried), `refused`, `error`, `read-ok`. A run with both a refused read and a good read counts as `read-ok` in the table and as refused in the decision.

## DECISION

Fixed before any data, in `THRESHOLDS` in `bench/report/refs.js`. Applied to the usable runs of the **reference** arms (`refs-pr155`, `refs-pr155-forced`, `refs-asana`, `refs-asana-forced`) in this order:

| # | Rule | Verdict |
|---|---|---|
| 1 | One or more reference-arm runs had a refused reference read (`refusedAny` = 1) | **REFUSED: the install must grant read access to the skills root.** The verbatim refusal messages are printed. |
| 2 | Fewer than 3 reference-arm runs loaded the skill (`minLoaded` = 3) | **Inconclusive: not loaded.** Nothing can be said about the read. |
| 3 | At least 50% of loaded runs read a reference file (`worksReadShare`) and at least 50% of those carry the planted fact (`worksUsedShare`) | **Works.** |
| 4 | At least 50% of loaded runs never tried a read (`noAttemptShare`) | **The agent does not follow the pointer.** A description or pointer wording issue. |
| 5 | Anything else | Mixed. The counts are reported and no verdict is claimed. |

The report also prints the controls: the share of loaded `refs-main*` runs that carry the fact (the control is "weak" below 50%, `controlUsedMin`) and the readable arm's attempts and reads. Intervals are Wilson 95%. With three replicates per cell, an interval is wide; read the counts, not the percentages.

## Run it

Everything before the last step is free and calls no model.

```
node bench/scripts/refs-study.js plan                 # arms, runs, credits, cap (free)
node bench/scripts/refs-study.js driver               # writes /var/tmp/refs-read/run-all.sh and status.sh
bash /var/tmp/refs-read/run-all.sh --dry-run          # prints the plan, whether a start would be refused, and every command
bash /var/tmp/refs-read/run-all.sh                    # real start
bash /var/tmp/refs-read/status.sh                     # read only
node bench/runner/bench.js refs-report --run /var/tmp/refs-read/runs --out /var/tmp/refs-read/report
```

The driver refuses to start (exit 3) while any `bench/runner/bench.js` process is running, while the root-cause driver (`/var/tmp/rootcause/run-all.sh`, or the pid in `/var/tmp/rootcause/run.pid`) is alive, or while another copy of itself runs. It runs one group (one arm, one entry agent) per `bench.js run`, one after another, never in parallel. A finished group leaves a `.done` marker and is skipped on a re-run. An interrupted group is moved aside to `<group>.partial-<time>` and run again from its start. It stops when the charged total reaches the study cap.

Hooks for tests and partial runs: `REFS_REPLICATES`, `REFS_ARMS=a,b`, `REFS_ONLY_ARM`, `REFS_PREPARE_ONLY=1`, `REFS_FREEZE=1`, `REFS_BASE`, `REFS_REPO`, `REFS_PROC_LIST`, `REFS_ROOTCAUSE_PID`, `REFS_AUTH_DB`, `REFS_CACHE`, `REFS_CARGO_TARGET`.

## Size and cost

3 replicates, 9 groups, 27 runs, one at a time, `--run-credit-limit 8` per run, model `claude-sonnet-5.5`, engine v3.

| Group | Runs | Mid credits | Budget |
|---|---:|---:|---:|
| refs-main / k-architect | 3 | 10.5 | 16 |
| refs-main / k-product-manager | 3 | 9.0 | 14 |
| refs-main-forced / k-architect | 3 | 10.5 | 16 |
| refs-main-forced / k-product-manager | 3 | 9.0 | 14 |
| refs-pr155 / k-architect | 3 | 10.5 | 16 |
| refs-pr155-forced / k-architect | 3 | 10.5 | 16 |
| refs-asana / k-product-manager | 3 | 9.0 | 14 |
| refs-asana-forced / k-product-manager | 3 | 9.0 | 14 |
| refs-readable / k-architect | 3 | 10.5 | 16 |
| **Total** | **27** | **88.5** (low 53, high 142) | 136, cap 140 |

The per-run figures (3.5 for the architect, 3 for the product manager) come from earlier single-agent document runs on this model; they are not measured for these tasks. Dropping the two `refs-main*` pairs or the readable arm saves about 20 and 10 credits (`REFS_ARMS`).

## What this cannot show

- It cannot tell why a read was refused beyond the message text. The message is printed in full so a reader can judge.
- It tests the Kiro read tool as configured in the benchmark and its install. Each run has a scratch HOME, so the skills root is `<scratch>/home/.konductor/skills`, a sibling of the workspace `<scratch>/work`. The operating-system sandbox leaves the scratch root readable, so a refusal here would come from Kiro's own path policy, not from the sandbox. A user's machine can differ in where the skills root is and in what the policy allows; the study shows the policy, not every setup.
- The planted facts are one number and one rule. An agent can reach 200 or 22 by luck or by another route (a different skill, its own judgment). The controls bound this: a hit rate in `refs-main` or the unforced reference arms without a read is reported next to the read counts.
- `get_skill` may in future return the references too, or the install may put them elsewhere. The study measures the current behavior.
- Scoring reads the Kiro stream. A read shown only in the session files and not in the stream is not seen.
