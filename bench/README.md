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
node bench/runner/bench.js report --run $OUT                        # report.md, report.html, report.json, charts/ in $OUT
node bench/runner/bench.js run --suite pilot --profile detailed --out $OUT   # 5 replicates, an A/A arm, graded judging, a calibration sample
node bench/runner/bench.js report --run $A,$B,$C --verdict platform --out $V  # keep, discard or not enough evidence per arm: verdict.md and .html
node bench/runner/bench.js compare --base $OLD --head $OUT          # regression check
node bench/runner/bench.js recheck --run $OUT [--dry-run]                    # re-apply corrected task checks to saved workspaces
node bench/runner/bench.js backfill --run $OUT [--credits] [--skills] [--write]  # repair finished runs from stream.jsonl: credits (default) and/or skill-load fields (dry run by default)
node bench/runner/bench.js calibrate export --run $OUT --n 25 --seed 1   # then: calibrate score
node --test "bench/runner/test/*.test.js"                           # unit tests
node bench/tasks/validate-tasks.js                                  # tasks vs reference solutions
```
Run flags: `--arms a,b`, `--tasks id,id`, `--replicates N`, `--parallel N`, `--budget-credits X`,
`--model ID` (default claude-sonnet-5.5), `--effort LEVEL` (default high), `--agent-engine v2|v3` (default v2), `--seed N`,
`--isolate auto|unshare|sandbox-exec|none`, `--allow-partial`, `--censored-floor X`, `--env-keep NAME,..`,
`--hide PATH,..`, `--no-default-hide`, `--tripwire-exclude PATH,..`, `--tripwire-depth N`, `--tripwire-dir DIR,..`,
`--kiro-bin PATH`, `--cache DIR`, `--cargo-target DIR`, `--cargo-online`, `--bench-dir DIR`, `--real-cache DIR`, `--prepare-only`.
`--suite lite|full|hard|real|autonomy|pilot|cap` (`cap` is the fallback the `cap` commands use; they name their arms).
No credit cap is the default: every run is a line in `credit-ledger.jsonl` in the results directory and `run` prints the running total. `--budget-credits X` is an optional guard
that stops new runs at 90% of X; a run that carries the command past 100% ends it with exit code 3. `run` prints the worst-case wall clock first. See "Profiles, credit ledger and platform verdict".
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

## Claude Code harness
A third harness runs the same tasks through `claude -p` (Claude Code) on Amazon Bedrock, so a study can cross harness
(Kiro CLI, Claude Code) with konductor (off, on) on one model. Like opencode it is a USD cell: real tokens and the
list-price cost the stream reports, `credits` null. One harness per run; `compare` exits 2 across harnesses unless `--force`.
```bash
# credentials: export them in the shell that starts the bench (names below), then
node bench/runner/bench.js run --suite lite --arms cc-vanilla,cc-main --out $OUT \
  --budget-usd 5 [--run-budget-usd 1] [--aws-region us-east-1] (--claude-bin PATH | --claude-tools-dir DIR) [--repo-root DIR]
bash bench/scripts/claude-code-smoke.sh --profile NAME      # the checked first run; see "Smoke test" below
```
- Arms: `cc-vanilla` (empty config dir, no `--agent`), `cc-main`, `cc-name=<git ref>` (same grammar as `oc-`). A konductor arm is
  built from its own source tree, `synth`-ed, and installed with `konductor install --harness claude` into each run's scratch
  HOME (the install writes absolute paths, so it is repeated per run). It starts in `--agent konductor`. The ref must carry the
  dashed model pin (`model: claude-sonnet-5-5`) on every agent: a dotted pin is not a Bedrock id and sub-agent spawns fail, so
  the install is refused with that reason, as is any install that does not give exactly 11 agents.
- The binary: `--claude-bin PATH` (`BENCH_CLAUDE_BIN`), or the newest `<version>/claude` under `--claude-tools-dir DIR`
  (`BENCH_CLAUDE_TOOLS_DIR`). There is no default location. A launcher script is refused (the resolved file must be named
  `claude` and be at least 50 MB): a launcher can override the model, region and credentials, so a vanilla arm through it is
  not vanilla. Version, path and sha256 go to run-config.
- Command: `claude -p PROMPT --output-format stream-json --verbose --model us.anthropic.claude-sonnet-5-5 --max-budget-usd N
  --permission-mode acceptEdits [--agent konductor] [--include-hook-events] --allowedTools Bash Edit Write Read`, stdin from
  `/dev/null`. `--max-budget-usd` is `--run-budget-usd` (default 5). `--effort`, `--stop-on`, `--max-tool-calls`,
  `--run-credit-limit`, `--aws-creds-file` and `--agent-engine` are refused for these arms; the effort level is not passed to
  claude, so results say `effort: default`. Multi-turn (autonomy) tasks are not supported yet.
- Credentials come from the environment of the shell that starts the bench: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and
  `AWS_SESSION_TOKEN`, for example from `aws configure export-credentials --format env`. They go to claude through its
  process environment only; no file is written. `AWS_PROFILE`, `AWS_DEFAULT_PROFILE`, `AWS_CONFIG_FILE` and
  `AWS_SHARED_CREDENTIALS_FILE` are never passed on: with a profile set, the SDK skips the exported keys and the run fails with
  `cloud_credential_error`. That failure is recorded as an infra error, not a model failure. Exact secret values are scrubbed
  from every output file; run-config and `env.json` list variable names only.
- Isolation: per run, `HOME` and `CLAUDE_CONFIG_DIR=<HOME>/.claude` are scratch, `<config>/rules/empty.md` is the only rules
  file (the invoking user's rules never load), telemetry, auto-update and error reporting are off. Built-in agents (`Explore`,
  `general-purpose`, `Plan`, ...) and skills exist even in the vanilla arm, so vanilla is not empty; run-config says so.
- Model identity: a run counts only if every `modelUsage[*].canonicalModel` and every assistant `message.model` (main agent and
  sub-agents, `<synthetic>` ignored) equals the canonical model of `--model` (`claude-sonnet-5-5` for
  `us.anthropic.claude-sonnet-5-5`). Anything else sets `modelMismatch`, status `error`, and the run is left out of the
  medians. The `modelUsage` keys are not compared: they legitimately differ between the main agent (profile id) and sub-agents.
- Cost and tokens: `costUsd` is `total_cost_usd` of the last `result` line, tokens are the sums of `modelUsage`
  (`costBasis: list`). A session that resumes after a background task prints a second `result` line; totals are cumulative, so
  the last is used and durations are summed. A run killed before its `result` line (timeout, SIGTERM, exit 143) has
  `costCensored: true`, `tokens` as a lower bound from the assistant messages seen, and `costUsd` null unless per-million rates
  are supplied in `ctx.claudeRates`; the budget ledger then charges the arm median or the censored floor.
- Orchestration metrics: spawn count is `subagent_stats.spawned` (failed spawns included), depth comes from the
  `parent_tool_use_id` chain and `subagent_stats.max_depth`; review rounds and reworks read the `Agent` tool input and the
  sub-agent's notification summary. Skill loads are `Skill` tool calls and reads of a `SKILL.md`, in all sessions.
  `result.json` gains `claudeCode` (models seen, `modelUsage` keys, cost basis, hook events, permission denials, spawn counts,
  where the task directory landed). A denied tool call exits 0; it shows as the `permissionDenied` flag and a count.
- Cleanup: `TMPDIR` is the run's own directory. Claude Code writes task output to `<tmp>/claude-<uid>/<cwd slug>/`; each run
  removes that directory under its TMPDIR and under the default temp directory (the slug is unique to the run, so parallel runs
  never touch each other). `claudeCode.tmpCleanup` records which one held it.
- Smoke test: `claude-code-smoke.sh` runs one vanilla and one delegating konductor task (about $0.2 to $0.5), checks the
  credentials under claude's exact environment first, prints PASS/FAIL per criterion (schema, success, cost > 0, one canonical
  model, at least one spawn and no failed spawn, 11 agents with the pin, no credential value in any output, nothing left in
  `/tmp/claude-<uid>` or the scratch directories) and removes what it made. `--dry-run` shows the plan without credentials.
- Known gaps: `askedUser` is true only when the `AskUserQuestion` tool is called (the name is in the binary; no recorded stream
  has it), otherwise the final-text detector decides. Whether claude honors `TMPDIR` for `/tmp/claude-<uid>` is not verified (the
  smoke script reports it). The `global.` inference profile is untested (the default is `us.`). Only the `SessionStart` hook
  was seen under `-p`; the `--include-hook-events` flag is passed to konductor arms when the binary has it. The skill startup
  size (`startupResources`) is not measured for this harness.
- Where it plugs in (for reviewers): `runner/lib/harness/claude-code.js` and `claude-code-parse.js`; `harness/runtime.js`
  (`runtimeOf`, `isUsdRuntime`) and `harness/index.js`; `arms.js` (`cc-` prefix) and `profiles.js` (A/A repeat prefix);
  `run-cmd.js` (flags, guards, config, run-config record); `run-one.js` (post-run `cleanupRun`); `result.js` and
  `schema/result.schema.json` (`claudeCode`, harness enum, canonical model check); `skills.js` (Claude load extractor);
  `orch-metrics.js` (accepts a spawn tree); `report/aggregate.js` (`BASIS`, baseline), `report/render.js`, `report/compare.js`;
  `report/load.js` and `report/orchpass.js` (`cellKeyOf`) needed no change. The credit meter and early-stop watcher read kiro-cli
  and opencode events only, so their flags are refused here.

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
- The arm build (cargo on the ref under test) also gets an allowlisted environment: PATH, locale, TERM, toolchain variables (CC, CFLAGS, LDFLAGS,
  LD_LIBRARY_PATH, PKG_CONFIG_PATH, RUSTFLAGS and similar) and, for `--cargo-online` only, the proxy variables. Cloud, forge, registry and agent
  credentials and the SSH agent are not passed. HOME is a scratch directory removed after the build; CARGO_HOME and RUSTUP_HOME point at the real
  ones so an offline build finds its crates. `BENCH_BUILD_ENV_KEEP=NAME,NAME` adds more variables; a credential-looking name is refused.
  Residual risk: a build script of an arbitrary ref still runs as you and can read any file you can read, including the real CARGO_HOME. Build only
  refs you trust, or build on a host with nothing in that account to lose.
- `run` records `env.json` with the interpreter versions (node, python3, python, pytest). `tasks/toolchain/pins.json` lists the versions the checks
  were validated with; a mismatch is logged and kept in `run-config.json` as `toolchainCheck`, and never fails the run.
- `--isolate auto` (default) uses `unshare --user --map-root-user --mount --pid --fork --kill-child`
  and aborts when the probe fails; `--isolate none` is the explicit opt-out. Inside: the real home,
  /tmp, /var/tmp and /dev/shm are read-only and only the run's scratch root is writable. Hidden (empty
  tmpfs for directories, /dev/null for files): `.aws .ssh .gnupg .kiro .konductor .claude .claude.json
  .config .docker .git-credentials .netrc .npmrc .pypirc`, shell and REPL history files, the kiro auth
  database, container-runtime sockets (docker, containerd, podman), `/tmp/ssh-*`, `/run/user/<uid>`,
  user-writable trees outside the home (hidden, or read-only if a PATH tool lives there), the bench
  `fixtures`, `tasks/solutions`, `tasks/stubs`, `tasks/hidden`, `tasks/partials`, every answer key and the output directory. Capabilities
  are emptied after setup (`setpriv`, no-new-privs), so the agent cannot remount or unmount anything.
- Also hidden by default, on top of that list: the single-sign-on cookie and token directories, `.gitconfig`,
  `.cargo/credentials*` (the files only: `.cargo/bin`, `.rustup`, `.cache` and the language toolchains stay
  readable), and the cloud-CLI and password-store credentials `.kube .azure .oci .vault-token .pgpass .my.cnf
  .s3cfg .boto .password-store .gem/credentials .terraform.d/credentials.tfrc.json .local/share/keyrings`.
  `--no-default-hide` (or env `BENCH_NO_DEFAULT_HIDE=1`) turns off only this added set; the list above and
  `--hide` extras are unaffected. `run-config.json` records `isolation.hideInHome` (the effective list, empty
  with `--isolate none`), `isolation.hide` (extras) and `isolation.defaultHide`.
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
- Engine v3 reports credits only at turn end (a `turn_completion` summary in the stream), never before. So on v3 a mid-run credit limit
  (`--run-credit-limit`) cannot trip and the live total stays at 0 until each run finishes (`--budget-credits` still stops new runs between
  runs). A killed or timed-out run has no credit data at all: it is censored, with a lower bound of 0. The summary also lists the tools the
  sub-agents used, so it appears to cover their spend (seen on one coordinator run). `modelCalls.meteringEntries` counts turns on v3, not model calls. v3 names a tool call by title, so tool names are mapped from the titles in `lib/stream.js` and unmapped
  titles count as `unknown`; a sub-agent call is "Sub-agent: <name>" with the target in `rawInput.name`.
- `backfill --run DIR [--credits] [--skills] [--write]` repairs v3 runs saved before the runner could read this, from each `stream.jsonl` with
  the runner's own parsers. DIR is one cell (`<study>/claude`). It is a dry run without `--write`. Run it after the cell finishes. Repeating it
  changes nothing. `--credits` is the default when no mode flag is given; `--skills` adds the skill pass, and both flags run both passes, credits first.
  - Credits: recomputes credits, turn duration, tool names and the spawn metrics. `--write` keeps `result.json.pre-backfill`, adds `creditsBackfill`, and
    appends a `backfill` line to `credit-ledger.jsonl` (earlier lines are never edited). A timed-out or killed run stays censored; the dry run flags one
    whose `result.json` also lacks the spawns its stream shows.
  - Skills: recomputes the skill fields (`skillsLoaded`, `skillCallsFailed`, `targetLoaded` and the rest of `SKILL_FIELDS`) and `capInvocation`, which the
    orchestrator pass rule and the cap reports read. It prints skill loads per arm before and after. `--write` keeps `result.json.pre-skills-backfill`
    (a separate name, so a copy from the credit pass is never touched) and adds `skillsBackfill`. A killed or timed-out run is included, because its skill
    calls are in the stream even though its turn never ended; no credit field is touched. A run with no stream, a task missing from `--bench-dir`, a
    budget skip or an opencode run is skipped. `--bench-dir` and `--repo-root` work as for `skills`. A run whose copy exists and differs is refused.
- Skill loads on engine v3: a loaded skills-server call is titled `@konductor-skills/get_skill` with the name in `rawInput.arguments.name`. A call
  made before the tool was loaded is refused (`Tool Call` failed, or a bare `get_skill` title with no input) and counts in `skillCallsFailed`, never as a
  load; the model then loads the tool and retries. `--stop-on` ignores refused calls too. The skill fields in `result.json` are written when the run
  ends, so runs saved by an older runner keep empty `skillsLoaded`; `bench.js skills` recomputes from `stream.jsonl` without writing, `backfill --skills` writes the recomputed fields, and `report` reads `result.json`.
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
  a cached call costs 0 and keeps its original latency with `cached: true`. Only a reply that passes the same check
  (valid JSON, right shape) is cached. A stored reply that fails it is not replayed: the judge is asked again and the old file is
  kept as `<key>.rejected.json`.
- `--mode graded` asks the judge to grade both responses of a pair 1 to 5, once with the baseline in position A and once with it in B. A record keeps the mean grades, the
  difference, and `orderDisagreement` (one order favored the arm, the other the baseline). The report lists the disagreement rate; above 25% it says the judges follow position.
  Graded grades are shown beside the quality score and never feed it, so `scoring.json` still decides quality.
- Other flags: `--mode rubric,pairwise,graded`, `--profile`, `--concurrency 2`, `--budget-credits X` (per invocation; stops new calls at 90%), `--max-file-chars`,
  `--max-bundle-chars`, `--judge-cmd CMD` (test double: prompt on stdin, reply on stdout), `--auth-db`.
  `--judge-backend kiro|opencode` picks the program that asks the models (see "Judge backends" below).

### Judge backends
`--judge-backend kiro` (the default) asks the panel through kiro-cli. `--judge-backend opencode` asks the same panel through `opencode run` on Amazon Bedrock.

Why. kiro-cli puts its own agent prompt and tool definitions in front of every judge prompt. On 252 saved judge calls that was about 7.2k to 11.4k tokens of non-judge context per call, over half of the input for a median call. A replay of 159 cached prompts through a bare model path (one-line system prompt, no tools) differed from the kiro answers in two places. gpt-5.6-luna pairwise: kiro returned a tie for 21% of prompts against 7%, and 8 of 14 pairs changed with answer order against 0 of 14. deepseek-3.2 rubric: 11 partial and 6 fail out of 162 criteria on kiro against 4 partial and 0 to 1 fail. The samples are small. The Bedrock model behind a name may also differ from the model kiro serves under that name (version, reasoning setting, sampling), so a difference does not show that the wrapper caused it. The backend lets a study be judged without the wrapper, and judging a copy of a directory on the other backend gives a cross-check.

Set up.
- An AWS shared-credentials file with a profile that can invoke the models in one region, passed as `--aws-creds-file FILE` (`--aws-profile`, default `bench`; `--aws-region`, default `us-east-1`). Per call, only that profile is copied into the call's scratch HOME, and the copy is deleted when the call ends. Credential values are scrubbed from the kept raw output and from error messages.
- opencode: `--opencode-bin PATH`, or leave it out and the bench installs `opencode-ai@1.19.5` with install scripts off, as for the opencode harness (`--cache DIR`, default `$TMPDIR/b-cache`). The version and the binary's sha256 are recorded.
- `--judge-backend opencode` cannot be combined with `--judge-cmd`.

What a call is. One `opencode run` per judge call, in its own scratch HOME, XDG directories and empty working directory, with an allow-listed environment (no inherited credentials or login tokens), the model catalog fetch off and every tool and built-in agent off. The prompt goes in unchanged as the user message through stdin, so the argv size limit does not apply (the 120000 byte check stays on the kiro path). The system prompt is fixed and its hash is recorded in `judgments.json`: "You are an evaluator. Reply only with the JSON object the user asks for." opencode adds two things the bench cannot switch off: a line naming the model, and a small environment block (working directory, platform, date), about 100 tokens a call.

Panel ids stay the logical names, so the family rules (never Claude, never the subject's family, at least 3 families, the GPT-subject substitution) are unchanged. The backend maps them:

| panel id | Bedrock model id | temperature |
|---|---|---|
| gpt-5.6-luna | global.openai.gpt-5.6-luna | not sent (see below) |
| deepseek-3.2 | deepseek.v3.2 | 0 |
| glm-5 | zai.glm-5 | 0 |
| qwen3-coder-next | qwen.qwen3-coder-next | 0 (us-east-1 only) |
| minimax-m2.5 | minimax.minimax-m2.5 | 0 |

A raw Bedrock id is refused as a judge name (its family would read differently); an id with no mapping is refused before any call.

Temperature. gpt-5.6-luna rejects the temperature field on Bedrock, so luna cannot run at temperature 0; it uses the model's default sampling, and opencode also sends reasoning effort "medium" for it, which a raw Converse call does not. For the other four the agent asks for temperature 0 and the model entry allows a temperature, because opencode drops the value for a model it does not know to accept one. This was checked on opencode 1.19.5 by capturing the request it sends to a local stand-in endpoint (no model call): temperature 0 was sent for those four, none for luna, and minimax-m2.5 also gets top_p 0.95 and top_k 40 from opencode's defaults. opencode's log and session database do not record the request, so a run cannot confirm this per call. `judgments.json` records `temperatureApplied` per judge as configured, not as observed.

Cost and limits. Tokens and USD come from opencode's session database for the call (USD is opencode's list-price figure; if the database cannot be read, the event stream totals are used and the call says so). Credits stay 0. Each call is a line in `credit-ledger.jsonl` with `unit: "usd"` and a `usd` field; credit totals and the credit guard never count it. `--budget-usd X` stops new calls at 90% of X and exits 3 past 100%; `--budget-credits` is refused with this backend and `--budget-usd` with kiro. A throttled call is retried with exponential backoff (2 s, doubling, capped at 60 s, up to 6 tries; failed tries cost nothing). `--concurrency` still applies (default 2). Each call also pays opencode's start-up, about 3 s, and about 1 s more to read the database.

One backend per results directory. Judging a directory that already holds judgments from the other backend is refused (judgments written before the label existed count as kiro); judge a copy instead. The cache key includes the backend, the system prompt hash, the Bedrock id and the temperature setting, so kiro and opencode answers never serve each other, and kiro keys are unchanged. `judgments.json` gets `backend` and, for opencode, `backendInfo` (opencode version, binary sha256, region, system prompt and hash, the Bedrock id, agent and temperature per judge) plus `spentUsd` and `spentUsdByJudge`. `report` names the backend and, for several directories pooled with `--run A,B`, flags directories judged on different backends as not comparable; `--profile detailed` lists that as a shortfall.

```
node bench/runner/bench.js judge --run V/claude --judge-backend opencode --aws-creds-file CREDS --aws-profile bench --aws-region us-east-1 --profile detailed --budget-usd 25
node bench/runner/bench.js report --run V/claude --profile detailed
```

## Calibration
`calibrate export` writes a blinded `sheet.json`/`sheet.md` and a separate `key.json`. Fill the labels,
then `calibrate score` prints judge-vs-human and judge-vs-judge agreement, Cohen's kappa and Spearman
with PASS or WARN (defaults 0.6, 0.7, 0.6; `--kappa-min`, `--agreement-min`, `--spearman-min`). Under
about 30 criterion pairs is indicative only.

`cap review --run DIR` is the same check with the outputs side by side. It writes `DIR/calibration/review/review.html`, one static file
with the data, style and script inline: it loads nothing, opens no port and needs no server (a Content-Security-Policy allows only its own
script and style, and no connections). It draws the runs `calibrate export` would draw, with n and seed taken from `calibration-sample.json`
when the detailed profile wrote one, and for each drawn task and replicate shows every arm's run of it (`--sample-only` shows the drawn
runs alone). The outputs are the judge bundles, with the same redaction and then credential scrubbing. Each task's outputs carry the
letters A, B and so on in a seeded random order. Which arm is behind each letter is kept in `review-key.json`, which goes to its own
directory, `DIR/calibration/review-key/` by default (`--key-out DIR`; a key directory that is the page directory or inside it is refused),
so the page directory holds only `review.html` and can be handed to the rater whole. If the page directory already holds what a review
or an import writes (`review-key.json`, `key.json`, `sheet.json`, a `raters/` directory, an `.import-*` staging directory, or a
temporary `*.json.tmp-PID` of one of those files), `cap review` refuses and writes nothing, even with `--force`: move or delete it first.
Other files there, such as a downloaded `ratings-*.json`, are left alone. The key records the run directory relative to itself and no absolute path, and the page's
viewer id does not depend on where the run is. For each output it also records a hash of what the rater saw: the `stream.jsonl`
bytes, the shown checks (`checksOriginal` when a recheck kept them, else `checks`), the questions and turns, and the raw bytes of the
workspace files the bundle was built from. A `recheck` does not change it.
The rater marks each criterion pass, partial or fail (an evidence quote and notes are optional), the
browser keeps the ratings in local storage, and Download ratings saves them as a JSON file. Load ratings resumes from such a file.

`cap review-import --ratings FILE --key DIR/calibration/review-key/review-key.json` checks the file against the key (same page, known items
and criteria, verdicts pass, partial, fail or null) and joins each letter back to its arm, task and replicate. `--key` is always
required; a key is never looked for next to the page or the ratings. The run is found from the key's own location, so a run moved
together with its key still imports; for a run moved without its key, pass `--run DIR`. An import refuses a directory that lacks the
key's runs, or where any rated output no longer shows what the page showed (a re-run in the same layout, a changed stream or
an edited workspace file), and names the first such output. A key from an older or unknown version is refused with the advice to regenerate the page
with `cap review --run DIR`; ratings made on the old page will not import. Ratings are kept per rater in `raters/ID/` beside the key; the id is `--rater ID`, else the Rater name typed on the page. A file that rates no criterion, or has no
rater id, is refused. Importing a rater that is already on file is refused unless `--force`, so a second import never replaces the first.

With several raters on file, each is scored alone (`raters/ID/result.json`), and all of them are pooled for the combined result: the
`sheet.json` and `key.json` beside the key (the key names the run relative to itself) list every output once per rater, so each rater's labels count as their own criterion pairs
against each judge in the same kappa, agreement and Spearman code `calibrate score` uses. The command prints that table, says how many
evidence quotes were found in the output (the judges' quote rule), and saves the pooled result, with each rater's figures under `byRater`,
to `DIR/calibration/result.json`, where `report` and the detailed profile look for it. A `result.json` that this page did not write is
kept unless `--force` or `--save FILE`. A refused import writes nothing, and an import that fails partway leaves the
rater off file: it scores in a staging directory beside the key (removed when the import ends; a stale staging directory from a
killed run is cleared by the next import), then writes the backup, the per-rater and pooled files and the result, and the rater's own
`ratings.json` last. Rater, criterion and item ids are plain ids, so names such as `__proto__` work. A new rater id needs no `--force`; only replacing a rater
already on file does. Before each import rewrites the pooled result, the one it replaces is copied to `result.prev.json` beside it
(one level: an older `result.prev.json` is replaced).

Each rater's kappa is shown next to the pooled one: the lowest judge-vs-human kappa for that rater, the same reduction the report
applies to the pooled result. The import prints them, `result.json` keeps them under `raterKappa`, and the report's Human calibration
row lists them after the pooled kappa with the lowest in bold. A rater under the kappa bar used for the pooled value (0.6 by default,
`--kappa-min` on import) is marked "below". The row's status still follows the pooled kappa.

```
node bench/runner/bench.js cap review --run V/claude
node bench/runner/bench.js cap review-import --ratings ~/Downloads/ratings-VIEWER.json --key V/claude/calibration/review-key/review-key.json --rater alice
```

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
`cap` answers questions about one skill, SOP, agent or context file. `list`, `audit`, `variant`, `plan`, `prune-report`, `skill-plan`, `decide` and `criteria` are free; `draft`, `trigger`, `skill-study` and live runs spend credits.
- `cap list` shows the registry plus a scan of the tree at `--base` (default `v1.2.0`): owner, agents that reach each capability, tasks, gaps.
  `--init` prints skeleton registry entries for unregistered ones and writes nothing.
- `cap audit --base REF --harness kiro-cli|opencode|both` writes `cap-audit.md` and `cap-audit.json` and exits 1 on any error
  finding. `--base` takes a ref, `dir:PATH` or an arm spec; `--public` also scans registry text, task prompts and these docs for internal markers.
- `cap prune-report --base REF --runs-glob 'DIR/*' [--evidence FILE]` recomputes skill loads from the streams of every finished, non-vanilla run and writes one
  recommendation per skill and harness: HARMS, RELOCATE, PRUNE, FIX, KEEP or NEEDS DATA, plus a TRIM flag. Free, read-only, never a deletion.
  How to evaluate skills and decide keep, fix, trim, relocate or prune: [CAP-PLAYBOOK.md](CAP-PLAYBOOK.md).
- `cap variant --scratch DIR --drop ID | --replace ID=FILE | --add ID=FILE --to-agent A | --preset skills-only|bare` builds a `dir:`
  arm from `git archive` of the base ref (never the working tree) and prints the `--arms name=dir:PATH` string. `--verify` builds it with
  the offline cargo cache and trial-installs it in a scratch HOME, then compares the installed skill, SOP and context lists with the ops.
- `cap scenarios --cap ID,ID [--n 8] [--dry-run]` drafts 8 to 30 task scenarios per skill into `DIR/scenarios/<id>.json` and `.md` for review. `--dry-run` writes the prompt only: no model call, no login, no credits.
- `cap scenarios --cap ID --mode trigger [--n 10] [--seed-queries FILE] [--dry-run]` drafts tasks for a skill that rarely loads: `--n` (8 to 10, default 10) tasks that should make the agent load it on its own and as many near misses that should not, into `DIR/scenarios/<id>.trigger.json` and `.md`.
  It follows skill-creator's trigger eval method (Description Optimization, step 1): realistic, concrete requests in varied phrasings that never name the skill, and near misses that share its words but belong elsewhere rather than unrelated requests.
  The checks: no prompt names the skill in any one-term spelling (joined by nothing or one hyphen, underscore, dot or space, any case; never across a sentence end or a line: `backend_review`, `Backend Review`), no more than 2 should-trigger prompts open with the same three words, each near miss lists the terms it shares with the skill text (each must appear as a whole word in both), and at least half name the neighbour they belong to.
  `--seed-queries` takes a skill-creator eval set (`[{ query, should_trigger }]`) or a `cap draft` file as starting intents. The file also has a `queries` view, so `cap trigger --queries DIR/scenarios/<id>.trigger.json` measures organic triggering on the same set. The draft is unreviewed: a person deletes, edits and turns the approved ones into tasks.
- `cap controls --out DIR` writes a planted-lift skill and a decoy skill with one task each and prints the variant, run and check commands; `cap controls --check RUN ...` exits 0 only when the planted lift was found and the decoy showed none.
- `cap plan --mode lift|trigger|improve --cap ID` (pass `--tasks id,id` when the registry links no lift task) prints the variant, run, contrast, judge and report commands and a credit estimate
  from the observed table. It refuses a task scored by checks alone unless `--allow-regex`, and refuses to guess credits without observed
  figures unless `--budget-credits X` is given. A skills-only change the acting agent cannot reach at startup stops with exit 2 unless `--force`.
- `cap variant ... --overlay skill:NAME=DIR` replaces `SKILL.md` and adds `references/**` from DIR in one step (a section moved out of a skill). Only those paths are accepted, links and other files are refused, and an existing reference file is never overwritten.
- `cap skill-plan --base REF --runs DIR[,DIR] [--tier ...] [--only a,b]` plans the per-skill study: the tiers (loaded, large, duplicates, triage), the tasks that exercise each skill, the sections that can be tested, the waves and credit, judge and wall-clock estimates from the per-run figures in the run directories. Free; `--out DIR` writes `skill-plan.md` and `.json`. `--forced-load low-load|always` adds the forced wave as its own line with its formula (3 arms x tasks x reps x qualifying skills), outside the totals; under low-load a skill qualifies when its load rate in the runs on file is known and under 30%. `bench/scripts/run-skill-bench.sh` takes `--forced-load low-load|always|off`, `--forced-held-min X` and `--waves 1|all`, checks them before anything runs, and passes all three to every `cap skill-study` call (init, dry run, run, resume, the daemon child); a dry run with no study passes only `--forced-load` to the plan, which estimates every wave. `run-skill-bench.sh --waves 1` is the way to run wave 1 only through the script.
- `cap skill-study --study DIR` runs that plan and `cap decide --study DIR` reads it. The study directory holds `study.json`, one folder per skill (`w1`, `w2`, `w3`, markers, overlay files), `controls/`, `incomplete/`, `logs/` and `decisions/`. `bench/scripts/run-skill-bench.sh` wraps it: preflight, daemon, `--status`, `--stop`, `--dry-run`, `--tier`, `--skills`.
  Waves: 1 control, an A/A repeat and the skill deleted; 2 one section removed per arm, only if deleting the skill lost quality; 3 the same sections moved to `references/<id>.md` behind an "open when" line, only for sections whose removal lost quality. Controls run first; a failed control stops the study.
  `--forced-load low-load|always` adds wave 1f (`w1f`) after wave 1, for skills that loaded in under 30% of wave 1 control runs (low-load) or for every skill (always). A low-load skill whose wave 1 load rate is unknown is skipped, with the reason in `w1f.skipped`. The arms, in a run of their own and judged with `frc` as the baseline: `frc` is the base ref with a first instruction that names the skill and says to load it with `get_skill`, `frc-b` its A/A repeat with the same instruction, and `del` the skill deleted with a neutral filler instruction of about the same word count (within 10%, single spaces, from a fixed list of sentences) in the same place (`forced-prefix.txt` and `forced-filler.txt` in the skill's study folder).
  The wave must pass the same isolation gate as the others, and one more: every run must carry exactly the prompt prefix its arm was planned with (the hashes in `w1f.arms.json`), and a run in any other wave must carry none. A wave that fails it is not read and is rerun on resume. A forced wave that fails (a build, run or judge error) is recorded in `w1f.failed` and reported, and the study goes on with wave 2 and the next skills; a resume retries it. To run wave 1 only, use `cap skill-study --study DIR --waves 1`: it runs the controls and wave 1, and skips the forced wave and waves 2 and 3. Use it rather than a wrapper that filters steps by label; a wrapper that must filter has to skip every label matching `/-w(1f|2|3)-(run|judge)$/` (exported as `AFTER_WAVE1_STEP` from `cap/skillstudy.js`), the forced wave's `<skill>-w1f-run` and `-judge` included.
  `cap decide` reads wave 1f after it makes the call and reports it in its own section of `decisions.md` and as `forced` in `decisions.json`, with `usedForCall: false`: forced load rate, delete against forced, A/A spread and the reading. The forced comparisons are one family, counted over the skills with a finished forced wave: each interval is at 1 - 0.05/m (Bonferroni) and the "helps" or "no effect" reading comes from it. Wave 1 keeps its own intervals. Forcing counts as held only when `frc` and its repeat `frc-b` each loaded the skill in at least 90% of their runs (`--forced-held-min X` on `cap skill-study` or `cap decide`); the section prints the observed rate of each forced arm. `--forced-load` and `--forced-held-min` given on a run are saved in `study.json`, so a resume without them does the same; the run log says whether each value came from the flag or from `study.json`. A dry run saves nothing and creates no directory. `--forced-load off` clears a saved value: it is saved as `off`, and the run and later resumes run no forced wave. When forced load helps a skill under the load floor, the reading adds "forced load helps; fix the description". The section also states the remaining confound: the two instructions differ in text, and the forced arm spends an extra turn on the load. It never changes a DELETE, PRUNE, KEEP or NEEDS DATA call and adds no row to `evidence.json`.
  `cap decide` writes `decisions.md`, `decisions.json`, `evidence.json` (rows for `cap prune-report --evidence`) and `patches/<skill>.patch`. Calls: DELETE, PRUNE (each section with `skills/NAME/SKILL.md:start-end`, remove or move, tokens saved), KEEP, NEEDS DATA. Quality is the bench score on a 0 to 1 scale; a difference counts only outside the A/A spread; the margin is 0.10 and runs per side must reach 15 (our own thresholds). No DELETE or PRUNE call without passed controls, an A/A arm, valid units, enough runs, a skill that loaded in at least 30% of control runs, and a result that clears the decision-card rule (confidence medium or high). Nothing is applied.
- `cap criteria --study DIR` (or `--runs DIR[,DIR] --baseline ARM [--aa ARM]`) flags the rubric criteria and checks that do not separate the arms. It reads `judgments.json` (one record per judge and replicate, with a verdict per criterion) and the check results in each `result.json`; it makes no model call. Advisory only: it changes no call, margin or floor, and `cap decide` does not read it. It writes `criteria.md` and `criteria.json` to `--out` (default `DIR/criteria` for a study; with `--runs` and no `--out` it prints the markdown).
  Per item and arm it gives the pass rate (pass 1, partial 0.5, fail 0, a rubric criterion averaged over judges) and, for each variant arm, the difference from the baseline with an interval: paired by run directory when two or more directories hold both arms, otherwise a bootstrap over the replicates of the one task the item belongs to. The A/A arm is shown for context and is not a variant. Flags:
  - NON-DISCRIMINATING: in every variant comparison the item scored the same in every run (always pass, always fail) with at least `--min-runs` runs per arm (default 5), or the interval lies inside the `cap decide` margin (`--margin`; its default is the `MARGIN` constant of `cap/decide.js` (0.10), imported so the two cannot drift). An item that scored the same in every run but has fewer runs on a side is reported as INSUFFICIENT-DATA and not flagged.
  - SATURATED: every arm at or above `--saturated` (default 0.95), or every arm at or below 1 minus it, with at least `--min-runs` runs per arm; with fewer it is reported as INSUFFICIENT-DATA.
  - HIGH-VARIANCE: judges gave different verdicts on more than `--judge-disagree` of the runs (default 0.3), or the pooled replicate SD of one arm and task is above `--replicate-sd` (default 0.4; 0.5 is a coin flip). The judge rate is strict: any difference counts, partial against pass or fail included. A coarse rate, pass against not pass, is shown beside it and does not drive the flag. Both are measured only where a run has two or more judges, and the report says when they are not. Both halves need `--min-runs` runs per arm (and that many runs with two or more judges for the judge half); with fewer the item is reported as INSUFFICIENT-DATA.
  Checks are matched in this order: an explicit `id` (or `name`) when every check result carries one; a content id, a hash of the fields the task schema defines for a check (`type`, `path`, `pattern`, `cmd`, `expectExit`, `min`, `labels`, `manifest`, `allowAdditions`, `group`), computed the same way from the task file and from each result record; then position, only when a run has as many check results as the task defines (or as the first run of a task with no loaded definition) with the same type at each place. Anything else is an error for that task's checks, which are then not judged, and so is an explicit id or name used twice in one result list. A task with no check list falls back to the first run seen. Task files and the schema are not changed, since a real id would change `checksRevision` and mark earlier results as not current. Result records do not carry `expectExit`, and older ones may lack `group`; a task check that sets either falls back to position, and the report names the missing fields. Two checks with the same content are numbered in list order (`#1`, `#2`); they run the same check on the same workspace, so the pairing cannot change a value. Intervals are widened for the number of items on each arm pair (Bonferroni), which makes NON-DISCRIMINATING harder to reach; `--no-adjust` turns that off. Thresholds are checked before anything is read, and a bad one exits 2: `--margin` above 0 and at most 1, `--saturated` above 0.5 and at most 1, `--judge-disagree` and `--replicate-sd` from 0 to 1, `--min-runs` a whole number of 1 or more. Infra errors and model mismatches are left out as in `cap decide`. These thresholds are our own.
- Registry: `capabilities/<kind>/<name>.json`, schema `schema/capability.schema.json`, checked by every `cap` command and by
  `node tasks/validate-tasks.js`. To add one: run `cap list --init --cap ID`, save the entry under its path, fill in `owner`, link tasks,
  then run `cap audit`. Only a person edits these files; stored query splits are never recomputed.
- Variants: ops edit a copy. `drop` removes the file and the name from every skill, SOP and context list of every agent spec and from
  `clientConfig.claudeCli.skills` (synth rejects a listed skill that has no directory). `variant.json` sits beside the tree, so it does
  not change the arm hash; it records the base commit, each op with before and after sha256, inbound references and the tree hash.
- Runner additions: `contrast --by task`; `--extra-tasks DIR` on `run`, `judge`, `report`, `contrast`, `recheck`, `skills` (tasks in
  `DIR/<id>.json`, `DIR/fixtures`, `DIR/hidden`, masked from the agent; check with `validate-tasks.js --only-extra --extra-tasks DIR`);
  `run` stops launching at 90% of `--budget-credits` or when charged credits plus the largest run so far would pass it, and `--run-credit-limit X`
  kills one run past X credits and records it as censored (on engine v3 it cannot trip, see Metrics notes).
- Reading the audit: tokens are bytes / 4, an estimate. "Unreachable" means no agent spec lists the capability, so no kiro agent can
  load it. A near-duplicate score is Jaccard on description words. Leakage fails above 5% shared 8-word shingles. Each `cap`
  command that builds hashes `~/.konductor/installs` before and after and exits 1 if it changed.
- `cap draft --cap ID,ID [--n 24]` makes one tool-less model call per capability (scratch HOME, empty cwd, no tools, credential copy removed
  after) and writes `DIR/drafts/<id>.json` and `.md`: candidate trigger queries with a rationale each (about half should-not, at least half of
  those near misses of a similar capability), two task ideas and, for a SOP, its declared output sections. It assigns no splits and never
  writes into the repository. A person reviews, assigns `split` (about 60/40 train/heldout plus 4 per polarity in `reserve`) and copies the
  approved `id`, `text`, `expect`, `nearMissOf` into the registry. `cap import --from FILE --cap ID [--n 24]` reads `[{query, should_trigger}]` the same way and applies the same checks as `cap draft`: the query text rules (length, one paragraph, no capability name in any spelling (backend_review or Backend Review for backend-review), no procedure or agent name, no dashes, no public-repo marker), at least 6 queries of each kind and at most n + 4 in all. It refuses a `split` on any item; a person assigns splits after review.
- `cap trigger --cap ID --mode proxy|live` scores precision, recall and F1 with Wilson 95% intervals, per query over repeats (a hit is a load in at
  least half of them; skill-creator counts per run, and F1 with its interval is our own), plus what fired instead. Queries come from the registry (`--split train|heldout|all`) or a draft (`--queries FILE`).
  Harnesses are reported separately, never merged. Trust each mode for what it sees:
  - proxy asks a model what it would do without starting an agent. On kiro-cli it writes `find_skills` arguments, an offline copy of the tool
    returns the candidates, and a second call picks; retrieval failures (the wording never reaches the skill) and judgment failures are
    counted apart. On opencode the skill index is in the prompt. It cannot see task context or delegation hops: a miss is informative, a hit is not proof.
  - live runs real trigger tasks and stops at the first load or delegation (`--stop-on first-load`, default) within 4 tool calls. A killed run
    has no metered credits at all (metering arrives at the end of a turn), so live spend is unobserved; give `--budget-credits` and `--run-credit-limit`.
  - Agreement of the two on a sample (`--crosscheck F` or `--crosscheck-run DIR`) is Cohen's kappa; below 0.6 or under 12 queries every proxy
    report says "proxy not validated".
- Forced load: `run --arm-prefix name=FILE` puts the file's text in front of the task prompt of one arm (recorded as sha256 and size); use
  "load skill X before you start" against the same arm without it to separate discovery from effect. `cap forced-prefix --cap skill:NAME --harness kiro-cli|opencode --out DIR`
  writes that instruction for each harness (kiro-cli: the `get_skill` tool of the skills server; opencode: the `skill` tool). Only the first turn of the entry agent sees it; a subagent does not.
  Give it to the forced arm and its A/A repeat in a run of their own. An arm's A/A identity is its ref, its arm config and the sha256 of its prefix, so a prefixed arm never pairs with the same ref without one; an arm without a prefix keeps the identity it had. An arm whose runs disagree on the prefix, or carry one without a hash, is never paired. `--arm-agent name=AGENT` starts an arm in
  another agent. `--stop-on first-capability|first-load|end_turn` and `--max-tool-calls N` stop a run early and mark it `earlyStopped`.
- Audit lint and baseline: `cap audit` also checks names, third-person descriptions, SKILL.md length, links, orphan and too-deep reference
  files, frontmatter keys, redundant When to Use sections and copied blocks. `capabilities/audit-baseline.json` lists tolerated findings by id: a new
  finding fails, and so does a listed one that no longer occurs. `cap audit --update-baseline` writes it (only removals once it exists; `--force`
  to add) and is never run for you. Registry `class: preference` marks a capability tested for fidelity, not lift; `cap plan --mode lift` refuses it.
- Judge bundles keep up to 16000 characters per file and 48000 per bundle (was 6000 and 24000); a task can set `bundleLimits`. `cap plan` sizes
  the budget as the largest of 1.5x the estimate, estimate plus the largest observed run, and a pass with one such run before the last cell.

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

## Reports, scores and the diligence scorecard
`report`, `contrast` and `cap prune-report` take `--detail quick|full` (default full) and `--format md|html|both` (default both). Files: `report.md`,
`report.html` (one file: inline CSS and SVG, no script, no external resource, prints), `report.json` and `charts/*.svg` (linked from the markdown, so it renders on GitHub).
`contrast` names them `contrast.md`, `contrast.html` and `contrast.json`; `cap prune-report` writes `prune-report.md`, `prune-report.html` and `prune-report.json`, plus `charts/` (also with `--format md`).
`--run DIR,DIR` merges several run directories read-only (a taken replicate number moves to the next free one) and needs `--out`; `contrast --out DIR` keeps the run directory unwritten.
- quick: scorecard, three flags, one headline table (quality, reliability, autonomy, cost ratio), the cost-vs-quality scatter, the per-task dot plot.
- full: everything in quick, then scores with their components, cost bars with CIs (overall and per class), dot plots, forest plots against the base with the A/A noise band,
  the judge heatmap and pairwise bars, autonomy, skill load, contamination, spend by phase, run durations, provenance, commands to reproduce, and the existing text tables unchanged.
  A run without judgments still renders; the charts that need them are listed under "Not shown". New JSON keys (`scores`, `diligence`, `detail`) are additive.
- Scores (`report/scores.js`; every one has n and a 95% bootstrap CI, and is "anecdotal" below 3 runs; a failed run is never hidden):
  - Quality /100: per run, the weighted mean of the components it has: hidden tests (FAIL_TO_PASS, hiddenTests or intendedTests as passed/total), checks (all pass = 1), rubric
    (mean over judges of the verified score; raw shown beside it). Weights come from `profiles/scoring.json` (0.5, 0.2, 0.3; `--scoring FILE`). A missing component is dropped and the
    others renormalised, never imputed. infraError, modelMismatch and runs with no component are left out and counted. The inputs used are printed beside the score.
  - Reliability /100: 100 minus the share of runs that timed out, errored, hit infraError or had a modelMismatch.
  - Autonomy /100 (autonomy tier only): share of runs completed without help, with interjections per task and the unnecessary-question rate beside it.
  - Efficiency (a ratio, not 0..100): cost per successful run, wall clock, model, work-tool and subagent calls, each as arm / base with a bootstrap CI; "cost per quality point" carries a ceiling caveat at quality 95 or more.
  - Skills (`cap prune-report`): load rate with a Wilson interval and exposure n, size, class and evidence verdict. No composite. Each skill gets a decision card: load rate (not comparable to SkillsBench's skill invocation rate; a direct read of a SKILL.md is not counted), cost, lift (with minus without, not paired, no interval) and Hake normalized gain, or normalized change for a loss
    (evidence rows may carry `withValue` and `withoutValue`, rates 0 to 1; `delta` and `aaSpread` use the same 0 to 1 scale and are rejected above 1), the A/A noise check, and a checklist of what is missing before anyone acts. The decision-board verdict (keep, prune candidate, needs human review, incomplete) is our mapping of the class, not another scale's threshold. A prune candidate needs medium or high confidence, a delta outside the A/A spread and consistent units (HARMS also needs 6 evidence runs); anything weaker reads needs human review.
    Thresholds that are our own, not from an external source: load rate 30%, Jaccard 0.6, size p90, minimum exposure 10, the A/A rule, the 0.95 ceiling, the 600 and 60 character description limits and the 5% leakage limit.
- Diligence scorecard (`report/diligence.js`, top of every report): PASS, WARN, FAIL or N/A per criterion with the measured value and the threshold. Unknown data is WARN "not recorded", never PASS. Key criteria: replicates per cell
  (3+ PASS, 2 WARN, 1 FAIL), A/A arm or same-ref repeat, known-answer controls (capability studies; a task field `control: positive|negative`), judge coverage, judge families (3+, no Claude), judge agreement (within-one 0.9+ and exact 0.6+ PASS; under 0.75 FAIL),
  hidden tests on every task, headroom (base at 95+ on at most 25% of tasks), model pin, provenance. Others: failures, censored credits, contamination, parse failures, both orderings, truncation, calibration (kappa 0.6+ from `calibrate score --save FILE` to `DIR/calibration/result.json`), recheck, isolation, budget, drift, task validation.
- Rating: `anecdotal` if any key criterion FAILs; `supported` only if every applicable key criterion PASSes and nothing FAILs; otherwise `indicative`. Thresholds are in `THRESHOLDS` in `report/diligence.js`.

## Profiles, credit ledger and platform verdict
Two profiles set how much evidence a study collects. `--profile quick|detailed` is accepted by `run`, `judge`, `report`, `cap plan` and `cap trigger`; the files are `profiles/quick.json` and `profiles/detailed.json`.
A profile changes what is collected, not how it is scored (`profiles/scoring.json` still holds the weights).

| | quick | detailed |
| --- | --- | --- |
| replicates per cell | 1 to 3 (default 2); more is refused | at least 5 (default 5); fewer is refused |
| A/A arm | none | added by `run`: the first konductor arm repeated at its exact commit (`v1.2.0-b` for `v1.2.0`); skipped when the arm list already has a pair with the same ref, arm config and prompt prefix |
| skill studies | no controls | known-answer keep and prune controls (`cap controls`), at least 8 scenarios per skill (`cap scenarios`); `cap plan` warns when it has fewer tasks |
| judging | rubric, pairwise | rubric, pairwise and graded, each pair in both answer orders |
| human calibration | none | `calibration-sample.json` and `.md` written to the results directory (the draw `calibrate export --n 25 --seed 1` makes) |
| report | `--detail quick`; a result under 3 runs is labelled anecdotal | `--detail full`; a "Profile check" lists what the run still lacks |

`--detail` still wins over the profile. With a profile, `cap plan` prints no default budget and `cap trigger --mode live` does not require one.

Credit ledger: `run` and `judge` append one JSON line per agent run and per judge call to `credit-ledger.jsonl` in the results directory (`kind`, arm, task, replicate, `credits`, `charged`, `cached`; `backfill` lines correct earlier runs) and print
`credits: this command X (no cap), study total Y (runs R, judge J)` after each one and at the end. A censored run is totalled at its charge. `--budget-credits X` is optional: at 90% of X
(counted for the command, not the whole directory) no new run or call starts; a command that ends past 100% exits 3. `report` prints the ledger total.

Platform verdict: `report --run DIR[,DIR...] --verdict platform [--baseline vanilla] [--out DIR] [--format md|html|both]` writes `verdict.md`, `verdict.html`, `verdict.json` and `charts/verdict-quality.svg`
instead of the normal report. Each run directory keeps its own refs; one arm in several directories is pooled by exact ref, so `main@7428dd9` and `main@f031534` are two arms and are never merged.
For each arm against the baseline, on the tasks both ran: quality /100 and the difference with its paired 95% interval, reliability /100, autonomy /100 where present, cost ratio (credits per successful run),
latency ratio (mean wall clock), run counts, replicates in the smallest cell, the A/A noise, the lowest diligence rating over its directories, graded-judge figures and failed-run counts.
Efficiency is a ratio and never a 0 to 100 number. A failed run with nothing to score counts as quality 0; infra errors and model mismatches are listed and left out of quality.
- KEEP: quality up by more than the A/A noise, paired 95% interval above 0, reliability not clearly lower, cost at most 2.0x vanilla per successful run. DISCARD: the same for a loss (its cost is not weighed).
- The interval is paired by cell, one task in one run directory: each cell gives the arm's mean score minus the baseline's, and the interval is a t interval on those differences. Runs of one task are not independent, so a bootstrap over pooled runs is printed only as a descriptive column. With no true effect, 5 to 12 cells of 5 replicates, a task spread of 20 points and a run spread of 12, the paired interval excluded 0 in 4.1% to 6.5% of trials; the pooled bootstrap excluded 0 in about 20% of trials at 3 runs a side (`node bench/scripts/sim-interval-size.js`).
- NOT ENOUGH EVIDENCE otherwise. It is forced by: fewer than 3 runs on a side, fewer than 5 paired task cells, a difference inside the A/A noise, an anecdotal diligence rating. It also follows from: no A/A noise measured,
  fewer than 3 replicates in a cell, an interval that includes 0, a quality gain with clearly lower reliability or a cost over 2.0x, more than a fifth of the runs on a side without a score (infra error, model mismatch, nothing to score), or the arm and the baseline scored on different components (for example the rubric present for one and missing for the other) in any cell. The A/A noise is pooled over every paired task cell of an arm and its repeat: the larger end of the 95% interval of the per-cell differences, never under 5 points, and unavailable below two paired cells.
- Every reason that applies is printed. A directory without the baseline arm is listed and skipped.

## Orchestrator study: cells, gates, metrics and the pass rule
This is how to compare a test branch against vanilla and against main, across models and harnesses, and read the answer. Nothing here needs a cap.

Cells. A cell is one (harness, model) pair. Run each cell into its own directory (one cell per directory) with the same arms, tasks, seed and profile, then give every directory to one report:
- Kiro v3 with Claude Sonnet 5.5: `--agent-engine v3 --model claude-sonnet-5.5`.
- Kiro v3 with GPT: `--agent-engine v3 --model gpt-5.6-sol`. The runner passes the model to `kiro-cli` and fails a run whose session ran on another model (`modelMismatch`). `judge` drops any judge from the subject's own family from a default or suite panel and takes the next one from deepseek-3.2, glm-5, qwen3-coder-next, minimax-m2.5, so a GPT subject is judged by deepseek-3.2, glm-5 and qwen3-coder-next. Judges named with `--judges` are never rewritten.
- Claude Code cell: not built. `bench/runner` has no Claude Code harness yet, so no run of `claude` is possible. The scope, the auth routes, how cost and tokens can be read and an effort estimate are in the gap note kept with the study notes; it needs one recorded real stream before a fake can be trusted.

Arms. `--arms vanilla,orch-all=dir:PATH,main,orch-coord=dir:PATH` with `--arm-config orch-coord=orchestration.mode=coordinator`. `--arm-config name=key.path=value[;key.path=value]` writes those keys into that arm's scratch `~/.konductor/config.yml` after the install, so the arm starts its session with them. `orchestration.mode` takes `auto` or `coordinator`; a misspelled orchestration key is refused, because the CLI would otherwise fall back to `auto` without saying so. Vanilla refuses the flag, `run-config.json` and `result.json` record it, and two arms at one ref with different configs are two arms: only an arm with the same ref and the same config counts as an A/A repeat. With `--profile detailed` the first konductor arm in the list is repeated automatically (put the arm under test first), which gives the A/A sentinel.

Isolation gates. Both fail loudly and keep the runs.
- The real `~/.konductor/installs` (of every real home of the account, by resolved path) is hashed before and after each run and each batch. A run whose window saw a change becomes an error with the flag `installsChanged`, its spend kept. The batch writes `isolation-gate.json` and `summary.json` records it; `run` then prints `ISOLATION FAILURE` and ends with exit code 4. A scratch HOME never needs this directory, so any change means a command ran against the real one. The gate cannot tell a leaking run from your own `konductor install` or `update` in another terminal on the same account, so do not run those while a batch is going.
- A Claude Code run gets a scratch `CLAUDE_CONFIG_DIR` with `rules/empty.md`, 0 bytes, and nothing else under `rules/`, so the host's `~/.claude/rules` is not read. `ensureEmptyClaudeRules` refuses the real `~/.claude`. The Kiro cells do not use it.

Metrics. Each run's `result.json` has an `orch` record, read from `stream.jsonl` and the workspace snapshot; `report` and `contrast` backfill older run directories from those files. `report` has an Orchestration table; `contrast` has the rows below, and `--phases ID,ID|all` adds the phase-document rows (leave it off for tasks that do not run the SDLC, where it would read 0%).
- spawns: agents handed work through the subagent tool, one per stage. max spawn depth: how many spawns deep the deepest sits (1 is a spawn by the main agent).
- review rounds: spawns recognised as a review. reworks after a pass: fix spawns issued while the latest review before them had passed. Both come from text rules in `profiles/orch-metrics.json` (patterns over the brief and the returned text, an explicit `Verdict: WORD` first). They are heuristics: read a sample of runs when you change a pattern, and treat an `unknown` verdict as unknown, never as a pass.
- phase documents: whether each phase's files exist and are not empty, from `profiles/phase-documents.json` (taken from the full-SDLC SOP's artifact layout). A phase with a `*` is complete only when every feature that has any of its documents has all of them. The shipped tasks do not ask for the whole SDLC; use `--extra-tasks` for a task that does.

Pass rule. `report --run DIR[,DIR...] --verdict orchestrator-pass [--baseline vanilla] [--test-arms ARM,ARM] [--changed-skills NAME,NAME] [--phases ID,ID|all] --out DIR` writes `orchestrator-pass.md`, `.html` and `.json`, one call per test arm per cell: PASS, FAIL or NOT ENOUGH EVIDENCE.
- Cost: the arm costs at most 2.0x vanilla, both as mean credits per executed run and as credits per successful run, on the cells (run directory and task) both ran. A run with no metered cost (killed before its last metering event) is charged only a lower bound by the ledger; when counting such runs of the arm at the largest metered cost of their task would push a ratio over 2.0x, the cell is NOT ENOUGH EVIDENCE and the page says how many runs are involved.
- Quality: paired by cell (one task in one run directory), the arm's mean quality minus vanilla's, with a t interval on the per-cell differences. The tolerance is the pooled within-cell standard deviation of vanilla's scores (how much a vanilla run varies on one task, not across tasks), never under 5 points. The arm meets it when the lower end of the interval is at least minus the tolerance. A difference below minus the tolerance fails; one above it whose interval reaches below it is NOT ENOUGH EVIDENCE. A gain meets it.
- A/A sentinel: the quality drift is pooled over every paired task cell of an arm and its repeat (the larger end of the 95% interval of the per-cell differences, in quality points; at least two paired cells); the cost drift is the largest cost ratio gap. A criterion whose effect is not larger than the drift is uncertain. A clear failure on the other criterion still gives FAIL; otherwise the cell is NOT ENOUGH EVIDENCE. This means an arm that is simply as good as vanilla is NOT ENOUGH EVIDENCE rather than PASS: the study cannot tell it from drift. The page also prints whether the raw thresholds were met.
- Also NOT ENOUGH EVIDENCE: fewer than 3 scored runs on a side, fewer than 5 paired task cells, no A/A repeat in the cell, no vanilla task with two scored runs, more than a fifth of the runs on a side without a score, the arm and vanilla scored on different components in any cell, and a change that lives only in skills (the arm records the skills its diff touches, or pass `--changed-skills`) when none of those skills loaded in any run of the arm, or no load data was recorded. A mixed change only gets a note.
- Failed and timed-out runs stay in: a run with nothing to score counts as quality 0 and its cost counts. Infra errors and model mismatches are left out of quality, listed, and capped at a fifth of the runs on a side. The drift used by the sentinel is at least 5 quality points.
- GPT cell: judged on its own ratios to vanilla. The Claude cell on the same harness is printed beside it as ratios, per run and per successful run, and their quotient. Raw credits are never compared.
- Cells are keyed `harness engine / model`, for example `kiro-cli v3 / gpt-5.6-sol`; directories of one cell are pooled by exact ref.

Commands (replace PATH with the worktree of the test branch and V with a results directory):
```
node bench/runner/bench.js run --suite lite --arms vanilla,orch-all=dir:PATH,main,orch-coord=dir:PATH --arm-config orch-coord=orchestration.mode=coordinator --agent-engine v3 --model claude-sonnet-5.5 --profile detailed --seed 20261101 --out V/claude
node bench/runner/bench.js run --suite lite --arms vanilla,orch-all=dir:PATH,main,orch-coord=dir:PATH --arm-config orch-coord=orchestration.mode=coordinator --agent-engine v3 --model gpt-5.6-sol --profile detailed --seed 20261101 --out V/gpt
node bench/runner/bench.js judge --run V/claude --profile detailed
node bench/runner/bench.js judge --run V/gpt --profile detailed
node bench/runner/bench.js contrast --run V/claude --base vanilla --out V/contrast-claude
node bench/runner/bench.js report --run V/claude,V/gpt --verdict orchestrator-pass --out V/pass
```
Free checks before spending: `run ... --prepare-only` builds and trial-installs every arm (v3 arms with `konductor install --harness kiro-v3 --no-telemetry`) and starts no agent.

## Running a study unattended
`bench/scripts/` holds the scripts for long studies: `run-real-pilot.sh` (capability study), `run-after-capability.sh` (judging, the skill bench and a summary, chained after it), `run-judging.sh`, `run-skill-bench.sh` and the read-only dashboard `monitor.sh`. Setup, commands, credentials, what each phase does and how to read the monitor are in [RUNBOOK.md](RUNBOOK.md).
