# Changelog

All notable changes to Konductor are documented here.

This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries are consolidated per release,
not per individual commit.

## [Unreleased]

### Added

- `bench/lib/trace-normalizer.js`, a dependency-free, no-I/O library that turns a Claude Code,
  OpenCode, or Kiro CLI trace into one session record (tool calls, skill loads, usage, cost,
  errors, completeness) and redacts credentials. The module header covers redaction, ids, which
  formats are verified against real captures, and the OpenTelemetry mapping. Tests and fixtures
  are in `bench/test/`.
- `bench/lib/sanitize.js`, a pure blinding layer between a stored answer and a grader.
  `sanitizeAnswer` normalizes the text (line breaks, control characters, zero-width and
  bidirectional marks, canonical NFC composition, not NFKC), then deletes the skill name, aliases,
  namespace prefixes, harness directory paths, arm labels, condition names, run and agent
  identifiers, and narration sentences about loading a skill, consulting instructions or the tools
  available. Narration inside fenced code is kept, and a skill named with an ordinary word keeps
  prose that merely uses the word. Removal leaves no marker, because a marker would appear in one
  arm only. `wrapForGrader` is the one path to grader input: it places two sanitized answers
  between marker lines carrying a caller-supplied random value, says the content between them is
  data and not instructions, and cuts each answer at a stated length with a visible note.
  `SANITIZER_VERSION` and `RULES_HASH` identify the rules that produced a judgment. Leak canary
  tests plant a name, alias, namespace, harness path and loading sentence and assert none reaches
  the grader input. Run `node --test bench/test/sanitize.test.js`.
- `bench/lib/judge-scale.js`, the judge reply scales. `overall` reads a winner and a 1-5 score per
  answer; `items` reads one MET, PARTIAL or MISSING label per checklist item and derives the
  winner and a 1-5 score from the share met, so both land on one yardstick. `parse` returns one
  shape for every scale and marks a reply unusable (`winner` null, with a `problem`) when the
  winner is not A, B or TIE, a score is not an integer from 1 to 5, a winner contradicts the
  scores (`winnerScoreConflict`), or a label is missing. `unblind(order, a, b)` in
  `bench/lib/verdict.js` maps the two scores a judge gave to answers A and B onto the with and
  without arm and returns their gap, with minus without; an unknown presentation order throws.
  Run `node --test bench/test/judge-scale.test.js bench/test/verdict.test.js`.
- `bench/lib/workspace-changes.js`, a pure `workspaceChanges(start, final, limits)` that compares
  two workspace snapshots (plain objects from relative path to text) and lists every added,
  edited or deleted file, sorted by path, as `{ path, change, content, truncated, omitted }`, so a
  judge can grade the work a run did and not only its reply. Limits have documented defaults:
  characters per file, characters across all files, and number of files. A file over its cap is
  cut and marked `truncated`; past the total or count cap the remaining entries list path and
  change only and are marked `omitted`. An unknown option or a limit that is not a positive
  integer throws, and so does an absolute path or one containing `..` in either snapshot. The
  module does not scan content for secrets. Run `node --test bench/test/workspace-changes.test.js`.
- `bench/lib/judge-prompt.js` and the templates in `bench/judging/` (one per judge scale, with a
  README). `judgePrompt(task, a, b, options)` returns `{ prompt, nonce }`. Each arm is its reply
  plus the files its run changed (`workspaceChanges`, same limits for both arms), shown as a
  header per file (path and change) and the final text in a code fence longer than any run of
  backticks inside it; a deleted file shows its path and `deleted`, and an arm with no changes
  says so. Both templates tell the judge to grade the work in the files as well as the reply. The
  reply, every file path and all file text go through `sanitizeAnswer`. A judge sees only
  `task.task` and `task.rubric` (`JUDGE_VISIBLE_FIELDS`); `assertAllowListed` throws on any other
  field. The per-call nonce is in the prompt and is returned separately, so a caller can keep it
  out of the digest that finds a stored reply. A blinding test plants a sentinel in every other
  task field (`id`, `skill`, `kind`, `target_section`, `fixtures`, `checks` with patterns and
  negatives, `reference`, an unlisted field) and in the arm records, renders the real prompt for
  both scales, both orders and both pair kinds, and asserts none reaches it; it also checks that a
  skill name planted in a file path or file text is removed, that one arm's files never appear in
  the other arm's block, and that the two orders show the same file blocks swapped. Run
  `node --test bench/test/judge-prompt.test.js bench/test/metadata-blinding.test.js`.
- `bench/lib/provenance.js` now builds the input digests of the three stored benchmark records,
  next to `sha256` and `stable`. `pairInputs` covers a task run in one arm (task id, request, arm,
  the stored reply and workspaces, `loaded`); `judgmentInputs` covers one judge call (template
  version and sha, sanitizer version and rules hash, scale, order, seat and the rendered prompt,
  which holds the request, the checklist and both cleaned answers with their changed files); and
  `resultInputs` covers a skill result (decision rule digest, task set, pairs and judgments). The
  judgment digest leaves out the per-call marker id, which is random, so a stored reply can be
  found again. A pair carries a `runner_fingerprint`, an opaque string the runner plugin supplies
  to say what produced the run. `PROVENANCE_VERSION` is 1. Run
  `node --test bench/test/provenance.test.js`.
- `bench/lib/store.js`, the run store. `openStore(runDir)` keeps pairs, judgments and results as
  JSON under one run directory (`pairs/<skill>/<task>/<arm>.json`,
  `judgments/<skill>/<task>/<seat>.<order>.json`, `results/<skill>.json`). Every name goes
  through `slug.js` and every path is checked to lie inside the run directory; a write through a
  link is refused. Directories the store creates are 0700 and files 0600, written to a temporary
  name and renamed into place. Freshness is strict: `pairCurrent`, `judgmentDone`,
  `judgmentSettled` and `resultCurrent` treat a record that lacks any field of its format, or
  carries another digest, rule digest or provenance version, as not current. A judgment that gave
  no usable reply is retried until `MAX_ATTEMPTS` (3), then settled. Run
  `node --test bench/test/store.test.js`.
- `bench/lib/plan.js` and `bench/lib/judge-roster.js`. `planJobs({ [skill]: taskSet }, config)`
  lists the subject runs (one per task and arm) and the judge calls (one per task, seat and
  presentation order). It has no clock and no random seed, so a resumed run plans the same jobs.
  With fewer orders per pair than orders, `ordersFor` alternates the orders down a seat's jobs,
  starting at a point chosen by a hash of the skill and the seat, so each order is used
  `floor(k/n)` or `ceil(k/n)` times. The judge roster is user configuration, never code: each
  seat is `{ seat, family, plugin, model }`, and `validateRoster` requires at least three seats
  with distinct families and unique seat labels, rejecting an unknown field and reporting every
  problem at once. No model id appears in the code, a default config or a fixture. Run
  `node --test bench/test/plan.test.js bench/test/judge-roster.test.js`.
- `bench/plugins/replay.js`, a grader plugin that answers a judge call from a judgment already
  stored, so a stored run can be judged again with no model call, no credential and no network.
  A call is found by its judge input digest, which leaves out the per-call marker id, so a stored
  reply is found whatever marker the new prompt carries and only when the judge would see the
  same input. A key with no stored reply is an error, never a made-up reply; `canServe(digest)`
  lets a driver check every pending call first. `createReplayPlugin({ records })` and
  `replayFromStore(store, skills)` build one. Run `node --test bench/test/replay.test.js`.
- `bench/run/judge.js`, the judge driver, as a library with no command line, no spend ledger and
  no provider code. `runJudging` plans the judge calls of a skill, skips every judgment that is
  already settled, renders each prompt with `judgePrompt`, calls the seat's grader plugin, reads
  the reply in core (`bench/lib/judge-reply.js` and the scale's `parse`), stores the judgment
  atomically and builds the skill result. A plugin is `{ id, runGrader, canServe? }`;
  `runGrader({ prompt, model, limits, seed, input_sha256 })` returns
  `{ status, raw_text, usage, cost, error? }` with `status` one of `ok`, `refused`, `invalid`,
  `transient` or `credential_error`, and the contract is written in the module header. A failed
  call or a reply core cannot read is stored with its status and retried up to `MAX_ATTEMPTS`
  times, after which the pair's seat counts as `invalid` or `unscored`; a credential error stops
  the run and keeps finished work; a plugin that can say what it serves (`canServe`) is checked
  for every pending call before the first one is made. `scoreSkill` builds the result from stored
  judgments with no plugin, re-reading each stored reply (`bench/lib/score.js`) and un-blinding it
  to the with and without arm. A result made under another decision rule or from other inputs is
  rebuilt at no cost. Run `node --test bench/test/judge.test.js bench/test/judge-reply.test.js
  bench/test/score.test.js`.
- `bench/test/pipeline.test.js`, a whole-pipeline test that runs offline. A scripted grader judges
  eight synthetic pairs with a three-seat panel in both orders; the stored run is then judged
  again from stored files alone with the replay plugin, and scored again with no plugin, and both
  give the same pinned result (verdict `keep`, mean gap 2.08, 95% interval 1.79 to 2.37, eight
  scored pairs). The test also pins that a template edit, a sanitizer version change or a
  sanitizer rules change makes judgments pending, that a decision-rule change makes the result
  stale and rebuilds it with no plugin call, that a missing replay key errors and writes nothing,
  that a task id or seat label that could leave the run directory is refused, that a whole run
  leaves directories at 0700 and files at 0600 (skipped where modes are not enforced), and that
  the core, driver and replay sources import no network, process or provider module. Run
  `node --test bench/test/pipeline.test.js`.
- `bench/lib/treatment-check.js`, the treatment check for a control skill. A control pair counts
  only when its stored with-arm run shows the control's direction was taken: `checkTreatment`
  reads the reply and the final text of every changed file, never the sanitized text, and a
  refusal marker wins over a followed marker. A spec is `bench/controls/treatment/<skill>.json`,
  keyed by the task's `target_section`; a skill with no spec, or a section the spec does not name,
  is not checked and its pairs all count, which is the case for every real skill. `treatmentFor`
  maps a task set, `treatmentText` builds the text to read, `loadSpec` throws on a pattern that
  does not compile, and `specSha256` hashes every spec file. `decisionRuleSha256()` now covers
  that hash (`treatment_specs`), so editing a spec makes stored results stale and they rebuild
  from stored judgments with no model call. `bench/run/judge.js` runs the check when it builds a
  result and passes the records to `aggregateSkill`. Run `node --test
  bench/test/treatment-check.test.js bench/test/decision-rule.test.js`.
- `bench/controls/`, three control skills, each with a task set in the task schema's fields, and
  the file that explains them. A control has a known right verdict, so a run that misses it shows a
  fault in the method. `keep/SKILL.md` holds conventions of an invented team that no model can know
  (a commit subject, a service log line and a setting name); its tasks ask for the team's format,
  and the expected verdict is `keep`. `prune/SKILL.md` holds three coding directions that are
  plainly worse than the usual answer (a bare `except:` that returns `{}`, floats for money, an
  immediate retry loop with no limit); the expected verdict is `prune`, and its treatment spec
  `treatment/team-coding-notes.json` counts a with-arm run only when it took the direction.
  `null/SKILL.md` is a neutral skill for the null control, whose two arms are identical and whose
  expected verdict is review. Task sets are in `tasks/`: 10 tasks for keep, 12 for prune and 10 for
  null, because a verdict needs 8 usable pairs and one task is one pair, so each control can lose
  some and still decide. No `SKILL.md` names its role or its verdict; `README.md` there is the only
  place that does, and defines identical arms for the subject runner. Run `node --test
  bench/test/control-files.test.js`.
- `bench/lib/controls.js`, the control manifest and the run gate. The manifest lists each control
  with its skill, kind and expected verdict (`keep`, `prune`, and `needs human review` for null),
  whether its wording is the point (`skill_specific`, true for keep, which the later wording lint
  skips) and whether its arms are identical. `evaluateControls(results)` returns `PASS` or `FAIL`
  with a reason for each control: a control passes when its final verdict, after the word-check
  gate, equals the expected one, and a control with no result fails. The null control also fails a
  review that measured nothing (a load failure, an invalid pair or too few pairs), so a broken run
  cannot pass behind the expected verdict. `runStatus` is `PASS` only when every control passes, so
  a missing control fails the run. `runSummary(results)` returns the status, the control results
  and every real skill's result with `trusted` and `trust_reasons`; when the run fails, each real
  skill carries `trusted: false` and the failing controls' reasons, and its computed verdict is
  left as it is. Run `node --test bench/test/controls.test.js`.
- `bench/test/controls-pipeline.test.js`, the controls through the whole offline pipeline: stored
  pairs and crafted judge replies go through the judge driver, the treatment check and the
  aggregation, and the gate reads the stored results. Replies that favour the with arm make keep
  read `keep`; replies that favour the without arm make prune read `prune`; both pass the gate.
  Prune pairs whose stored run set the direction aside (shown as a counter-example, or narrated
  and so removed from the judge's view by the sanitizer) are dropped and counted as treatment
  failures; with 5 of 12 dropped, prune falls to review and the gate fails with the reason. A
  direction taken only in a changed file counts. The null control, with identical arms and
  independent noisy scores, never reads `keep` or `prune` over 20 fixed seeds, reads `keep` when
  one arm is given a one-point lean, and reads `keep` or `prune` by chance in about 1% of 2000
  seeds. A control at the wrong verdict, or a missing one, fails the run and marks the real skill
  `trusted: false` without changing its verdict. Editing a treatment spec changes
  `decisionRuleSha256()` and a stored control result made under the old spec is rebuilt with no
  plugin call. Run `node --test bench/test/controls-pipeline.test.js`.
- Word-check results on the stored pair. A pair record may carry `check_results`: one entry per
  word check of the task, `true`, `false` or `null` (no verdict), run on that arm's final
  workspace. A pair with no field has no word checks. The field is covered by the pair's input
  digest, so editing it makes the pair and the skill result built from it stale; a pair without the
  field keeps the digest it had before. The judge driver (`bench/run/judge.js`) passes each task's
  two lists to `aggregateSkill`, so `c_with`, `c_without`, `w` and the word-check gate are filled
  from stored data. Nothing here runs a check: the check evaluator comes in a later change and
  fills `check_results` from the arm's final snapshot.
- The skill result's `verdict.word_check` block now names `k`, the number of usable pairs that have
  a word-check gap, next to `pairs` (the same number), and `off_reason`, which says why there is no
  gap: too few pairs with checks ("3 pairs with checks, need 8") or a gap that is not finite. It is
  null when the gap was computed. Together with `graded` (the judge verdict alone), `verdict` (the
  verdict after the gate), `verdict.judge_verdict`, and `word_check.mean`, `ci` and `vetoed`, the
  result now carries everything a report needs. The gate rule and the thresholds are unchanged.
- `bench/lib/report.js`, `renderReport(run)`: a plain-markdown report of one run, from the object
  `runSummary` returns. It is deterministic and reads no clock, file or environment. It prints the
  run status and each control's verdict against the expected one; then, for each skill in name
  order, the final verdict and the judge-only verdict, the judge gap as a mean and 95% interval
  over the usable pairs, the word-check gap as a mean and 95% interval or "gate off: k pairs with
  checks, need 8", whether the gate changed the verdict and why, `trusted` and the reasons it is
  not, and the counts of load failures, treatment failures and unscored pairs. Every threshold is
  introduced as provisional. It copies named numeric and fixed-word fields only, so no task id,
  answer, file path or file content, and no text a treatment check matched, can reach it; a key
  that is not a valid skill name prints as "(unnamed skill)".
- `bench/test/word-check-pipeline.test.js`, word-check results through the whole offline pipeline.
  Each row of the combination table runs through the store, the judge driver and a replay of the
  stored judgments into a second store, which must give the same result: judge keep with checks
  that agree or are flat stays `keep`; judge keep with the with arm passing fewer checks but an
  interval that includes 0 stays `keep` with the negative gap in the result; an interval entirely
  below 0 becomes review; judge prune with a clear with-arm gain becomes review; a task with no
  checks counts in the judge mean and is left out of `k`; fewer than 8 pairs with checks leaves the
  judge verdict with the gate off and says so; a judge review stays review. A `null` check entry
  gives that pair no share and leaves it out of `k`. The pair digest covers `check_results`, and
  editing one makes the result stale and rebuilds it with no plugin call. Word checks do not
  change a judge input or a judge gap. Run `node --test bench/test/word-check-pipeline.test.js`.
- `bench/test/report.test.js`, tests for the report: two pinned full reports (all controls
  passing, and one failing control with the skill marked untrusted), the gate wording, order
  independence, a stored record rendering like its aggregate, and checks that no answer, file
  content, task id, matched snippet, other skill name or injected heading reaches the text, in a
  hand-built run and in a run through the store and the judge driver. Run `node --test
  bench/test/report.test.js`.
- `bench/lib/checks.js`, a pure matcher that evaluates a task's word checks against a workspace
  snapshot (a plain object from relative path to text), so a stored snapshot replays offline. The
  kinds are `file_exists`, `contains`, `not_contains`, `fixture_unchanged` and `file_absent`.
  Patterns are case-insensitive and multiline, at most 500 characters, must consume at least two
  characters and hold at least two literal ones, and may not use a lookahead or lookbehind or a
  shape that backtracks without bound. Every pattern run has a one-second limit and is charged to
  a work budget (`BUDGET_LIMITS`: evaluation, validation, lint, task set) that fails closed: a
  check the budget did not let run is reported as having no verdict (`isIndeterminate`), never as
  a pass. `bench/lib/pattern-syntax.js` parses pattern sources and builds the short texts a pattern
  accepts (`candidateMatches`); `bench/lib/negatives.js` requires a tolerant `contains` pattern to
  declare strings it must reject; `bench/lib/text-fold.js` is the one text fold the rest share
  (case, accents, look-alike letters and invisible characters ignored); `bench/lib/safe-path.js`
  holds the workspace-relative path rules (the run store's name rules stay in `slug.js`). Run
  `node --test bench/test/checks.test.js bench/test/negatives-cost.test.js
  bench/test/pattern-syntax.test.js bench/test/safe-path.test.js bench/test/text-fold.test.js`.
- `bench/lib/task-schema.js`, the benchmark task shape (`id`, `skill`, `kind`, `task`, `rubric`,
  `target_section`, `fixtures`, `checks`) with `validateTask` and `validateTaskSet`, which return
  problem strings and never throw. Given the skill text, a rubric item that repeats six or more
  consecutive words of it is a problem, after case, accents, look-alike letters, small words and
  up to two inserted words are ignored, and `target_section` must be a heading of the skill.
  `bench/lib/snapshot-loader.js` reads a directory into a snapshot with file-count and size limits,
  skips symbolic links, `.git` and `node_modules`, and refuses credential files and content that
  looks like a credential. `bench/lib/arms.js` builds the with-skill and without-skill arms from
  one agent configuration and skill set so they differ by exactly the target skill, and records
  the load mode. Run `node --test bench/test/task-schema.test.js bench/test/snapshot-loader.test.js
  bench/test/arms.test.js`.
- `bench/lib/task-lint.js`, a pure `lintTask(task, { start, reference? }, { skillText })` that
  checks the quality of a benchmark task before it is run. It returns `{ ok, failures, warnings,
  results }` and never throws. Gates (any one makes `ok` false): `task_invalid`, `snapshot_invalid`,
  `skill_text_missing`, `fixtures_mismatch` (the declared fixtures differ from the start snapshot),
  `start_passes` (a stay-out task whose untouched start fails a check), `reference_passes` (only
  when a reference snapshot is given) and `work_budget_exhausted`. Warnings: `start_fails`,
  `unearned_checks`, `duplicate_checks`, `trespass_fails`, `no_reference`, `literal_in_request`
  and `stay_out_task`. The lint makes no claim that a workspace which did not do the task cannot
  pass: the verdict is the with-minus-without gap, so a check both arms can pass cancels out of it.
  `bench/lib/hidden-fields.js` exports `HIDDEN_FROM_SUBJECT` (`checks`, `rubric`, `reference`), the
  fields a runner must never show the subject. The work budget for one lint is 3000 pattern runs
  in 8 seconds (`BUDGET_LIMITS.lint`). Run `node --test bench/test/task-lint.test.js
  bench/test/task-lint-table.test.js`.
- The task lint gate `skill_only_wording`. Whatever both arms can see cancels in the gap between
  them; only the skill text is held by the with-skill arm alone. For each `contains` check the lint
  takes the short texts its pattern accepts, reads them as the rubric quoting rule reads a rubric
  item (folded and stemmed words, punctuation ignored), compares a text of fewer than six words
  whole and a longer one by every run of six, and fails the task when such wording is in the skill
  text and in none of the request, the start paths and the start files. The message names the
  check and says to check structure the request names or to drop the check, since the judge still
  scores that point. A skill the caller marks with `options.skillSpecific: true` is exempt; the
  run driver reads that flag from the control manifest, so a task cannot exempt itself. A
  paraphrase of the skill is not found. A pattern with several branches fails when any branch is
  skill-only. Run `node --test bench/test/task-lint-skill-wording.test.js`.
- PR CI runs the bench tests (`node --test "bench/test/**/*.test.js"`) on Node 22.
- PR CI runs `make lint` (clippy with `-D warnings` and `cargo fmt --check`) on a pinned Rust
  toolchain; builds and tests stay on stable.
- The four phase-gated SOPs, such as `k-full-sdlc`, now carry an
  `Orchestration: strict (phase-gated SOP)` line and a sentence saying what strict means.
  `cli/gate-config/sop-orchestration.yml` lists every SOP as gated or not gated, and
  `make sop-orchestration-check` (run in PR validation) fails when a new SOP is unlisted, a
  gated SOP lacks the marker, or a gated basis cites a step heading that no longer exists.
- Gated SOPs can list their phases and gate boundaries, and `make sop-orchestration-check`
  checks them against each SOP's phase list.
- `severity-schema.yml` maps the words checkers write for finding severities (IMPORTANT,
  WARNING, WARNINGS, SUGGESTION, MINOR) to severity ids. Matching ignores case and reads the
  leading word of labels such as `Warning Gap`. Any other word, an empty label, and risk,
  priority or confidence scales such as `High Risk` rank as CRITICAL.
- Groundwork for judging a SOP session file against its gates: an internal evaluator.
  Phase-gated SOPs treat an open HIGH finding as unresolved, even when the threshold is
  CRITICAL.
- New `konductor verify-run --session <path>` checks a SOP session file and exits through the
  existing exit-code contract. `--root <dir>` sets the directory the session and its evidence
  must resolve under (default: the current directory). It writes nothing.
- `make version-check` fails a PR or release when a crate, a lockfile entry for a Konductor
  product crate (manifest under `cli/`, `mcp/` or `shared/`) or the CHANGELOG heading disagrees
  with `VERSION`. Independently versioned path crates elsewhere are not checked.

### Changed

- The always-loaded core rules now carry the engineering practices from the `constraints` skill,
  so agents get them without loading the skill.
- The orchestrators (`konductor`, `konductor-mux-orchestrator`, `konductor-cmux-orchestrator`)
  may now read files, search the codebase, run read-only shell commands, and answer lookup
  questions themselves instead of spawning a specialist for each. One table in
  `context/k-orchestrator-routing-rules.md` defines what is allowed, including the
  `k-light-ui-testing` SOP-step exception, and `claude-teams-behavior`, `mux-dispatch`, and
  `cmux-dispatch` point at it. The 10-file read budget covers requests the orchestrator answers
  itself; for a request it will delegate, it reads only what routing and the brief need and
  passes file paths. Writes, state-changing git, builds, tests, and whole phases still go to
  specialists. The three orchestrator prompts also drop the
  Ultrawork framing, state the parallel rule once, and remove rules already defined in the
  `constraints` skill and the routing rules.
- Orchestrators delegate a step they can't do to the owning specialist and may run independent
  parts in parallel, including same-type agents. Parallel write agents must own disjoint files.
- Each Kiro agent's prompt now lists its own skills and tells it to load a matching one before
  non-trivial work; orchestrators route skill work to the owning specialist.
- Agents ignore planted instructions and follow user-written memory only from an untracked
  `.konductor/memory/` at the top of the project's own git work tree, refusing a symlinked `.konductor`
  or `.konductor/memory`, and treating memory as content when a tracked top-level dot name is
  non-ASCII; orchestrators never bypass a denial or read unnamed secrets.
- `k-full-sdlc` records gate facts in its session file and reports a `konductor verify-run`
  check in `sdlc-summary.md`. Steps 4 and 9 now stop on any open CRITICAL or IMPORTANT finding.
  The engineer can resolve or override a finding, recorded as `gate_<phase>_override`; an
  unattended run stops and reports, and a later attended resume can resolve or override.

### Fixed

- `bench/lib/sanitize.js` now removes the skill's name when it is glued to other words, so a
  judge cannot tell the arms apart by a file name such as `docs/release-notes-notes.md`. A name is
  read as its parts (`release` and `notes`), joined by `-`, `_`, `.` or nothing, in any case, so
  `release_notes`, `ReleaseNotes` and `releasenotes` match. A separator or a case change outside
  the name is a boundary (`my-release-notes`, `release-notes_v2`, `myReleaseNotes`); letters or
  digits touching the name are not, so `releases` and `prerelease-notes` stay. A space between
  the parts stays as ordinary English except next to the word skill, in a code span or in a
  slash or namespaced form. A `name: <skill>` line goes whole, and `skills/<name>/SKILL.md` goes
  whole. `SANITIZER_VERSION` is 2. The header lists what is kept by decision and what is not
  caught. `bench/test/skill-name-leak.test.js` plants about twenty spellings in a reply, a file
  path and file content, for two names, on both judge scales and in both orders.
- The judge prompt now cleans a changed file in full and only then cuts it to the size limits.
  It used to cut first, so a cut inside the skill's name left a fragment such as `release-no`
  that the cleaner no longer recognised. `workspaceChanges(start, final, limits, clean)` takes the
  cleaner as a fourth argument and applies it to the final text of each file that will show
  content, so the limits count the cleaned text. A deleted or omitted file is never cleaned, so the
  extra work is bounded by `maxFiles` files of at most the snapshot size limit each. Replies were
  already cleaned before the cut. `bench/test/skill-name-cut.test.js` puts the cap inside the name
  at every offset, for the per-file cap, the total cap and the reply cap.
- Docs: under mux and cmux, Claude Code deny rules still block and ask rules deny; plugin agent
  and SOP names use the `konductor:` prefix; `skill-lookup-mcp --help` describes the filters.
- `--skill-name-filter` now limits each Kiro agent's skill server to that agent's declared
  skills; it used to serve every installed skill.
- Routing skills now agree with the orchestrator prompts. `mux-dispatch` peeks at a running
  pane only on the prompt's polling fallback, and `delegation-protocol` applies rule 5's
  fix-attempt cap and 2-Strike Circuit Breaker instead of its own cycle count, and limits its
  retry-once recovery to spawns that error, time out, or return nothing.
- The SOP Selection Contract no longer rules out single-procedure SOPs such as `k-plan`. A
  request matches a SOP row when it asks for what the row's User intent describes, a whole
  workflow or one named procedure. A single deliverable that no row describes still goes to an
  agent. Keyword overlap matches no row, and neither does a lookup the orchestrator answers within
  its read budget. A thorough codebase or documentation search matches `k-comprehensive-search`.
  The three orchestrator prompts now run the SOP check on every request, not only on multi-phase
  ones.
- The Claude Code plugin tag workflow checks the published tree out into its own directory, so
  it can still run the release scripts and create the tag.
- The README says the mux and cmux orchestrators skip permission checks and that the plugin's AWS
  MCP server is session-wide; the plugin release PR says to tag by hand.
- Claude Code agents and benchmarks use the Claude Code model ID (`claude-sonnet-5-5`), and the
  plugin ships `NOTICE.txt` with README links pinned to its release.
- `update --no-telemetry` now keeps a project opted out on later updates, and the new
  `--enable-telemetry` opts it back in. The skill-lookup MCP server follows the same setting.
- The Claude Code plugin's agents show up in `claude plugin details` and `/plugin`, and plugin
  agents no longer carry an `mcpServers` block that Claude Code ignores.
- `konductor config set` no longer drops other keys and blocks from `.konductor/config.yml`,
  such as a `telemetry:` opt-out. It now changes only the named key.
  The file is rewritten, so comments (including the field reference `init` writes), YAML tags,
  anchors and merge keys, quoting, and number spelling such as `0x1F` or `3.10` are not kept.

### Security

- `rustls` moves from 0.23.45 to 0.23.46 in the CLI, MCP server and shared crates. It fixes
  GHSA-c8m5-c952-6cm4 (TLS session secrets exposed in `Debug` output), GHSA-h2v8-394m-p7vv,
  GHSA-vp88-798v-h67f and GHSA-w44r-93j7-qv28.

## [1.2.0] - 2026-10-26

### Added

- Claude Code plugin telemetry. A plugin hook sends `agent_invocation` and
  `subagent_invocation` events for Konductor's own agents, in the CLI's format, with
  `claude-plugin` as the harness. It is on by default and shares the machine ID in
  `~/.konductor/telemetry.json` with the CLI. Turn it off with the plugin's
  `telemetry_enabled` option or any existing opt-out.

### Changed

- Every agent now loads `context/k-core-rules.md` at session start. It holds the NEVER DO
  rules, moved from the `constraints` skill, and a writing-habits rule: no em or en dashes,
  AI vocabulary, or filler in new sentences, even when nearby text has them.
- Every agent declares `humanize-writing`, and its description now covers writing as well
  as editing.

### Fixed

- The Claude Code plugin release candidate could include untracked build output (`cli/`,
  `build/`, `dist/`, `generated/`) from the release job's checkout. The candidate is now built
  only from the assembled plugin tree, its file list is checked against that tree, and any
  top-level entry outside the plugin's own files fails the build.
- Plugin installs could not delegate to specialists. Claude Code names plugin agents
  `konductor:<agent>`, so bare `Agent(k-developer, ...)` grants matched nothing. Plugin assembly
  now qualifies each grant with the plugin name and fails on a grant for an agent the plugin
  doesn't ship. `k-architect` also lost a stale package prefix on its grants.
- `mux-dispatch` and `cmux-dispatch` refused to dispatch in plugin installs: they only looked
  in `~/.claude/agents/` and rejected `:` in `--agent`. They now fall back to the plugin's own
  agents and accept `konductor:<agent>` for an agent the plugin ships. `cmux-dispatch` also
  refuses an agent file name that could inject a command into the pane.
- `mux-dispatch`, `cmux-dispatch`, `persistent-memory` and `legacy-to-agentic-estimate` could
  not find their bundled scripts in plugin installs. They now look in `${CLAUDE_SKILL_DIR}`
  first, then the global install, then a project install with a `.konductor/manifest`, then a
  konductor source checkout. A repo is searched only if it has `.konductor/manifest` or a
  `.claude-plugin/marketplace.json` that names `konductor`. Each skill stops with a clear error
  when its script is missing.
- The skill-lookup MCP server's `mcp_tool_call` events now include `parentAgentName` (as
  `null`), which `docs/telemetry-schema.json` requires on every event.
- `konductor update --cli` retries its smoke test of the downloaded binary when exec fails with
  "Text file busy" (ETXTBSY), instead of failing the update.
- `k-architect` and `k-developer` no longer tell agents to use `aws___call_aws`, a tool the AWS MCP server has removed. Both now point at `aws___run_script`, which runs sandboxed Python with AWS API access.
- `find-aws-skills`' failure-handling fallback no longer references `aws___suggest_aws_commands`, which the AWS MCP server does not expose. It now offers direct AWS API calls via `aws___run_script` (sandboxed Python).
- `aws-service-validator` calls `aws___get_regional_availability` with `resource_type` (required), `regions`, and `filters` (required for more than one region), instead of a bare service-and-region call.

### Security

- `rustls` moves from `0.23.43` to `0.23.45` in the CLI, the skill-lookup MCP server, and the
  shared telemetry test sink, fixing GHSA-2mjx-qc3c-rqvc (TLS 1.3 handshake messages were
  accepted across encryption level boundaries).

## [1.1.0] - 2026-10-14

### Added

- The Konductor Kiro Power at `powers/konductor/`, imported from
  `github.com/aws-solutions/konductor/tree/v1.1.0/powers/konductor`.
- `konductor-setup`, a skill that installs Konductor into the current project.
- `konductor-help`, a skill that answers questions about an existing install.
- 13 activation keywords in `powers/konductor/plugin.json`.
- `make kiro-power-check`, wired into `.github/workflows/validate-pr.yml`.
- An "Install via Kiro Power" page in the user guide, and a matching section in `README.md`.
- Manual setup docs for the AWS documentation-lookup MCP server and for Playwright.
- A Claude Code plugin marketplace install path: `/plugin marketplace add
  aws-solutions/konductor` then `/plugin install konductor@konductor`. See [Install via the
  Claude Code plugin marketplace](docs/user-guide/tasks/install-claude-plugin-marketplace.md).
- `tag-claude-plugin-release.yml` is a manually dispatched workflow, run after a human merges a
  plugin-candidate PR into `release/plugins`, that creates an immutable `claude-plugin-vX.Y.Z`
  tag on the merge commit -- so a `marketplace.json` entry can pin to a specific release instead
  of the branch's moving HEAD.
- `konductor-setup`'s `run-update.sh` and `run-uninstall.sh` accept an optional `--harness
  <name>`, forwarded to `konductor update`/`uninstall`, for a target that tracks more than one
  harness.

### Changed

- Every agent spec under `agents/` now runs `claude-sonnet-5.5` instead of `claude-sonnet-5`.
  The benchmark registry's `subjectModel` moves with it, so benchmarks measure the model that
  ships. Benchmark results recorded against `claude-sonnet-5` aren't comparable with new runs;
  the regression check refuses to compare across model pins.
- `make synth` (and `konductor synth`) now pre-wires AWS MCP (`aws-mcp`) into the standalone
  Claude Code install, matching the plugin build. Everything else stays bring-your-own. The
  bundled-server list lives in `scripts/claude-plugin-mcp-servers.json`.
- The plugin and standalone Claude Code builds launch `aws-mcp` through `mcp-proxy-for-aws-cli==1.7.0`. Pinning the proxy prevents unreviewed client changes while the managed endpoint continues to supply current AWS documentation and skills.

### Fixed

- `publish-claude-plugin` no longer fails when the assembled plugin tree already matches
  `release/plugins`' tip exactly (e.g. a re-release of unchanged plugin content). The job now
  skips the push and draft-PR steps and ends green with a notice instead of pushing an empty
  branch and failing at `gh pr create` with "No commits between".

### Security

- `aws-mcp` uses `mcp-proxy-for-aws-cli==1.7.0` instead of a moving package version. The managed endpoint still supplies current AWS documentation and skills.
- The plugin release no longer force-pushes directly to a public branch. `publish-claude-plugin`
  pushes a fresh, collision-resistant candidate branch (release version plus workflow run
  identifier) and opens a **draft** pull request into the protected `release/plugins` branch,
  using `GITHUB_TOKEN` scoped to `contents: write` and `pull-requests: write` only. The
  `plugins` branch ruleset (creation/update/deletion/non-fast-forward blocked, zero bypass
  actors) and the org-wide two-approval PR ruleset gate the actual merge. A separate workflow,
  `tag-claude-plugin-release.yml`, creates the immutable `claude-plugin-vX.Y.Z` tag only after
  that PR is merged into `release/plugins` by a human reviewer.
- `k-architect`/`k-developer` still grant AWS MCP's full tool surface, unchanged. Use the
  `aws:ViaAWSMCPService`/`aws:CalledViaAWSMCP` IAM condition keys to scope or audit
  agent-originated calls.
- `release.yml`'s `workflow_dispatch` trigger bypassed `check-version`'s branch gating: any
  branch with an unreleased `VERSION` bump could trigger a real `gh release create`, and by
  default, a force-push to the public `claude-plugin` branch. Removed the manual-dispatch path
  entirely; `validate-pr.yml` now runs `claude plugin validate --strict` against the assembled
  plugin tree on every PR instead, with no publish or push step anywhere in its job graph.

## [1.0.3] - 2026-10-01

### Fixed

- Telemetry now works on Kiro CLI v2 and v3. Before, only Claude Code sent agent usage events.
- `konductor install --harness claude` now sets up telemetry, so Claude-Code-only installs
  report too.
- Each agent run is counted once, even with both a global install (in `$HOME`) and a project
  install. Before, Kiro v3 and Claude Code counted it twice. If your global install is from an
  older version, `konductor install` warns you to run `konductor update --target ~`.
- `--no-telemetry` now turns telemetry off for a project completely: also when the project was
  installed with telemetry on before, and when a global install is present.
- `konductor uninstall` now removes Konductor's Claude Code telemetry hooks. Before, they stayed
  in `.claude/settings.json`.
- Sessions started in a project directory now report when Konductor is installed globally, the
  default. Before, they sent nothing.

### Changed

- A project install now writes its Claude Code telemetry hooks to `.claude/settings.local.json`
  instead of the shared `.claude/settings.json`, and moves any hooks an earlier version put there.
  The hooks carry this machine's paths, so they no longer get committed for teammates. If the
  repository doesn't already ignore the file, it is added to `.git/info/exclude`. A global install
  keeps its hooks in `~/.claude/settings.json`.
- Telemetry now covers only Konductor's own agents (the orchestrators and `k-*` specialists). Your
  own agents, a harness's built-in agents, and sessions with no named agent send nothing.
- Delegations to Konductor agents are reported on every harness, including the name of the
  delegating Konductor agent when the harness provides it.

## [1.0.2] - 2026-09-28

### Security

- Upgraded the `rmcp` dependency of the `skill-lookup` MCP server (`mcp/servers/skill-lookup`)
  from 0.1.5 to 2.1.0, closing four Dependabot alerts against `rmcp`'s Streamable HTTP
  transport: [GHSA-9g45-5xwm-f3wc](https://github.com/advisories/GHSA-9g45-5xwm-f3wc) (missing
  OAuth resource validation), [GHSA-9pj6-vhgr-3mwh](https://github.com/advisories/GHSA-9pj6-vhgr-3mwh)
  (session-table denial-of-service leak), [GHSA-33f5-2c5q-wgwj](https://github.com/advisories/GHSA-33f5-2c5q-wgwj)
  (cross-origin redirect header leak), and [GHSA-89vp-x53w-74fx](https://github.com/advisories/GHSA-89vp-x53w-74fx)
  (DNS rebinding via unvalidated Streamable HTTP requests). `skill-lookup-mcp` only uses `rmcp`'s
  stdio transport, so none of these four issues were reachable through this server's own
  deployment, but the fixed version is required to clear the Dependabot alerts regardless.

### Testing

- Added shakedown test coverage for the `skill-lookup` MCP server's handshake, `find_skills`,
  `get_skill`, and `reload_skills` handlers, plus full-tool-surface coverage, exercising the
  upgraded `rmcp` 2.1.0 integration.

## [1.0.0] - 2026-09-23

### Added

- 8 specialist agents (product manager, architect, developer, QA, researcher, technical program
  manager, browser, media analyzer) plus three orchestrators (`konductor`,
  `konductor-mux-orchestrator`, `konductor-cmux-orchestrator`) that coordinate them across the
  SDLC, delegating work, tracking progress, and enforcing a maker-checker quality gate on every
  handoff.
- 82 skills across 8 capability areas: architecture and design, planning and tracking,
  architecture and development review, testing and QA, orchestration and delegation, Kiro spec
  generation, documentation and writing, and research and security.
- 19 agent-sops, invoked as `/prompts` entries in Kiro CLI and as `/sop-<name>` skills in Claude
  Code, covering design doc creation, code review, E2E test
  generation, and a full end-to-end SDLC pass (`k-full-sdlc`).
- Persistent memory: a local, cross-session scratchpad under `.konductor/memory/` that needs no
  setup, with a validator enforcing size limits and an optional URL allowlist.
- Multi-runtime support for Kiro CLI v2, Kiro CLI v3, Kiro IDE, and Claude Code.
- The `konductor` CLI with `install`, `update`, `uninstall`, `synth`, `init`, and `doctor`  
  subcommands.
- A `skill-lookup` MCP server that works with Kiro CLI v2, Kiro CLI v3, and Kiro IDE.