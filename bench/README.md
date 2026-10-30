# bench: Konductor benchmark
Runs the same tasks against kiro-cli with and without Konductor, scores the outputs with a cross-provider
judge panel, and reports cost, quality and regressions. Node only. Task format: `bench/README-tasks.md`.
## Prerequisites
- `kiro-cli` on PATH and logged in; `git`, `tar`, `cargo` (offline cache or `--cargo-online`), Node 22+,
  `unshare` and `setpriv`.
## Quick start
```bash
OUT=/tmp/bench-out
node bench/runner/bench.js run --suite lite --budget-credits 60 --out $OUT   # every arm
node bench/runner/bench.js judge --run $OUT                         # rubric + pairwise, 3-family panel
node bench/runner/bench.js report --run $OUT                        # report.md + report.json in $OUT
node bench/runner/bench.js compare --base $OLD --head $OUT          # regression check
node bench/runner/bench.js recheck --run $OUT [--dry-run]                    # re-apply corrected task checks to saved workspaces
node bench/runner/bench.js calibrate export --run $OUT --n 25 --seed 1   # then: calibrate score
node --test "bench/runner/test/*.test.js"                           # unit tests
node bench/tasks/validate-tasks.js                                  # tasks vs reference solutions
```
Run flags: `--arms a,b`, `--tasks id,id`, `--replicates N`, `--parallel N`, `--budget-credits X`,
`--model ID` (default claude-sonnet-5.5), `--effort LEVEL` (default high), `--agent-engine v2|v3` (default v2), `--seed N`,
`--isolate auto|unshare|sandbox-exec|none`, `--allow-partial`, `--censored-floor X`, `--env-keep NAME,..`,
`--hide PATH,..`, `--tripwire-exclude PATH,..`, `--tripwire-depth N`, `--tripwire-dir DIR,..`,
`--kiro-bin PATH`, `--cache DIR`, `--cargo-target DIR`, `--cargo-online`, `--bench-dir DIR`, `--real-cache DIR`, `--prepare-only`.
`--suite lite|full|hard|real|autonomy|pilot`.
More than 10 planned runs need `--budget-credits`; `run` prints the worst-case wall clock and the cap first.
The unit tests for the real-task track run a fake project's pytest suite. Without `python3 -m pytest`
those 9 tests are skipped, not failed, and the summary shows them in its `skipped` count; install
pytest (`python3 -m pip install --user pytest`) to cover them. Set `BENCH_REQUIRE_PYTEST=1` on CI
and reference hosts so a missing pytest fails those tests instead of skipping them.
An unknown or mistyped flag is an error (exit 2) that lists the known flags, and nothing runs. `--help` and `-h` print the usage.

`--agent-engine` selects the kiro-cli agent engine for every arm of the run and installs agents that engine loads:
`v2` runs `konductor install --harness kiro-cli-v2` and launches `kiro-cli chat --agent-engine v2`; `v3` runs
`konductor install --harness kiro-v3` and launches with `--agent-engine v3`. An arm whose CLI has no `kiro-v3`
harness fails the trial install and shows as FAILED in the preflight table (`--prepare-only` checks this without
starting an agent). The engine is recorded as `agentEngine` in `run-config.json` and each `result.json`
(`installHarness` names the install). It applies to kiro-cli arms only; opencode runs reject the flag.

## Suites and arms
- lite: vanilla, v1.2.0, main; 1 replicate, `--parallel 1` (wall-clock comparisons need 1). full: all
  five arms, 3 replicates. hard: six tasks with hidden acceptance tests, three arms, 3 replicates, `--parallel 1`.
  `run --suite hard` scores each run by the share of hidden tests passed; the report shows it as
  "hidden tests passed" (mean fraction, and how many runs pass all) beside "pass". See `bench/README-tasks.md`.
  Hidden tests, partial solutions, solutions and fixtures are masked in the agent's namespace.
- real: eight pinned tasks from public Python and JavaScript projects (rich, click, markdown-it-py, commander.js), three
  arms, 1 replicate. A run starts from the real base commit and is scored by the pull request's own tests: FAIL_TO_PASS is
  the score ("FAIL_TO_PASS passed"), PASS_TO_PASS the regression figure. Fill the local cache once with
  `node bench/real/fetch.js` (the only networked step); runs copy from it and the checks run offline. The agent keeps its
  network, the fix is public and the model may remember it, so the report has a separate contamination row
  (externalFetch, fixRecall). Host copies of the projects and the package caches are masked per run. Proofs:
  `node bench/real/validate-real.js` and `node bench/real/prove-mask.js`. Details in `bench/README-tasks.md`.
- `main` is the remote-tracking ref `origin/main` as last fetched (the runner never fetches), labelled
  `main-unreleased@<sha>`; run-config records origin and local SHAs and `behindOrigin`. Without it,
  local main is used with a warning.
- Every konductor arm is built from its own ref (CLI, synth, `skill-lookup-mcp`) via `git archive`, so
  a dirty tree never leaks in. Cache key: commit SHA; the MCP binary sha256 is stored with it and in
  run-config; a cache hit is rebuilt if the binary no longer matches.
- All arms are built, trial-installed and listed in a preflight table before any credit is spent;
  a failure aborts unless `--allow-partial`.
- After install, `model` in every `~/.kiro/agents/*.json` is rewritten to the pinned model
  (`modelNormalized`, `rewrittenAgents`). A parent session on another model (for example after a
  safety refusal) sets `modelMismatch` and status `error`. Subagent sessions record no model; the pin
  was checked by billing. Order: replicate-major, seeded shuffle of (task, arm) pairs (`--seed`); a
  budget stop skips whole later replicates when the next is projected to overshoot.

## opencode harness
A second harness runs the same tasks through `opencode run` on Amazon Bedrock. It has no vendor prompts of its
own to tune and reports real tokens and list-price USD instead of credits. One harness per run (`run` refuses
mixed arms, and `report` refuses a mixed directory); `compare` exits 2 across harnesses unless `--force`.
```bash
node bench/runner/bench.js run --suite lite --arms oc-vanilla,oc-v1.2.0,oc-main --out $OUT \
  --aws-creds-file ~/creds --aws-profile bench --budget-usd 5 [--effort high] [--repo-root DIR]
```
- Arms: `oc-vanilla` (empty config, no agent, built-in `build`), `oc-v1.2.0`, `oc-main` (local `origin/main`, no fetch).
  `opencode-ai@1.19.5` is installed with `npm --prefix <cache>/opencode-1.19.5` (scripts off, nothing global);
  version and binary sha256 go to run-config. `--opencode-bin PATH` overrides; `rg` must be on PATH or `--rg-bin`.
- Konductor arms install the ref's `claude` harness (`synth` + `install --harness claude`) into a scratch dir and
  translate it: tools list becomes a `permission` map, mux/cmux variants dropped, built-in agents disabled,
  101 skills (SOPs as `sop-<name>`) put in the scratch config. All of it lives in the scratch HOME, not the workspace.
- Permissions mirror each agent's `tools` list. The shipped orchestrator lists Write and Bash, so it may edit and run
  commands, as under kiro-cli `--trust-all-tools` (`@builtin`). `Agent(a, b)` limits `task` to a and b; Write/Edit
  both map to `edit` (opencode has one); Read adds `list`; unlisted tools and `question` are denied. Dropped: `Workflow`,
  `SendMessage`, `mcp__*`. Fidelity risk: prompts still name Claude tool names, skills load on demand (as with the
  kiro skills server) instead of being preloaded, and there is no MCP server. This is konductor content on a different runtime.
- `--effort` maps one to one to the opencode variant (`low|medium|high|xhigh|max`, default `high`). Subagents do
  not inherit the CLI variant (their sessions recorded `default`), so it is also written into every agent file;
  a session on another variant sets `variantMismatch`. `--title bench` is always passed: without it opencode makes an
  unmetered Haiku call for the session title.
- Credentials: `--aws-creds-file` is read-only input; only the named profile is copied to `<scratch HOME>/.aws`,
  `AWS_PROFILE`/`AWS_REGION=us-east-1` are set, the real `~/.aws` and the file itself are hidden in the namespace, and
  the copy is deleted when the agent exits and on any signal. Exact secret values are scrubbed from outputs
  (`credsRedacted`); `env.json` lists names only.
- Usage comes from the session database (`opencode db`), summed over the parent and every subagent session
  (stream and export carry the parent only). `tokens.total` = input + output + cache read + cache write;
  `costUsd` is list price (2 / 10 / 0.1 / 2.5 USD per M tokens for in / out / cache read / cache write on Sonnet 5.5).
  A timed-out run uses the rows present and sets `costCensored`. `credits` stays null. Flags: `usageMismatch`,
  `usageUnavailable`, `orphanSessions`, `variantMismatch`, `throttled`.
- Bedrock caches prompts for about 5 minutes, so a run started soon after another can read its cache: cost carries
  run-order noise (the seeded shuffle is kept). The model id, region, variant, version and start time are recorded.

## Skills actually used
Which skills and SOPs a run loaded is read after the fact from `stream.jsonl`; nothing is added to the runs (no hooks, no
extra servers, no config change). New runs write these `result.json` fields (all nullable): `skillsLoaded`
(`{name, via: get_skill|skill-tool, count}`), `skillQueries` (strings passed to `find_skills`), `sopsLoaded` (the SOP subset),
`skillBytesLoaded` (bytes of text the load calls returned), `skillCallsFailed` (errors, empty results, calls with no answer),
`findSkillsCalls`/`findSkillsEmpty`, `startupResourceCount`, `targetLoaded`, `targetAttempted`, `targetReachable`, `sopNameSource`
and `skillsScope`. `report` appends a "Skills actually used" section when any run has them.
```bash
node bench/runner/bench.js skills --run $OUT [--bench-dir DIR] [--repo-root DIR] [--json]   # read-only, any run dir
```
- kiro-cli: calls of the `konductor-skills` server in all sessions, subagents included. opencode: the `skill` tool in the parent
  session only (`skillsScope: parent-session`); subagent sessions are not in the stream.
- SOP names: a listing of the arm's `agent-sops/`, else the installed agent's `--agent-sop-filter`, else the `sop-`/`k-`/`kiro-`
  convention (`sopNameSource`). `targetLoaded` is null for vanilla arms and for targets that are agents, not skills or SOPs.
  `targetReachable` says whether the arm exposes the target to a tool call: kiro-cli serves SOPs as prompts only and limits
  `get_skill` to `--skill-name-filter`, so `targetLoaded` can be false by construction.
- `startupResources` (run-config, per arm) lists what loads at spawn without a tool call, with sizes: kiro-cli prompt and
  `resources` of the installed agent (rule files included); opencode primary agent file and the skill index (names and
  descriptions). Vanilla gets the built-in agent, best effort and unsized. `skills` on an old run sizes rule files from `--repo-root`.
- Limits: a load is a call that returned text; reading a `SKILL.md` with the file tool is not counted; bytes include JSON framing.

## Isolation, environment, safety
- Each run gets a scratch HOME and a fresh cwd under `/tmp/w-<random>/`, with a copy of the auth
  database (kiro-cli's `~/Library/Application Support/kiro-cli` on macOS, `~/.local/share/kiro-cli`
  elsewhere, copied to the same place under the scratch HOME) that is deleted when the agent exits. The agent and the check commands get an allowlisted
  environment (PATH, locale, proxies, TERM=dumb, TMPDIR, pins); `--env-keep` adds Kiro variables.
  Mandatory-MCP variables are never passed. `env.json` lists the final variable names.
- `--isolate auto` (default) uses `unshare --user --map-root-user --mount --pid --fork --kill-child`
  and aborts when the probe fails; `--isolate none` is the explicit opt-out. Inside: the real home,
  /tmp, /var/tmp and /dev/shm are read-only and only the run's scratch root is writable. Hidden (empty
  tmpfs for directories, /dev/null for files): `.aws .ssh .gnupg .kiro .konductor .claude .claude.json
  .config .docker .git-credentials .netrc .npmrc .pypirc`, shell and REPL history files, the kiro auth
  database, container-runtime sockets (docker, containerd, podman), `/tmp/ssh-*`, `/run/user/<uid>`,
  user-writable trees outside the home (hidden, or read-only if a PATH tool lives there), the bench
  `fixtures`, `tasks/solutions`, `tasks/stubs`, `tasks/hidden`, `tasks/partials`, every answer key and the output directory. Capabilities
  are emptied after setup (`setpriv`, no-new-privs), so the agent cannot remount or unmount anything.
- Site-specific cookie or token paths: `--hide PATH,..` or env `BENCH_HIDE_EXTRA=a,b` (names relative
  to the home, or absolute; files and directories). Not network isolated: the agent can reach any host
  the machine can, and sibling runs' scratch dirs stay readable when `--parallel` is above 1.
- macOS has no `unshare`, so there `--isolate auto` picks `--isolate sandbox-exec` and aborts when its
  probe fails. The runner wraps each command in `sandbox-exec -p <profile>` with a profile generated per
  run: writes to the real home (also through `/System/Volumes/Data`), `/tmp`, `/var/tmp`, the user temp
  dir and user-writable trees (including a user-writable `/usr/local`, as Intel Homebrew leaves it) are
  denied, except `~/Library` (system frameworks write caches and keychains there, but the dirs macOS runs
  code from, `LaunchAgents`, `Services`, `Scripts`, `QuickLook` and similar, stay denied) and the run's
  scratch root. The probe checks that scratch is writable, the home and temp dir are not, and a masked
  file cannot be read. The same
  hidden paths and masks as above are denied for reading, writing and Unix-socket connects (a denied
  read fails with "Operation not permitted" instead of showing an empty directory), plus the kiro-cli
  auth database under `~/Library/Application Support/kiro-cli` and launchd's per-session sockets under
  `/var/run/com.apple.launchd.*` (where `SSH_AUTH_SOCK` points), and the user's keychains under
  `~/Library/Keychains`. `open`, `osascript`, `launchctl`, `security` and `git-credential-osxkeychain`
  cannot run, so items whose ACL trusts those tools cannot be read without a prompt. Capabilities and the pid namespace have no equivalent, so a process the agent detaches
  with `setsid` can outlive the run. launchd stays reachable over Mach, and jobs it starts run outside
  the sandbox, so a program that submits a job without `launchctl` can still run code outside the
  sandbox, including writing a login item. securityd is also reachable over Mach, so a program
  that calls the Security framework directly can still ask for keychain items; items that do not
  trust it prompt the user, and an unattended run has no one to approve. Offline checks deny outbound connections except to localhost.
- Every `konductor` CLI call (synth, install) runs with a scratch HOME and the allowlisted environment,
  and refuses to start with the real HOME, so `~/.konductor/installs` and `~/.konductor/logs` are never written.
- Tripwire (always on): after each run the real HOME (depth 3), the repository and `--tripwire-dir` are
  scanned for entries newer than a marker. Hits go to `homeTripwireHits`. The `homeTripwire` flag is
  raised for any hit with `--isolate none`, for hits in the `~/Library` dirs macOS runs code from
  (`LaunchAgents`, `Services`, `Scripts`, `QuickLook` and similar) with `--isolate sandbox-exec`
  (system processes write elsewhere in `~/Library` all the time), and never with `--isolate unshare`, where a hit is another process (an IDE).
  With `none` or `sandbox-exec`, a scan that stops at its entry cap raises `homeTripwireTruncated`.
- SIGINT/SIGTERM/SIGHUP kills every agent group, removes scratch dirs and auth copies, writes
  `summary.json` with `interrupted`, and exits non-zero. The judge phase does the same for its calls.

## Metrics notes
- A run that times out or dies before its final metering event has unobserved spend: `creditsCensored`
  is true and `creditsLowerBound` is the known floor. The budget guard charges such a run the median of
  the arm's completed runs, or `--censored-floor` (default 1.0), stored as `creditsCharged`; reports use
  that value, never 0. Failure rates sit beside every cost figure. `turnDurationMs` is null without
  a `runFinished` event.
- `workToolCalls` leaves out the `subagent` call and the subagent `summary` pseudo-tool. Transcript
  size sums the parent and subagent sessions (`transcriptPartial` if one is missing). Other metering
  units are flagged. `askedUser` marks a final message that ends with a question, asks for approval,
  or stops for a reason other than `end_turn`. `skillsMcpOk` records whether a `konductor-skills` call
  succeeded; konductor arms run with `--require-mcp-startup`.
- A post-run failure keeps the run's credits and sets `infraError`; a socket or FIFO in the workspace is
  skipped by the snapshot. The cwd must hold no answer key. Checks: `file_exists`, `contains`,
  `not_contains` (flags `im`), `min_matches`, `labelled_findings`, `fixture_unchanged`, `cmd` (`sh -c`), one shared matcher.
- `recheck --run DIR` re-evaluates the current task checks against each run's saved `workspace/` (in a
  scratch copy) and rewrites only the check fields of `result.json`: `checks`, `checksAllPassed`,
  `checksRevision`, `checksRecheckedAt`; the first results stay in `checksOriginal`. Repeating it changes
  nothing until the task's checks change. `stream.jsonl` and credit fields are never touched. The report's
  "pass" then uses the rechecked results and says so. Judge bundles keep showing `checksOriginal`, so
  cached judge calls stay valid.

## Judging
- Judges run as a separate headless `kiro-cli chat --no-interactive --trust-tools=` call in their own
  scratch HOME and empty cwd, inside the same read-only namespace as the agent (`--isolate`, `--hide`).
  `--kiro-bin PATH` picks the binary; each call's raw stream is kept in `<out>/judge/raw/`.
- Judges come from `--judges`, else the suite file, else `gpt-5.6-luna`, `deepseek-3.2`, `glm-5`
  (`qwen3-coder-next`, `minimax-m2.5` also work). The judge phase refuses fewer than 3 model families
  unless `--allow-small-panel` (recorded in `judgments.json`, flagged in the report). One judge per
  family; Claude models and the subject model's family are refused.
- A judge sees the task, rubric, the fixture's `.bench-answer-key.md` and one output bundle: final text,
  files changed versus the fixture (`.kiro/specs/**` included; only tool state is skipped), check
  results. Never the transcript, tool calls or arm names. Arm-revealing phrases (agent and tool
  names, skill, SOP, steering, maker-checker, delegation, versions) are deleted, not replaced by a
  marker; deliverable paths stay. `--redact-file` adds rules; the rules that fired are recorded.
- Rubric mode scores each criterion pass/partial/fail (1/0.5/0, weighted, 0..1). A quote is found when
  every non-trivial segment between `...` or the ellipsis character appears in the bundle, in order,
  ignoring case, whitespace, quote marks and markdown emphasis. A verdict whose quote is not found drops
  one level (`evidenceDowngraded`). Each criterion records `verdictRaw` (the judge's) and `verdictScored`;
  each record has `score` and `scoreRaw`, and the report shows both per judge plus the share of quotes
  not found. Records carry a `taskRevision` (hash of prompt, rubric and answer key); records made against
  an older wording are left out of the report and listed. A unit skipped by `--budget-credits` never
  replaces an earlier result, and rubric calls run before pairwise calls so a cap covers every judge first. Pairwise mode
  compares each arm with the baseline twice with A/B swapped; disagreement is a tie (`positionInconsistent`).
- Runs with `infraError` or no kept workspace are not judged; they are listed in `notJudged`.
- Replies must be strict JSON; one retry, then `judgeError` is recorded. Results are cached by hash of
  (judge, prompt) in `<out>/judge/cache`. `spentCredits` and `spentByJudge` add up over invocations;
  a cached call costs 0 and keeps its original latency with `cached: true`.
- Other flags: `--mode`, `--concurrency 2`, `--budget-credits X` (per invocation), `--max-file-chars`,
  `--max-bundle-chars`, `--judge-cmd CMD` (test double: prompt on stdin, reply on stdout), `--auth-db`.

## Calibration
`calibrate export` writes a blinded `sheet.json`/`sheet.md` and a separate `key.json`. Fill the labels,
then `calibrate score` prints judge-vs-human and judge-vs-judge agreement, Cohen's kappa and Spearman
with PASS or WARN (defaults 0.6, 0.7, 0.6; `--kappa-min`, `--agreement-min`, `--spearman-min`). Under
about 30 criterion pairs is indicative only.

## Benchmark a PR or work in progress
Any commit or working tree can be an arm: `--arms vanilla,v1.2.0,pr-95=<ref>,wip=dir:<path>`. A name is
`[a-z0-9][a-z0-9._-]{0,40}`; `vanilla`, `main` and `vX.Y.Z` are reserved. A bare ref (`feat/x`) is refused.
- `name=<ref>` resolves in `--repo-root` without fetching: a local branch, tag, remote-tracking ref
  (`origin/feat/x`), `refs/pull/<n>/head`, or a commit SHA. It is built from `git archive`, so a dirty tree never leaks.
- `name=dir:<path>` snapshots tracked and untracked files that are not ignored (a plain copy skips `.git`,
  `node_modules`, `target`, `dist`, `build`) and labels the arm `name@<hash12>`, recorded as dirty.
- Each arm records ref, SHA, source, dirty, content hash, merge-base with `origin/main`, commits ahead and the
  top-level paths changed (names only) in run-config and every result.json.
Make the code local first; the runner never fetches. Fetch a pull request or a branch yourself:
```bash
git fetch origin pull/95/head:pr-95          # then pr-95=pr-95
git fetch origin feat/x                      # then pr-95=origin/feat/x
git worktree add --detach /tmp/wip HEAD      # edit files in /tmp/wip, then wip=dir:/tmp/wip
node bench/runner/bench.js pr-plan --ref pr-95=pr-95 --suite lite   # prints the commands and a budget, runs nothing
node bench/runner/bench.js run --suite lite --arms vanilla,v1.2.0,pr-95=pr-95 --replicates 3 --budget-credits 300 --out $OUT
node bench/runner/bench.js run ... --prepare-only                   # build and trial-install every arm, print the table, no agent
node bench/runner/bench.js judge --run $OUT --baseline v1.2.0       # pairwise against v1.2.0 instead of vanilla
node bench/runner/bench.js contrast --run $OUT --base v1.2.0        # contrast.md + contrast.json in $OUT
```
`contrast` compares each other arm with the base, overall and per task class: cost, wall clock, model, work-tool and
subagent calls (medians), hidden and regression test pass fractions, checks, rubric, and the flags (askedUser,
externalFetch, fixRecall, modelMismatch, timeouts). Each row shows n, both deltas and a verdict from the same noise
rule as `compare`; fewer than 3 runs a side gives "n too small". Failed runs stay in the counts. `compare` across two
runs reports a same-named arm that resolved to a different SHA as "arm changed" instead of refusing.
- One replicate is anecdotal. Use `--replicates 3` or more before calling a difference real.
- Orchestration costs more than a single agent; do not judge a konductor change on cost alone. Read the quality
  (hidden tests, checks, rubric) and autonomy (askedUser) columns next to it.
- A ref must exist locally; builds need the cargo offline cache or `--cargo-online`; a directory snapshot leaves
  out ignored files; a ref without `cli/konductor-rs` and `mcp` fails fast with the reason.

## Autonomy tier
Does a change need less help from the user? Every other prompt ends "Do not ask me questions", so no run ever asks.
The six `autonomy-*` tasks leave a decision open, and a scripted user (no model) answers whatever the agent asks.
- Measured per run: `turns`, `interjections` (scripted replies), `questions` (turn, text, matched clarifications),
  `unmatchedQuestions`, `askedFirstTurn`, `interjectionCapHit`, `autonomous` (no interjection), `intendedTests` and
  `invariantTests` (hidden test split), `completedWithoutHelp` (autonomous and both groups all pass) and
  `assumptionsStated` (a text heuristic on the last message). Cost, calls and wall clock add up over all turns.
- Intended tests follow the scripted answers; invariants hold under any reasonable reading (old behavior kept, no crash,
  no data lost). A wrong guess lowers intended, not invariants. One task needs no question (`noQuestionNeeded`), so
  asking there is over-asking; one is risky (delete files), so asking first is right.
- The scripted user: a turn that ends with a question, an approval request or a non end_turn stop is an ask. Each
  clarification has regex keywords; those that match the question and were not used yet are answered (several in one
  numbered reply); no match gets "Use your best judgment and continue." and counts as unmatched. After `maxInterjections`
  (4) it sends "Proceed with your best judgment now and do not ask further questions." once, sets `interjectionCapHit`,
  and the next turn ends the run. The timeout covers all turns together.
- Resume: `kiro-cli chat --resume-id <session id>` (`--resume` if no id was read), opencode `-s <session id>`, with the same
  cwd, scratch HOME and isolation, and the credential copy kept until the last turn. Per-turn streams are `stream-N.jsonl`.
  Checked once with kiro-cli 2.35.2 on a trivial two-turn task (0.15 credits): the resumed turn kept the session id and
  the earlier context, the model stayed pinned, and credits were summed over both turns. One run, so not a rate.
  To repeat it, point `--bench-dir` at a scratch directory with one ask-then-answer task and use `--budget-credits 3`.
- Run: `node bench/runner/bench.js run --suite autonomy --budget-credits 400 --out $OUT`, then `judge`, `report`,
  `contrast --run $OUT --base v1.2.0`. `report.md` gets an "Autonomy" section per arm: asked rate, mean interjections,
  questions on the no-question task and unmatched questions (shown apart), cap hits, intended and invariant tests,
  completed-without-help rate, interjections per successful run, cost and wall clock for all turns. `contrast` and
  `compare` gain `interjections`, `unmatchedQuestions`, `intendedFraction`, `invariantFraction`, `completedWithoutHelp`.

## Piloting orchestration options
Make an option an arm, run it against a release, and read quality, autonomy and cost together.
- Arm: a branch or tag as `opt-a=<ref>` (built from `git archive`), or a worktree as `opt-a=dir:<path>` (edits count, recorded dirty).
- Plan, runs nothing: `pr-plan --ref opt-a=<ref> --suite pilot --budget-credits 150` (also `--base v1.2.0`, `--base main`). The
  `pilot` suite is 8 tasks borrowed from lite (3), real (2) and autonomy (3, one needs no question); 1 replicate. There are no
  observed figures for autonomy tasks, so `pr-plan` refuses to guess a cap and wants `--budget-credits`.
- Sequence: `run --suite pilot --arms vanilla,v1.2.0,main,opt-a=<ref>`, then `contrast --run $OUT --base v1.2.0` (no credits),
  `judge --run $OUT --baseline v1.2.0`, `report --run $OUT --baseline v1.2.0`.
- Read three things together. Quality: hidden and regression tests, checks, rubric. Autonomy: `interjections`,
  `unmatchedQuestions`, `completedWithoutHelp` (fewer is better, but asking on the no-question task is over-asking). Cost:
  credits and wall clock with failed and timed-out runs included. Cheaper with lower quality or more help is not an improvement.
- Caveats: n=1 per cell is anecdotal; rerun the tasks that show signal with `--replicates 3`. Vanilla is at ceiling on small
  tasks, so look at cost, autonomy and the real and autonomy tiers. Wall-clock numbers need `--parallel 1` and nothing else
  using the Kiro account. The agent has open network (see the contamination row).

Observed credits for one pass, claude-sonnet-5.5 unless noted, n=1 per cell (a guide, not a forecast; `+` is a lower bound):

| suite (tasks) | vanilla | v1.2.0 | main |
| --- | --- | --- | --- |
| lite (5) | 6.78 | 23.31 | 31.01 |
| real (7) | 14.22 | 61.32 | 45.33+ |
| hard-A (6) | 20.06 | not run | not run |
| haiku-5.5, partial (1 task) | 0.42 | not run | 0.66 |

## Capability benchmarking (cap)
`cap` answers questions about one skill, SOP, agent or context file. Everything below is free: no model call, no credits.
- `cap list` shows the registry plus a scan of the tree at `--base` (default `v1.2.0`): owner, agents that reach each capability, tasks, gaps.
  `--init` prints skeleton registry entries for unregistered ones and writes nothing.
- `cap audit --base REF --harness kiro-cli|opencode|both` writes `cap-audit.md` and `cap-audit.json` and exits 1 on any error
  finding. `--base` takes a ref, `dir:PATH` or an arm spec; `--public` also scans registry text, task prompts and these docs for internal markers.
- `cap variant --scratch DIR --drop ID | --replace ID=FILE | --add ID=FILE --to-agent A | --preset skills-only|bare` builds a `dir:`
  arm from `git archive` of the base ref (never the working tree) and prints the `--arms name=dir:PATH` string. `--verify` builds it with
  the offline cargo cache and trial-installs it in a scratch HOME, then compares the installed skill, SOP and context lists with the ops.
- `cap plan --mode lift|trigger|improve --cap ID` prints the variant, run, contrast, judge and report commands and a credit estimate
  from the observed table. It refuses a task scored by checks alone unless `--allow-regex`, and refuses to guess credits without observed
  figures unless `--budget-credits X` is given. A skills-only change the acting agent cannot reach at startup stops with exit 2 unless `--force`.
- Registry: `capabilities/<kind>/<name>.json`, schema `schema/capability.schema.json`, checked by every `cap` command and by
  `node tasks/validate-tasks.js`. To add one: run `cap list --init --cap ID`, save the entry under its path, fill in `owner`, link tasks,
  then run `cap audit`. Only a person edits these files; stored query splits are never recomputed.
- Variants: ops edit a copy. `drop` removes the file and the name from every skill, SOP and context list of every agent spec and from
  `clientConfig.claudeCli.skills` (synth rejects a listed skill that has no directory). `variant.json` sits beside the tree, so it does
  not change the arm hash; it records the base commit, each op with before and after sha256, inbound references and the tree hash.
- Runner additions: `contrast --by task`; `--extra-tasks DIR` on `run`, `judge`, `report`, `contrast`, `recheck`, `skills` (tasks in
  `DIR/<id>.json`, `DIR/fixtures`, `DIR/hidden`, masked from the agent; check with `validate-tasks.js --only-extra --extra-tasks DIR`);
  `run` stops launching when charged credits plus the largest run so far would pass `--budget-credits`, and `--run-credit-limit X`
  kills one run past X credits and records it as censored.
- Reading the audit: tokens are bytes / 4, an estimate. "Unreachable" means no agent spec lists the capability, so no kiro agent can
  load it. A near-duplicate score is Jaccard on description words. Leakage fails above 5% shared 8-word shingles. Each `cap`
  command that builds hashes `~/.konductor/installs` before and after and exits 1 if it changed.

## How to read results
- Tokens are not exposed by kiro-cli; credits are the cost measure. `estTokens` is characters / 4.
- Efficiency cells are `median [95% bootstrap CI of the median]` over clean passes only: status success,
  no `infraError`, no `modelMismatch`, every check passed. Failures are rates beside every cost
  figure (timeout, error, infra, model mismatch, checks failed, budget-skipped). "credits per successful
  run" is all charged credits over clean passes, so failures raise it.
- Under 3 replicates per task is anecdotal (flagged), as are judges differing by over 0.2. Redaction
  hides names, not style; check calibration first.
- `compare` uses the same series. It refuses runs that differ in model, effort, task set, judge set,
  content hash, kiro-cli version, isolation mode or agent engine (exit 2, `--force` overrides) and exits 1 on any
  regression: worse by at least `--min-rel` (default 15%) and, with 3+ runs per side, disjoint CIs
  (`--rule any`: either).
