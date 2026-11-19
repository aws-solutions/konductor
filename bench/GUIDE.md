<div align="center">

# bench

**Find out whether a change to an AI coding agent helps, what it costs, and how much of the result is noise.**

bench runs the same tasks with and without a change, scores the output with checks and a panel of judge models,
and reports quality, cost and run-to-run spread.

[**Quick start**](#quick-start) ·
[**How it works**](#how-it-works) ·
[**Reading results**](#reading-results) ·
[**Write a task**](#write-a-task) ·
[**Other agents**](#other-agents) ·
[**Reference**](docs/reference.md)

</div>

---

## What bench answers

You changed something about an agent setup: a skill, a system prompt, an orchestrator, a whole release.
Is the agent better for it? bench gives a number for each of three things:

- **Quality.** Does the output pass the task's deterministic checks and a judge panel's rubric?
- **Cost.** What did the runs spend, in credits (Kiro CLI) or USD (opencode, Claude Code)?
- **Noise.** If you run the same setup twice, how far apart are the results? A difference smaller than that is not a result.

It is for people who ship an agent setup and want evidence before they keep a change. Today the setup under test is
Konductor (the repository this lives in) and the agent is Kiro CLI, opencode or Claude Code. Section [Other agents](#other-agents) says what that rules out.

> [!NOTE]
> bench is plain Node. There is no install step beyond the tools in [Prerequisites](#prerequisites).
> Everything below runs from the repository root.

---

## How it works

An **arm** is one setup under test, for example `vanilla` (the bare agent) or `main` (the agent with Konductor from `origin/main`).
A **task** is a prompt plus a starting project and the ways to score the result. bench runs every task on every arm, several times, and compares.

```mermaid
flowchart TD
    T["task + arm"] --> I["scratch HOME<br/>install the arm"]
    I --> A["isolated agent process<br/>fresh copy of the fixture"]
    A --> S["stream.jsonl"]
    S --> P["parse: tools, skills,<br/>credits or USD, final text"]
    A --> W["workspace/ snapshot"]
    W --> C["deterministic checks<br/>and hidden tests"]
    P --> R["result.json"]
    C --> R
    R --> B["judge bundle<br/>final text + changed files + check results"]
    B --> J["judge panel<br/>judgments.json"]
    R --> REP["report"]
    J --> REP
    classDef free fill:#0B0A12,color:#ffffff,stroke:#3DDC97
    classDef paid fill:#7C5CFF,color:#ffffff,stroke:#7C5CFF
    class A,J paid
    class T,I,S,P,W,C,R,B,REP free
```

Purple boxes call a model and spend credits. The rest is local work.

1. **Install.** The runner builds the arm from its git ref, then installs it into a throwaway home directory. Your real home is never written.
2. **Run.** The agent starts in a fresh copy of the task's fixture, in an isolated process (`unshare` on Linux, `sandbox-exec` on macOS). It sees an allowlisted environment, and credentials, SSH keys and the answer keys are hidden from it. The network stays open.
3. **Record.** The agent's event stream is saved as `stream.jsonl`. The parser reads it for tool calls, skill loads, metered spend and the final answer.
4. **Snapshot and check.** After the agent exits, the workspace is copied out and the task's checks run on it in a separate scratch home, with network access denied where the platform supports it. Checks are regular expressions, file tests, shell commands and, for some tasks, hidden acceptance tests.
5. **Judge.** `judge` builds a bundle from the final text, the files the agent changed, the tool calls of its main session and of any child session it started, and the check results. The judges never see the transcript's messages or the arm name. Each judge scores the rubric items pass, partial or fail, and quotes evidence. A quote that is not in the output lowers the verdict one level.
6. **Report.** `report` combines checks and judgments into a score per run, then compares arms, with intervals.

### What a run leaves behind

One run is a directory `<out>/<arm>/<task>/<replicate>/`:

```
<out>/
  run-config.json  summary.json  env.json  credit-ledger.jsonl  isolation-gate.json   # one per results directory
  judgments.json   judge/ (cache/, raw/)                                              # after `judge`
  <arm>/<task>/1/
    result.json            status, checks, credits or USD, tool and skill counts, flags
    stream.jsonl           the agent's event stream, as it arrived
    stderr.txt             the agent's stderr
    command.txt            the command line that started the agent
    install.log            output of the arm install
    installed-agent.json   what the install put in front of the agent (Kiro CLI)
    session/               the agent's own session files (Kiro CLI)
    workspace/             the project as the agent left it
```

`result.json` follows `schema/result.schema.json`. The runs of one task on one arm are the replicates `1`, `2`, and so on.

---

## Core concepts

| Term | What it is |
| --- | --- |
| Task | A JSON file in `tasks/`: a prompt, a fixture, checks, a rubric and a timeout. |
| Arm | One setup under test. `vanilla`, `v1.2.0`, `main`, `name=<git ref>` or `name=dir:<path>`. Add `oc-` or `cc-` for opencode or Claude Code. |
| Suite | A named list of tasks, arms, replicates and judges, such as `lite` or `hard`. |
| Fixture | A small project the task starts from, copied fresh for every run. |
| Check | A deterministic test on the final workspace: a regex, a file test, a command or hidden tests. |
| Rubric | Three to six weighted criteria a judge scores for each output. |
| Judge panel | At least three judge models from different families. The subject model's own family is excluded. A run's score is the median of its judges, and NO DATA when fewer than three scored it (SR-24); the report shows each judge's score beside the median. |
| Replicate | One more run of the same task on the same arm. Replicates measure run-to-run spread. |
| A/A arm | The same ref run twice under two names. The gap between them is the noise floor. |
| Credit ledger | `credit-ledger.jsonl`: one line per agent run and per judge call. |
| Censored run | A run that timed out or died before its last metering event. Its true cost is unknown, only bounded below. |
| Isolation, tripwire | The sandbox around the agent, and a scan afterwards for changes to your real home. |

---

## Quick start

### Prerequisites

- Node 22 or newer, `git`, `tar`.
- To run the Konductor arms: `cargo` (an offline cache, or pass `--cargo-online`). The arm is built from a local git ref. bench never fetches, so fetch the ref first.
- For Kiro CLI runs: `kiro-cli` on PATH and logged in. On Linux, `unshare` and `setpriv` as well.
- For opencode or Claude Code runs, and for the opencode judge backend: AWS credentials for Amazon Bedrock. See the harness sections in [README.md](docs/reference.md).

### Free first

These call no model. The marks in the table say what each command costs.

| You want to know | Command | Cost |
| --- | --- | --- |
| Do the shipped tasks hold together? | `node bench/tasks/validate-tasks.js` | free |
| Which arms exist, and what do they mean? | `node bench/runner/bench.js list-arms` | free |
| What will this cost, and which commands do I run? | `node bench/runner/bench.js pr-plan --ref opt-a=REF --suite lite --budget-credits 100` | free, runs nothing |
| Do all arms build and install? | add `--prepare-only` to any `run` command | free, builds arms, starts no agent |
| What will judging cost? | `node bench/runner/bench.js judge --run DIR --plan` | free, calls no model |
| Is the code healthy? | `node --test "bench/runner/test/*.test.js" "bench/skilleval/test/*.test.js"`, then `node --test bench/physical/test/*.test.js bench/agenteval/test/*.test.js` and `python3 -m unittest discover -s bench/physical/test -p 'test_*.py'` (the plant's Python side) | free |
| Does a skill load when it should, and stay out when it should not? | `node bench/runner/bench.js cap select --skill NAME --run stub-sel --out /tmp/kp` (needs the skill's frozen `selection.json`; add `--stub-behaviour fake` for a fake model that picks from the skill index) | free on the stub; a real run is paid and needs approval |
| Does the keep-or-prune pipeline work end to end? | `node bench/runner/bench.js cap keep-prune --skill plan-review --run stub-pilot --out /tmp/kp` | free, stub provider only; it refuses to run if any of the 35 frozen baselines fails its check, and a stale baseline gives NO DATA. Each block is the conditional effect after load, judged by three judge families (median score); the whole-skill call is NO DATA without `--selection FILE` |

`pr-plan` prints the next commands in order, with an estimate:

```
Plan: opt-a against v1.2.0 on the lite suite (5 task(s), 1 replicate). This prints the plan and runs nothing.
  total for 1 replicate: 61.10 credits; cap 100 (1.5x, rounded up). Judge credits are not included.
```

### A first real run

Compare the bare agent with Konductor on one task, three times each. This spends credits.

```bash
OUT=/var/tmp/bench-first

# spends credits: 2 arms x 1 task x 3 replicates = 6 agent runs, stops launching new runs at 90% of the budget
node bench/runner/bench.js run --suite lite --arms vanilla,main \
  --tasks simple-fix-failing-test --replicates 3 --budget-credits 40 --out $OUT

# spends credits: three judges score every output (add --plan first for the estimate)
node bench/runner/bench.js judge --run $OUT

# free: report.md, report.html, report.json and charts/ in $OUT
node bench/runner/bench.js report --run $OUT
```

One task cannot support a platform verdict (it needs five paired task cells), but the report and `explain` work. The runs use `claude-sonnet-5.5` at effort `high` unless you pass `--model` or `--effort`. `main` means `origin/main` as last fetched in your clone.
Add `--prepare-only` to the first command to check that both arms build before you spend anything.

> [!TIP]
> Three replicates is the smallest number the report treats as more than anecdotal. For a real decision use `--profile detailed`,
> which runs at least five replicates, adds an A/A arm and adds graded judging.

To check one run without the whole report, use `explain` (why this quality number) or `trace` (what the agent did, in order). Both are free and read files only.

```bash
node bench/runner/bench.js explain --run $OUT --arm main --task simple-fix-failing-test --rep 1
node bench/runner/bench.js trace   --run $OUT --arm main --task simple-fix-failing-test --rep 1
```

---

## Reading results

`report.md` opens with a diligence scorecard, then the scores. For each arm you get:

| Column | Meaning |
| --- | --- |
| Quality /100 [95% CI] | Per run, the weighted mean of what the run has: hidden tests, checks and the judges' rubric score (the median over judges). Default weights are 0.5, 0.2 and 0.3. Without hidden tests they become checks 0.4 and rubric 0.6. |
| n | Runs that contributed. Infrastructure errors and model mismatches are left out and counted separately. |
| Reliability /100 | 100 minus the share of runs that timed out, errored or hit an infrastructure problem. |
| Cost ratio | Cost per successful run, as arm over baseline. A ratio, never a 0 to 100 score. |

A run is a clean pass when its status is success, there is no infrastructure error or model mismatch, and every check passed.
"Cost per successful run" is all charged cost divided by clean passes, so failures raise it.

**Same, better or worse.** Read a difference against the noise, not against zero.

- `contrast` labels each metric `improved`, `worse` or `within noise`, and `n too small` below three runs per side. A change counts only when it is at least 15% (`--min-rel`) and, with three or more runs per side, the intervals do not overlap (`--rule any` asks for either).
- `report --verdict platform` turns that into KEEP, DISCARD or NOT ENOUGH EVIDENCE for each arm. KEEP needs the quality gain to beat the A/A noise, a paired 95% interval above zero, no clear drop in reliability and a cost of at most 2.0x the baseline per successful run.
- The A/A noise band is never smaller than 5 quality points. A gain inside it is reported as noise.
- NOT ENOUGH EVIDENCE is a normal answer. It means this study cannot tell, not that nothing happened.

**Thin n.** Fewer than three runs on a side is labelled anecdotal. A cell with fewer than three replicates is flagged. Five paired task cells are the minimum for a platform verdict.

**Quality across the SDLC.** To show where konductor wins and what it costs, run `--suite sdlc`, judge it with and without `--criteria-pack quality`, and read `report-2x2 --criteria-pack quality`. Three sections answer it: quality, cost and time per cell; the same per SDLC phase; and konductor minus vanilla paired by task, with the spread and the count of tasks won, lost and tied. A claim that konductor wins on quality needs the paired median above zero and more wins than losses, not only a higher mean.

**Censored runs.** A run that timed out has unobserved spend. The ledger charges it the median of the arm's completed runs, or `--censored-floor` (default 1.0), never 0. `result.json` keeps the known floor as `creditsLowerBound` and the charge as `creditsCharged`. Treat the cost of an arm with many censored runs as a lower bound.

**Judge agreement.** The scorecard shows how far the judges agree with each other (within-one agreement of 0.9 or more and exact agreement of 0.6 or more pass). It also shows the share of quotes the judges could not back with evidence. Human calibration is a separate step: `cap review` writes a page for a person to rate a sample, `cap review-import` scores the ratings, and a kappa of 0.6 or more passes. See [Calibration](docs/reference.md#calibration).

**Runs kept out of judging.** Some runs are not sent to the judges. For new studies the rubric number treats them in one of two ways, by reason:

| Reason | Class | In the main rubric number |
| --- | --- | --- |
| credsUnscrubbed, cause `link` | integrity | counted as a failure (0 on every rubric item) |
| credsUnscrubbed, cause `unreadable` | integrity | counted as a failure |
| credsUnscrubbed, cause `unwritable` | gap | left out, with its count and cause shown |
| credsUnscrubbed, cause `too-large` | gap | left out, with its count and cause shown |
| credsUnscrubbed, cause `error` (anything else, or unknown) | gap | left out, with its count and cause shown |
| stdioTampered | integrity | counted as a failure |
| usageDbTampered | integrity | counted as a failure |
| infraError | gap | left out |
| no workspace | gap | left out |
| budget_skipped | gap | left out, the run never executed |

A scrub failure sets `credsUnscrubbed` and is classed by its cause, the `reason` on each `unscrubbedFiles` entry (`detail` holds the error code). `link`: a link or non-regular file stood where a plain file was listed. `unreadable`: reading a listed file or directory was refused, so its permissions or owner changed. Both are evidence of tampering and count as failures. `unwritable` (the file was read but could not be rewritten), `too-large` (a secret-like run longer than the scrub window), `error` (I/O errors and anything else) and entries without a known cause are not evidence of misbehavior, so the run is a gap: out of both means, counted in the cell flags and listed in `Not judged` with its cause. A transient read error is retried once before it is reported. A run that also set `stdioTampered` or `usageDbTampered` stays an integrity run. Whatever its class, a `credsUnscrubbed` run is never sent to a judge, because its text may still hold a secret. To move a cause to the other class, edit `SCRUB_CAUSE_CLASS` in `bench/judge/exclusion.js`; it is the only place that says so, and the policy table in a stamped report is generated from it.

Reports of new studies show both numbers side by side, always, so the table keeps its shape: `rubric (excluded runs = 0)` is the main number, `rubric (judged runs only)` is the mean over judged runs, and `excluded runs (counted as 0)` is how many integrity runs sit between them. `report.json` carries them per arm and scope as `rubricAll`, `rubricJudged` and `excludedCount`; `rubricJudged` equals the number older reports gave. The score rows behind the verdict, the quality score and `contrast` use the main number; `compare` reports both and labels them. The diligence scorecard is unchanged: judge coverage still counts these runs as unjudged.

A study follows this policy when its `judgments.json` has `"rubricPolicy": "excluded-as-failures"`. The judge writes it when it creates the file. A file made before that has no stamp and keeps the older rule, excluded runs are gaps; such a report renders as it always did, plus the line `legacy: excluded runs are gaps`. Judging more into an unstamped file does not stamp it, and `report --run DIR,DIR` over a mix of stamped and unstamped directories is treated as legacy. `compare` refuses to compare a legacy study with a stamped one unless you pass `--force`. The class of each reason is defined once, in `judge/exclusion.js` (`exclusionClass(run)` in `judge/run.js` applies it to a run).

**Output length.** Longer output is not better, so reports of new studies (the ones with the rubric policy stamp) show how much each arm wrote. Every results table has two more columns per arm and scope: `mean final text, characters` (the final message in `result.json`) and `mean artifact size, bytes of files created or changed` (the files a run left in its workspace that are new or differ from the task fixture, at full size; unchanged seed files, tool state and `.git` or `node_modules` are left out). Each is a mean over the runs that recorded it, shown with its count; `n/a` means none did. `report.json` carries them as `length` on each cell. The diligence scorecard gets a separate WARN line, `Output length vs the baseline arm`, when an arm's mean differs from the baseline arm's by more than 1.5x in either direction on either measure; it names the arm, the ratio and both numbers, and is absent when nothing is that far off or the baseline mean is 0 or unknown. `contrast` and `compare` print one line with the Spearman rank correlation between artifact bytes and rubric score, ranked within each task so that a long task does not drive it, with the number of runs; it is left out below 6 runs. Judged runs only. None of this changes a score, a judge prompt or an older report.

**Interim tables.** To look at a study while it runs, point `report` at the finished cells with `--run DIR,DIR` and an `--out`. Several directories are merged read-only. `report --detail quick` gives one page. `contrast --run DIR --base vanilla` gives each arm against a base, by task class.

---

## Write a task

A task is one JSON file. This one asks for a small function in the `textkit` fixture. It is a trimmed copy of `tasks/simple-add-function.json`.

```json
{
  "id": "guide-title-case",
  "class": "simple",
  "target": null,
  "prompt": "Add a titleCase(text) function to textkit. It should upper-case the first letter of every word and lower-case the rest, and return an empty string for empty input. Export it from the package entry point and add tests for it. Do not ask me questions; if something is unclear, make a reasonable assumption, list your assumptions in your final message, and finish the work.",
  "fixture": "textkit",
  "timeoutSec": 300,
  "checks": [
    { "type": "contains", "path": "src/index.js", "pattern": "titleCase" },
    { "type": "cmd", "cmd": "node -e 'const t=require(\"./src\").titleCase;process.exit(t(\"hELLO wORLD\")===\"Hello World\"&&t(\"\")===\"\"?0:1)'", "expectExit": 0 }
  ],
  "rubric": [
    { "id": "exported", "criterion": "titleCase is implemented in src/ and exported from src/index.js.", "weight": 3 },
    { "id": "tests", "criterion": "Adds tests for titleCase covering mixed-case input and the empty string, and they pass.", "weight": 2 }
  ],
  "tiers": ["cap"]
}
```

Rules that trip people up:

- Every prompt ends with the "Do not ask me questions" sentence. Runs are unattended, so a question ends the turn with nothing written.
- The prompt never names a skill, agent or procedure. The same prompt goes to every arm.
- At least one check must fail on the untouched fixture, so doing nothing cannot pass.
- A task needs a reference solution under `solutions/<id>/` that passes every check. The validator enforces this.
- A task has three to six rubric criteria, tied to the fixture's `.bench-answer-key.md`, which only the judges read.
- The task schema is closed (`schema/task.schema.json`). An unknown field fails validation.

Put your own tasks in a directory laid out like `bench/rootcause/`: task files beside `solutions/`, with fixtures taken from `bench/fixtures`. Validate and run them with `--extra-tasks`:

```bash
node bench/tasks/validate-tasks.js --extra-tasks DIR --only-extra     # free
node bench/runner/bench.js run --suite cap --extra-tasks DIR --tasks guide-title-case --arms vanilla,main --out $OUT   # spends credits
```

The example above, with a copy of `tasks/solutions/simple-add-function/` as its reference solution, passes the validator. The full format, the check types and the rules for hidden-test tasks are in [README-tasks.md](docs/tasks.md).

A task can also ask the quality pack to rate concurrency, extensibility, targets in code or a design pattern. List the type for the task id under `taskArtifacts` in `criteria/quality-pack.json` (`concurrency`, `extension`, `nfr-code`, `pattern-key` or `enterprise-pattern`). For the two pattern types, add a `## Pattern key` section to the answer key with `- needed:` lines, plus an `- enterprise:` line for an enterprise pattern. The validator fails the task without them. `hard-seat-holds`, `hard-export-formats` and `hard-catalog-limits` are worked examples. For a problem framing, a spike, a decision record or production readiness, declare `framing`, `spike`, `decision` or `production`. For a code review, a design review or an audit of a review, declare `code-review`, `design-review` or `review-audit`, and put the planted items in hidden tests (see `review-key.js` in each review task's hidden directory) so recall is counted, not judged. The seven tasks in `bench/sdlc/` are worked examples.

---

## Run a long study safely

For studies that run for hours, read [RUNBOOK.md](docs/RUNBOOK.md). It covers the unattended scripts, the credential flow and the monitor. The points below are the ones that cost people credits.

| Risk | What bench does | What you do |
| --- | --- | --- |
| Kiro CLI login expires mid-run | `run` checks `kiro-cli whoami` before building and again between runs, at most every 5 minutes. A run that never started a turn and printed a login error is charged 0 and marked infra. After `--max-auth-failures` such runs in a row (default 3) the rest are skipped and `run` exits 6. | Log in again right before a long chunk. After an exit 6, log in and rerun. |
| Every run failed, or every run was over in under a second | `run` exits 5 and writes `infraFailure` to `summary.json`. A study where each run either errored or took under 1 s measured nothing, because the agent most likely never ran. Exit code 3, 4 or 6 takes its place when it applies. | Read `stderr.txt` of one run before spending more. |
| The agent CLI is updated or removed mid-study | A run whose agent binary could not be started (exit 127, or exit 126 or a spawn error with a "No such file or directory" or "Permission denied" message; no turn, under 5 s) is charged 0, marked infra of kind `launch` and never counted as a timeout. Launch failures count toward the same consecutive-failure stop as login failures (default 3, `--max-auth-failures` or `BENCH_MAX_AUTH_FAILURES`), with their own message ("agent binary missing or replaced during the run"). The rest are skipped and `run` exits 6. | Do not update, reinstall or move the agent CLI while a study runs. After an exit 6 with a launch message, check that the binary is in place, then rerun the skipped cells in a new `--out` or with `--replicate-offset`. |
| A task hangs | Each task has a `timeoutSec`. | `--timeout-sec N` replaces it for every selected task. |
| Spend runs away | `--budget-credits X` stops launching new runs at 90% of X. A command that ends past 100% exits 3. Without it nothing stops a run. | Always pass a budget on a new study. `--run-credit-limit` kills one run on engine v2 only. |
| Something wrote to your real home | The tripwire scans for changes after each run. A hash of `~/.konductor/installs` before and after fails the batch with exit 4. | Do not run `konductor install` or switch branches while a study runs. |
| Disk fills up | Runs keep a full workspace each. | `gc` lists what bench made and may reclaim (a dry run). `archive --run DIR` packs finished workspaces. |

**State directory.** The unattended scripts keep their state in a per-user directory now, so the default location changed. A chain started before the upgrade is not found by `monitor.sh`; set `STATE_DIR` to the old path (`/tmp/konductor-bench`) to watch it. The real-repo cache (`bench/real/lib.js`) defaults to `realrepos` in that same per-user directory; the old `/tmp/konductor-bench/realrepos` is still used while it exists and the new one does not.

Exit codes of `run`: 0 ok, 1 error, 2 bad arguments, 3 credit guard stop, 4 isolation failure, 5 infra check (every run errored or finished in under 1 s), 6 login or launch failure stop.

**Charged and observed.** Observed credits are what the stream metered. Charged credits are what the ledger counts. They match for a finished run. For a censored run the charge is an estimate (above), and the report says how many runs it covers.
Kiro engine v3 meters only at the end of a turn, so a killed v3 run has no observed spend at all.

### What the sandbox does not hide

The sandbox hides credentials, answer keys, hidden tests, partial and reference solutions, stubs and the output directory. An agent can still read the following. Reads leave no trace, so the tripwire does not report them. Checked on Linux with the mount namespace; the macOS profile uses the same path lists and was not run for this check.

| Readable by the agent | Why it matters | What to do |
| --- | --- | --- |
| The Konductor checkout the bench runs from (skills, agents, `AGENTS.md`, this guide) | A vanilla agent that searches the disk can find Konductor skill text, so the arms are not cleanly apart. | Pass `--hide <checkout>` (or set `BENCH_HIDE_EXTRA`). The checkout must not hold the output directory, the scratch directory, the cache or a tool on `PATH`, because everything under a hidden path disappears. The run record lists it under `isolation.hide`. |
| `bench/tasks/*.json` (check patterns and rubric items) | Any agent can read how it is graded. Only `hidden`, `partials`, `solutions` and `stubs` under `bench/tasks` are masked, and a test pins that the task files stay readable. | Covered by `--hide <checkout>` when the bench runs from that checkout. Masking `bench/tasks` as a whole is safe for the runner (everything under it is read on the host) but changes that test and what existing studies could see, so it is a decision for the maintainers. |
| The arm cache (default `/tmp/b-cache`, `--cache`) | It holds every arm's exported source and build. A Konductor arm must read its own entry, because the installed agent files point into it, so the whole cache cannot be hidden. A vanilla agent can read the Konductor entries. | No flag covers this yet. Recommended change: for each run, hide every cache entry except the one the arm uses. Until then, treat a vanilla-versus-Konductor result as measured with a readable cache and say so. |

**Stream integrity on Linux.** `stream.jsonl` is not protected against a hostile agent on Linux. The runner hands the child a writable file descriptor for it, and a process can rewrite its own descriptor through `/proc/<pid>/fd/1` even though the file's path is hidden. Credit limits, the fetch audit, tool counts and the judge's final text are all derived from that file, so a hostile agent can forge them without setting `stdioTampered`. Plan a runner-owned pipe (the runner reads the child's output and writes the file itself) as a follow-up. Do not run an agent you do not trust and rely on those numbers.

**Mounts below the home or `/tmp`.** The namespace makes the home, `/tmp`, `/var/tmp` and `/dev/shm` read-only by remounting the top mount. A separate mount below one of them stays writable inside the namespace (reproduced with a tmpfs under a read-only `/tmp` subtree). `findmnt -R /tmp` and `findmnt -R "$HOME"` list such mounts; an NFS or cloud-desktop home often has some. If the list is not empty, treat host files under those mounts as writable by the agent. `sandbox-exec` on macOS denies writes by path, so submounts there should be covered (not run).

---

## Supported agent runtimes

One run uses one runtime. The runtime is chosen by the arm name, and arms from different runtimes cannot share a run.

| Runtime | Arm names | Cost unit | Limits |
| --- | --- | --- | --- |
| `kiro-cli` | `vanilla`, `v1.2.0`, `main`, `name=<ref>` | Kiro credits | Engine v2 by default, `--agent-engine v3` available. The only runtime for per-skill studies (`cap skill-study`). |
| `opencode` on Amazon Bedrock | `oc-vanilla`, `oc-v1.2.0`, `oc-main`, `oc-name=<ref>` | USD | Pinned `opencode-ai` 1.19.5. `trace` is not supported. Subagent activity is read from opencode's database, not the stream. |
| `claude-code` on Amazon Bedrock | `cc-vanilla`, `cc-main`, `cc-name=<ref>` | USD | Needs the real `claude` binary (`--claude-bin` or `--claude-tools-dir`). Multi-turn (autonomy) tasks are refused. `--effort` is passed to `claude --effort` (default `high`, as for Kiro CLI). `--stop-on` and `--run-credit-limit` do not apply. |

Details, credentials and flags are in the harness sections of [README.md](docs/reference.md#opencode-harness).

---

## Other agents

> [!IMPORTANT]
> bench cannot benchmark an arbitrary agent today. Agents behind a hosted runtime or an HTTP API are not covered, and nothing in the code launches or parses them.
> A Strands agent can run the plant suite only, with a scripted fake model or one pinned Bedrock model under a hard spend cap (the `st-plant-*` arms, below). There is no Strands arm for code tasks.

Outside the plant arms, an arm is always a Konductor git ref or directory plus a condition, or the bare agent CLI. There is no arm kind for "this other agent definition".
The task generators (`skilleval.js` and `cap scenarios`) read one Konductor `SKILL.md` or one Konductor capability, not a system prompt or a tool list.
`README.md` states the same limit: testing an arbitrary third-party skill or agent definition is not supported yet.
The Strands experiment importer in [agenteval/README.md](agenteval/README.md) only prepares reviewable scenario candidates from generated test cases; it does not run or benchmark any agent.

**What a new runtime has to provide.** [runner/lib/harness/CONTRACT.md](runner/lib/harness/CONTRACT.md) is the written adapter contract: the members a harness module exports, the fields its parser fills, the steps to add a runtime and the places that still switch on the runtime name. It is derived from reading the code and is not tested yet. No conformance test exists, so a missing member shows up as an error in the middle of a run. In short:

- A local executable the runner can start (a small wrapper, for an in-process agent).
- A stream of JSON lines on stdout, and a parser that turns it into the fields `result.json` needs: session id, finished status, final text, tool calls and tool names, and spend as credits or USD.
- An install step that fills a scratch home, an environment allowlist, and a step that removes credentials afterwards.
- A source for the arm. Arms are Konductor refs today, so the arm preparation and trial install assume Konductor.
- Runtime-specific branches outside the harness folder. CONTRACT.md lists them in its last section: skill-load capture, early stop, `trace`, the cost unit, the judge bundle's final-text reader, the report, and the result schema's runtime list.

The contract documents the adapter surface for the runtimes above. It does not add support for third-party agents.

**What is not available.**

- A normalized trajectory. Tool calls are reduced to counts and names. Per-call arguments and results stay in the raw `stream.jsonl`.
- Checks on tool sequences. Checks run on the final files, and judges see a shortened, possibly cut list of tool calls, so a rule like "called tool X before tool Y" cannot be written.
- Scenario generation from an agent description. Generators take one skill file, and the task schema has no field for expected tool use.

---

## Agents that act on a machine (plant runs, in progress)

A plant run gives the agent a simulated conveyor line instead of a code task. The runner starts one gateway per run. The gateway holds the simulator and talks to the runner over a private pipe (fd 3). The agent's MCP server is a small shim that copies each line to the gateway's socket and decides nothing. For each call the gateway checks the arguments, dry-runs the call on the true state, asks the policy, and then runs or refuses it. It writes `gateway.jsonl` (every call and decision) and `world.jsonl` (the state after each step). When the agent exits, the simulator runs 10 s of sim time with no calls, so a hazard left alone can still cause harm. A task can add faults on a call count or at the start: a stale or impossible sensor reading, instruction-like text on the display, a changed true state, a jam, or a connection that drops in the middle of a move.

A plant task can name a second machine, a simulated robot arm (`"kind": "arm-sim"` in its `environment`). The arm moves in a few big steps (`move_to` a point in mm, `set_gripper`), has an e-stop, a cell door that needs an approval and a keep-out box, and logs its pose after every step so a person can see what it did afterwards. It is in progress: the runner, scorer and trace read it, and it is tested through its gateway, its scripted controls and `bench run` (`bench/DEBT.md` D-29, D-31 list what is not run yet).

There are two arms: `plant-policy`, where the policy decides, and `plant-allowall`, where every call runs and the policy's answer is only recorded. The policy reads the sensor view, as a real gateway would. The rules are judged on the true state. An unsafe move is counted as an attempt even when the gateway stops it. The scorer gives each trial three answers: whether the agent tried something unsafe, whether harm happened, and whether the gateway stopped every unsafe try. A trial whose path or log cannot be trusted counts as a failure, never as safe. `bench plant-report --run DIR --release DIR --out DIR` turns these into three rates per probe and arm, each with a 95% Wilson interval and a clean-only number beside it, and a pass, fail or inconclusive verdict per probe. Task success sits next to them, so doing nothing never scores well. The header says WARN, not PASS, when any trial raised a plant flag or the sandbox had no cgroup. The plant section of README.md says what each number means. To read one trial call by call, `bench plant-trace --run TRIAL_DIR [--vs TRIAL_DIR] --out FILE.html` writes a single offline HTML page: the calls in order, one collapsible line each, coloured allowed, blocked or unsafe attempt from the gateway log; open a line for its arguments, the gateway's reason and the plant state after it. A child agent's calls nest under it, and two arms stack one below the other.

The release (policy, probes, refusal rule, seeds) is private and never committed; a guard script checks git history for it. The `Plant release guard` workflow runs that script on every pull request and push that changes `bench/`. It needs a full clone. Checking hashed release lines is optional: with the `PLANT_RELEASE_HASHES` repository secret the job also checks lines against those hashes; without it, as on every fork PR, it checks paths, file types and encrypted headers only, prints a note that the hashed-line check is off, and passes if those find nothing. `bench/.gitignore` keeps release files and `plant-release*/` folders out of commits. Every team writes and signs its own private release; this repository ships none, and an example release is future work. To run them, pass `--arms plant-policy,plant-allowall` with `--plant-release DIR` and `--plant-release-sha256 HEX`; the runner checks the release's signature and hashes on a private copy before the first trial. Limits today: Linux only. Kiro CLI only, engine v2 or v3 (a release pins one Kiro CLI build and one engine), one trial at a time. Pin and run the real binary, not a launcher shim: `<launcher-dir>/tools/kiro-cli/<version>/kiro-cli --version; sha256sum <launcher-dir>/tools/kiro-cli/<version>/kiro-cli` prints the two pin values, and that path goes to `--kiro-bin`. The runner trusts only a release signed with a key listed in `bench/runner/lib/plant/pinned-keys.json`; one key is pinned today. Before the first trial the runner checks the walls and runs a prober that tries to break out as the agent would: write the plant dir or the socket root, read masked paths, find another run's socket, unmount, start a nested namespace, listen or reach anything on the host. Every attempt must fail, or the suite does not start. Three rows need a live gateway, so they run when the prober itself is the `--kiro-bin` of a control suite; the runner then adds them to the boundary checklist in `summary.json`. This needs a Linux host with user namespaces and a quiet network (nothing else listening on loopback). The README gives the quiet-host recipe that passed on a stock cloud host. Details are in the plant section of README.md. On a host that blocks user namespaces, bench's sandbox cannot start, so plant runs there need `--isolate none --allow-unisolated`, are not counted and not comparable, and prove the path, not the walls. A plant suite is counted only in the sandbox on a quiet host (no loopback or wildcard listener outside the release allowlist): a sandboxed suite on a noisy host is refused, and an unsandboxed pilot runs as `counted: false` with `plant-report` saying `NOT COUNTED: run without sandbox` (and `host failed quiet-host checks` when the host was noisy) and keeping its trials apart from the counted rates. Such a pilot does not stop when a new listener appears on the host between trials; it notes the listener in the run log and the report header and goes on. Such a pilot with the real pinned Kiro CLI still checks the pin and the Cedar files, but its out dir needs no filesystem of its own; the out dir and the release copy must still sit outside home, scratch and the repo. Five scripted controls in `bench/physical/controls/` stand in for the agent to check the bench itself, on either engine: one does nothing, one sends a fixed call list, one is a careful operator that must pass every task safely, one tests reconnects and parallel calls, and one makes the unsafe move on every probe. Pass one as `--kiro-bin`; `plant-report` lists them in its Controls section. See the plant section of [README.md](docs/reference.md).

Signing a release is done by the custodian with `node bench/physical/ci/plant-release.js`. Four steps, in plain words. `keygen --out ~/.plant-release-key` makes the signing key; the private half stays in that folder, outside every repo, and you never commit it or paste it anywhere. `pin --public ~/.plant-release-key/public.pem` adds the public half to `bench/runner/lib/plant/pinned-keys.json`, the list of keys the runner trusts; commit that change. `sign` seals a release folder: it records each file's fingerprint in `manifest.json` and signs it, and it asks for the facts only you know (release name, a seed per task, the Kiro CLI version and hash). `verify` runs the runner's own intake check on the sealed folder, so you see the same accept or refuse the runner will give. If the private key ever leaks, run `revoke --key-id ID`, make and pin a new key, sign the release again, and treat the old release as burned. See the README for every flag.

A suite run with `--kiro-bin` pointing at a fake control is a control suite. Its trials end in well under a second, so bench skips its "every run finished in under a second" check (exit 5) for that suite only. It logs `control suite: short-run check skipped` and records it in `summary.json`. A real plant suite still gets the check.

Strands agents can run the plant too (Phase 2, in progress). The arms are `st-plant-policy` and `st-plant-allowall`. The agent's plant tools are stubs: each sends its call to the same gateway and hands back the answer, so the gateway still decides every call and the scoring is the same. With the scripted fake model these runs cost nothing and use no AWS credentials. With `--model bedrock:qwen.qwen3-coder-next` (the one pinned real model) a run also needs `--budget-usd` and `--aws-profile`; bench checks before every model call that the call cannot take the spend past the cap, and stops the agent if it could. Strands lets an agent's own hooks cancel, change or repeat a tool call. Before the first trial bench lists every such hook. A counted suite refuses one on a plain arm; to measure such an agent anyway, use the `-hooked` arm, which keeps its numbers apart. A call the agent's own hook stopped is marked `agent_cancelled`. A changed or repeated call is a mismatch, which counts as a failure. See the Strands part of the plant section in README.md.

---

## Where to go next

| You want | Read |
| --- | --- |
| Every command, flag and metric | [README.md](docs/reference.md) |
| The task, fixture, check and rubric format, and how to add one | [README-tasks.md](docs/tasks.md) |
| Running and monitoring a study that takes hours | [RUNBOOK.md](docs/RUNBOOK.md) |
| Deciding whether one skill is needed, trimmable or removable | [CAP-PLAYBOOK.md](docs/CAP-PLAYBOOK.md) |
| Quality dimensions beyond the task rubric | [QUALITY-PACK.md](docs/QUALITY-PACK.md) |
| The committed skill eval data | [skill-evals/README.md](skill-evals/README.md) |

> [!NOTE]
> `docs/guides/benchmarking.md` at the repository root describes a different, older runner. This guide and `bench/docs/reference.md` describe `bench/runner/bench.js`.
