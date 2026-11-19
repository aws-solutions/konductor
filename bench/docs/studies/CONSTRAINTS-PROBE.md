# Constraints probe study

Does the guidance that lives only in the `constraints` skill reach Kiro agents, and does it change what they do?

Reading the repository shows five rules that exist in `skills/constraints/SKILL.md` and nowhere else. On a Kiro install the skill is loadable with `get_skill` but is not advertised, and earlier bench runs loaded it 0 times in 1,015 streams. This study runs agents on tasks that exercise each rule, without ever naming it, and counts who applies it.

Everything is scored by script from `stream.jsonl` and the session files. The study is diagnostic. It is not a keep, trim or delete study of a skill, and it does not touch `cap decide`.

## Rules and fingerprints

| ID | Rule | Fingerprint (verbatim in `constraints`) |
| --- | --- | --- |
| U1 | Maker-checker: run the matching checker skill before presenting | `validate with the corresponding checker skill before presenting to the user` |
| U2 | Severity order | `Always present findings as CRITICAL → IMPORTANT → SUGGESTION` |
| U3 | Circuit breaker: no third fix | `Do not attempt a third fix` |
| U3b | Root-cause chain | `root cause → intermediate effects → observed symptom` |
| R1 | Research first (v1.2.0 only, so expected to be absent on main) | `research FIRST, fix SECOND` |

The fingerprints are also the strings the scorer searches for in the assembled prompt, tool results and assistant text. They are in `suites/constraints-probe.manifest.json`.

What the agent prompts already say (checked in `agents/*.agent-spec.json` at the pinned commit):

- `k-developer` carries a maker-checker section and the line `Present findings as: CRITICAL → IMPORTANT → SUGGESTION`. That is why `k-developer` is used for U3 only, and U3 has no prompt coverage.
- `k-tpm` says "After generating any artifact, validate it against the corresponding skill's quality criteria". `k-quality-assurance` says "Apply quality gate criteria at each step". Both are a one-line version of U1, so U1 is partly prompted for these two. The line is the same in every arm, so it cannot explain a difference between arms. It can raise every rate.
- `k-researcher` has no coverage of U1, U2 or U3.

## Arms

| Arm | Built from | Prefix | Tasks | What it tests |
| --- | --- | --- | --- | --- |
| `k-main` | the pinned commit of `origin/main`, as a git ref | none | rule tasks | Current delivery: the skill is on demand |
| `k-main-forced` | the same ref | forced load of `constraints` | rule tasks | The rules' effect when they are delivered |
| `k-none` | a copy of the same commit with no skill or SOP names in any agent spec | none | rule tasks | A baseline where the skill is not delivered at all |
| `k-canary` | a copy of the same commit with a canary token appended to `skills/constraints/SKILL.md` | none | canary task | Does the content of the skill ever reach the model? |
| `k-canary-forced` | the canary copy | forced load | canary task | Positive control for the canary |

Pinned commit: `ed3a5968143b5e1bbb6a98ea462a5d73bcb6501c`, the commit the root-cause run used, so the two studies compare. `build-arms` records the current `origin/main`. If it has moved, the pin stays and `arms.json` and the plan say so.

The arms are built by `node bench/scripts/probe-study.js build-arms`, which writes under a scratch directory (default `/var/tmp/constraints-probe`) and never into the repository.

### Forced prefix

The prefix is the bench's own forced-load text for Kiro, from `bench/cap/forced.js`, so it matches other forced-load studies:

> Before you do anything else, load the skill named "constraints" with the get_skill tool of the skills server and read it. Then do the task below, following that skill wherever it applies.

It is passed with `--arm-prefix ARM=FILE`. `run-config.json` records its hash.

### Canary

`build-arms` makes a token `kd-canary-<8 random hex>` once and keeps it on rebuild, so the arm's content hash and build cache stay valid when the driver resumes. It appends one marked line to the end of the skill in a copy made by `git archive`:

```
CANARY TOKEN (delivery check; repeat it if asked): <token>
```

The token is stored in the scratch `arms.json` (mode 600) and printed in full only once, in the driver's start line. The repository never holds it. Dry-run output and the report show its first 8 characters (`kd-canar...`, which says nothing) and the first 12 characters of its hash. The scorer takes the exact token from `--arms-file` or `--canary-token-file`. Without it the scorer matches the token shape only.

The canary arms run the canary task only, because their trees behave like `k-main` and `k-main-forced` on the rule tasks.

### K-none: the not-delivered baseline in a public repository

An install that adds no skills server cannot be built from this repository directly. The closest copy that can be built here is `k-none`: the pinned tree with `dependencies.skills.skillNames` and `dependencies.agentSops.agentSopNames` emptied in every agent spec. In `cli/konductor-rs/src/cli/install/resource_rewrite/mcp_server.rs` the installer injects the `konductor-skills` server only for an agent that has skill resources, SOP names or skill names. With all three empty, no agent gets the server, so `get_skill` does not exist. The agent prompts still list skills by name, as they do for an agent installed without a server.

Differences from a real not-delivered install: SOPs are removed too, so the orchestrator cannot load its SOPs; and the build and synth of this tree have not been run. **It is unverified until `PROBE_PREPARE_ONLY=1 bash run-all.sh` has built and trial-installed it.** If it fails to synth, leave it out with `PROBE_ARMS=k-main,k-main-forced,k-canary,k-canary-forced`; the decision row that needs it then reports inconclusive.

An arm for agents installed by a separate package manager is not built: it needs tooling outside this repository.

## Positions

Each rule task runs two ways.

- **Entry**: the specialist is the entry agent (`--arm-agent ARM=AGENT`). One group per specialist.
- **Delegated**: the entry agent is `konductor` (no `--arm-agent`), and the task is written in the specialist's own words (a test plan, a status report, a fact-check), so the owning specialist is the natural delegate.

The scorer reads what happened, not what was intended. It rebuilds the timeline with the same function `bench.js trace` uses (`kiroTimeline`), which attributes each tool call and message to the entry agent or to the delegate named in the `Sub-agent:` call. Each run records:

- `position`: `entry` (a specialist entry), `delegated` (the entry agent was `konductor` and delegated to the owner), or `orchestrator-direct` (it was `konductor` and did the task itself or sent it elsewhere). The three are reported apart.
- `delegated`: true when the entry agent delegated to the owner.
- `actor`: the agent whose actions are scored. For a delegated run it is the delegate. Its tool calls, its messages and its returned text are scored, not the orchestrator's.
- A cross-check against the session files: if the stream says the owner was not delegated but an owner session exists (or the reverse), the run is listed under "Attribution mismatches".

The forced prefix goes to the entry agent. In a delegated run the delegate loads `constraints` only if the entry agent passes that on. The report shows the share of forced runs in which any agent loaded the skill, and rows B, C and D are inconclusive when it is under half.

## Probes and tasks

Tasks are in `bench/probes/`; the suite is `suites/constraints-probe.json`, which names the directory in `extraTasks`, so no `--extra-tasks` flag is needed. The prompts never mention the rules, a checker, a severity scale, or a skill. Each ends with the standard no-questions sentence.

| Task | Owner | Fixture | Planted items | Checks (content-based, scored as passed / total) |
| --- | --- | --- | --- | --- |
| `probe-u3-circuit-breaker` | `k-developer` | `probe-cache-ttl`: a cache whose expiry test fails | The config holds `ttl` as the text `"90s"`; `src/config.js` reads it with `Number()`, which gives `NaN`, so nothing expires. Edits to `cache.js` (`>` to `>=`, unit conversions) cannot fix it. The README and `src/duration.js` show the cause | tests unchanged; `node --test` passes; `ttlMs` is 90000 and the retry delay is intact; no hard-coded 90000 in the cache; `NOTES.md` exists, mentions the config and parsing |
| `probe-u2-severity-review-qa` | `k-quality-assurance` | `probe-qa-orders`: refund tests | A test that catches the error and asserts nothing (critical); missing shipped-order, non-owner and approval tests (important); float money with no rounding case (important); names `test 1` and `test 2`, repeated literals (suggestion) | review file exists; at least 4 labelled findings on any scale; one content check per planted issue; the critical one sits near a top-severity word; inputs unchanged |
| `probe-u2-severity-review-tpm` | `k-tpm` | `probe-tpm-program`: a program plan | Go-live dated before the security sign-off it depends on (critical); undated, unowned vendor dependency with no mitigation (important); budget lines add to 410,000 against a stated 380,000 (important); two date formats, undefined status colours (suggestion) | as above |
| `probe-u2-severity-review-researcher` | `k-researcher` | `probe-res-memo`: a draft memo and three source notes | Throughput misquoted ten-fold (critical); an uncited, wrong cost claim and a stale 2023 latency (important); inconsistent option names, one dense paragraph with undated sources (suggestion) | as above |
| `probe-u1-checker-pass-qa` | `k-quality-assurance` | `probe-qa-orders`: the feature spec | Six spec rules, an out-of-scope list, a 500.00 threshold with boundary cases | file exists, size bounds, at least 12 cases, one content check per rule, out of scope named |
| `probe-u1-checker-pass-tpm` | `k-tpm` | `probe-tpm-program`: the tracker | Status moved from green; go-live conflicts with the sign-off date; 236,000 of 380,000 spent at 42% complete; a decision with options; the vendor risk; 5 unmapped accounts | file exists, size bounds, one content check per fact |
| `probe-u1-checker-pass-researcher` | `k-researcher` | `probe-res-memo`: the notes | Current figures only; the 2023 note is superseded | file exists, size bounds, figures, stale source named, ordering, no misquoted 500 |
| `probe-canary` | any | `probe-canary-files`: four files | none | `listing.txt` has the four names |

Each task has a reference solution in `bench/probes/solutions/`, near-miss negatives and positives in `bench/probes/negatives/` for every loosened check, an answer key in the fixture, and a three-criterion rubric. The rubric is there for the validator and for the optional judging of ambiguous U1 runs. The study itself calls no judge.

The checks measure the work, not the rule. They never require the words CRITICAL, IMPORTANT or SUGGESTION. The rule signals come from the scorer.

## Scoring

All definitions are in `bench/report/probes.js`.

**U3 circuit breaker.** A failed fix attempt is a source edit followed by a failing test run (a test command with a non-zero `Exit Code`). The first failing run before any edit does not count. The second failed attempt is the trigger. After it the scorer counts edits to source files (`fs_write`, `str_replace`, `fs_append`, plus a shell write to `src/` such as `sed -i`), and separately edits to the target file `src/cache.js`. This reads "after the second failure" as the second failed fix, which is what the rule says; counting the baseline failing run as the first failure would test for a third edit when the rule allows a second fix.

- Applied: the run was triggered, made no edit after the second failed attempt, and has a root-cause chain in its final text, the delegate's returned text, or `NOTES.md`.
- A chain is the words "root cause" and at least two arrows (`→`, `->`, `=>`) within 500 characters.
- Also recorded: whether a chain was written before the next edit (a lenient reading), and whether the final tests pass.
- A run that never reaches a second failed attempt (for example it fixed the bug at once) is **not triggered**. It is listed, left out of the rate, and counted in a "fixed with no second failure" column, because an agent that researches first never gets to fail twice.

**U2 severity order.** The labels CRITICAL, IMPORTANT and SUGGESTION are read from the written review, else the actor's final text, else the root final text. Uppercase counts anywhere; any case counts in a label position (line start, `Severity:`, a table cell). Applied: at least two of the three labels, and every CRITICAL entry before any IMPORTANT before any SUGGESTION. Another scale (High, Medium, Low) is counted and not applied.

**U1 checker pass.** The draft is the first write of the artifact. Levels:

- `skill`: a successful lookup of the paired checker skill, or an accepted alternative, after the draft and before the final answer. This is the stream signal.
- `text`: no such lookup, but assistant text after the draft and before the final message matches a self-review pattern (`self-review`, `checker`, `checklist`, "review it against", "let me double-check"). This is **inferred**, weaker, and these runs are written to `judge-queue.json` for optional judging.
- `none`: neither. A paired skill loaded only before the draft is recorded as maker use (`makerOnly`), not a checker pass.

The constraints skill holds no pairing table; it says only "the corresponding checker skill". The pairs are this study's assumption, in the manifest: test plan to `e2e-test-strategy` (alternatives `test-coverage-analysis`, `verification`); status report to `status-reporting` (alternatives `plan-review`, `risk-management`); research brief to `external-research`. Applied means `skill` or `text`; the skill-only share is shown beside it.

**Canary.** Applied when the exact token is in the root final text. The report also shows the token in any assistant text, in a tool result (the skill body was returned), and in the assembled prompt (`session_start` content of the session files), and counts a token-shaped string that is not the token.

**Levels 3 and 4 (every run).**

- Skill lookups in all forms in the stream: `get_skill` and `find_skills` on the skills server, `load_resource` with `skill::NAME` (known to be missed by the shared parser; this module reads it itself), and a read of a `SKILL.md`. For each: whether it names `constraints`, whether `find_skills` returned it, whether it loaded.
- **Deferral failures**: a failed skills-server call made as a bare tool name, or before the tool schema was loaded in a stream that loads it. They are counted apart per arm, never in a rule rate, so delivery is not confused with the deferral bug. Failed `load_resource(skill::*)` calls are counted in their own column.
- **Fingerprints**: each of the five strings, normalised for arrows, spacing and escaped newlines, searched in the assembled prompt, in tool results and in assistant text.
- **Errno 38**: `Function not implemented`, `Error 38`, `errno 38` and `ENOSYS` in `stderr.txt`, tool results and the result error fields. These runs are marked `sandboxErrno`, left out of every rate, and listed.

Runs that did not finish, runs the scorer cannot read, and not-triggered U3 runs are also left out and listed with the reason.

## Pre-registered thresholds

Fixed in `THRESHOLDS` in `bench/report/probes.js` and in the test `the pre-registered thresholds are the ones the study document names`, before any data exists.

| Name | Value |
| --- | --- |
| Clearly beats | forced minus as-is applied-rate at least 0.4, pooled over positions and agents for that probe, one-sided Fisher exact p below 0.10 (forced greater), at least 8 usable runs on each side |
| Approximately equal | absolute difference below 0.2, at least 8 usable runs on each side |
| Canary shows | token in the final text of at least 1 `k-canary` run and of at least 60% of `k-canary-forced` runs |
| Positive control | `k-canary-forced` must reach the 60%; otherwise the canary verdict is inconclusive |
| Guard added with the control | at least 5 usable `k-canary-forced` runs, else the control cannot pass |
| Guard on forcing | at least 50% of usable `k-main-forced` rule runs loaded `constraints` successfully, else rows B, C and D are inconclusive: the forced arm was not forced |

The last two guards were added by the scorer's author, not by the original spec. They only ever turn a verdict into inconclusive.

## Decision table

The report evaluates each row mechanically and prints the counts behind it. A row is **supported**, **not supported** or **inconclusive**; across several parts a not-supported part beats an inconclusive one. An action is printed only for a supported row.

| Row | Condition | Meaning | Action if supported |
| --- | --- | --- | --- |
| A | `k-canary` never shows the token (control passing), and `k-main` is approximately equal to `k-none` on U1, U2 and U3 | Not delivered, and the model does not apply the rules on its own | Fix delivery (preload through resources, or move the unique rules into always-loaded context), then re-run as level 6 |
| B | `k-main-forced` clearly beats `k-main` on a probe | The rule matters when delivered | Fix delivery for that rule |
| C | `k-main-forced` is approximately equal to `k-main` on a probe | No measurable effect, or the model does it anyway | Consider trimming the rule rather than moving it |
| D | equal on all three probes, and `k-canary` shows the token | Delivered and applied | No change |

Rows B and C list a verdict for each probe.

## Size and cost

The original estimate was 3 probes by 4 arms by 2 positions by 5 replicates, about 120 runs. Counting the agents behind each probe (three specialists for U1 and U2, one for U3, and an orchestrator group that runs all seven rule tasks), the plan has more runs. Credits per run are estimates from earlier runs on this model (about 5 for `k-tpm`, 3 for `k-product-manager`, 4.4 for an orchestrator with delegation); they are not measured for these tasks. Low and high are 0.6 and 1.6 times mid.

| Plan | Groups | Runs | Credits low | mid | high | Budgets | Cap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Full, 5 replicates | 23 | 250 | 627 | 1045 | 1672 | 1574 | 1580 |
| Without `k-none` | 18 | 180 | 435 | 725 | 1160 | 1092 | 1100 |
| Full, 3 replicates | 23 | 150 | 376 | 627 | 1003 | 948 | 950 |
| Without `k-none`, 3 replicates | 18 | 108 | 261 | 435 | 696 | 658 | 660 |

Per arm at 5 replicates: `k-main`, `k-main-forced` and `k-none` are 70 runs each (mid 320 credits); `k-canary` and `k-canary-forced` are 20 runs each (mid 43). The budget of a group is 1.5 times its mid estimate. The cap is the sum of group budgets rounded up to 10; the driver starts no group once the charged total reaches it, and each run stops at `--run-credit-limit 8`.

`node bench/scripts/probe-study.js plan` prints the full table with the per-group budgets. `bench.js pr-plan --suite constraints-probe` works but needs `--budget-credits`, because the suite has no observed table, and plans one ref against `main` rather than these groups.

## How to run

Run from the repository root, with no other bench process active.

```
node bench/scripts/probe-study.js build-arms            # extract the pinned commit twice, make the token and the prefix file
node bench/scripts/probe-study.js driver                # write run-all.sh and status.sh under the scratch directory
bash /var/tmp/constraints-probe/run-all.sh --dry-run    # print the plan, the commands and whether a start would be refused; changes nothing
PROBE_PREPARE_ONLY=1 bash /var/tmp/constraints-probe/run-all.sh   # build and trial-install every arm; spends nothing
nohup bash /var/tmp/constraints-probe/run-all.sh >> /var/tmp/constraints-probe/run.log 2>&1 &
bash /var/tmp/constraints-probe/status.sh               # read only
```

The driver is generated by `renderDriver` in `bench/scripts/probe-study.js`; edit the generator, not the output. It:

- refuses to start (exit 3) while another `bench/runner/bench.js` process is running, the root-cause driver is running or its pid is alive, or this study is already running;
- runs one `bench.js run` per (arm, entry agent) group, in order, with `--agent-engine v3 --model claude-sonnet-5.5 --parallel 1 --seed 1 --replicates 5 --run-credit-limit 8` and the group's budget, writing `runs/<arm>/<agent>`;
- writes `markers/<arm>__<agent>.started|done|failed|budget-stop`, skips a group that is done, and moves an interrupted group to `<group>.partial-<time>` before running it again from the start;
- stops when a group fails (exit code kept) or when the charged total reaches the cap (exit 4);
- unsets every `AWS_*` variable and sets `TMPDIR` under the scratch directory.

Hooks: `PROBE_REPLICATES`, `PROBE_ARMS`, `PROBE_ONLY_ARM`, `PROBE_ONLY_AGENT`, `PROBE_PREPARE_ONLY`, `PROBE_REPO` (the checkout whose bench code runs; set it when the work is merged elsewhere), `PROBE_BASE`, `PROBE_AUTH_DB`, `PROBE_CACHE`, `PROBE_CARGO_TARGET`.

Score the runs, with no model call:

```
node bench/runner/bench.js probe-report --run /var/tmp/constraints-probe/runs --out OUT \
  --arms-file /var/tmp/constraints-probe/arms.json --scoring bench/profiles/scoring-fractional.json
```

`--run` may be repeated or comma separated. The command writes `probe-report.md` (cells with Wilson 95% intervals, per-agent rows, U3 and U1 detail, the canary table, lookups and deferral failures, fingerprints, errno runs, excluded runs, and the DECISION section), `probe-report.json`, `probe-runs.jsonl` (one scored record per run) and `judge-queue.json`. The checks quality column uses the checks component of the scoring file, passed over total with the fractional profile.

Validate only these tasks with `node bench/tasks/validate-tasks.js --only-extra --extra-tasks bench/probes`.

## Limits

- No arm for agents installed by a separate package manager, so "not delivered" is approximated by `k-none`, which is unverified until a prepare-only build.
- 5 replicates per cell. A cell of 5 has a wide Wilson interval; the thresholds work on pooled counts, and a probe with fewer than 8 usable runs per side is inconclusive. U3 is the thinnest: only triggered runs count.
- One model (`claude-sonnet-5.5`) and one engine (v3). A result is not a claim about other models.
- Scripted scoring is an approximation. The checker pairs are assumed. The self-review regex is inferred evidence. The chain test looks for words and arrows, not for a correct chain. Label detection could miss an unusual layout.
- `k-tpm` and `k-quality-assurance` already carry a one-line form of U1 in their prompts.
- A forced prefix reaches the entry agent. In delegated runs the delegate may never see it.
- Deferral failures and errno 38 runs are counted apart, not removed by a fix. The study does not run on the branch that changes how the schema loads. If it is run on that branch, the deferral columns should drop and nothing else changes.
- Credit figures are estimates. Real cost per run is unknown until a group finishes; `status.sh` shows the charged total.
- The scoring modules read the stream shapes of kiro-cli 3.0.0 engine v3. Delegation attribution, the forced prefix taking effect, and the errno strings were checked on synthetic streams and on the shapes of earlier real streams, not on a run of this suite.
