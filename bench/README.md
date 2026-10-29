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
`--model ID` (default claude-sonnet-5.5), `--effort LEVEL` (default high), `--seed N`,
`--isolate unshare|none|auto`, `--allow-partial`, `--censored-floor X`, `--env-keep NAME,..`,
`--hide PATH,..`, `--tripwire-exclude PATH,..`, `--tripwire-depth N`, `--tripwire-dir DIR,..`,
`--kiro-bin PATH`, `--cache DIR`, `--cargo-target DIR`, `--cargo-online`, `--bench-dir DIR`. `--suite lite|full|hard`.
More than 10 planned runs need `--budget-credits`; `run` prints the worst-case wall clock and the cap first.

## Suites and arms
- lite: vanilla, v1.2.0, main; 1 replicate, `--parallel 1` (wall-clock comparisons need 1). full: all
  five arms, 3 replicates. hard: six tasks with hidden acceptance tests, three arms, 3 replicates, `--parallel 1`.
  `run --suite hard` scores each run by the share of hidden tests passed; the report shows it as
  "hidden tests passed" (mean fraction, and how many runs pass all) beside "pass". See `bench/README-tasks.md`.
  Hidden tests, partial solutions, solutions and fixtures are masked in the agent's namespace.
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
  database that is deleted when the agent exits. The agent and the check commands get an allowlisted
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
- Tripwire (always on): after each run the real HOME (depth 3), the repository and `--tripwire-dir` are
  scanned for entries newer than a marker. Hits go to `homeTripwireHits`; the `homeTripwire` flag is
  raised only with `--isolate none`, because inside the namespace a hit is another process (an IDE).
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

## How to read results
- Tokens are not exposed by kiro-cli; credits are the cost measure. `estTokens` is characters / 4.
- Efficiency cells are `median [95% bootstrap CI of the median]` over clean passes only: status success,
  no `infraError`, no `modelMismatch`, every check passed. Failures are rates beside every cost
  figure (timeout, error, infra, model mismatch, checks failed, budget-skipped). "credits per successful
  run" is all charged credits over clean passes, so failures raise it.
- Under 3 replicates per task is anecdotal (flagged), as are judges differing by over 0.2. Redaction
  hides names, not style; check calibration first.
- `compare` uses the same series. It refuses runs that differ in model, effort, task set, judge set,
  content hash, kiro-cli version or isolation mode (exit 2, `--force` overrides) and exits 1 on any
  regression: worse by at least `--min-rel` (default 15%) and, with 3+ runs per side, disjoint CIs
  (`--rule any`: either).
