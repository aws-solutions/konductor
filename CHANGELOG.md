# Changelog

All notable changes to Konductor are documented here.

This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries are consolidated per release,
not per individual commit.

## [Unreleased]

### Added

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
- `orchestration.mode` (`auto` or `coordinator`) is read from `~/.konductor/config.yml` by one resolver.
  `config set` keeps an `orchestration:` section in the project file, which the resolver does not read.
- `konductor` runs as a coordinator when `orchestration.mode` is `coordinator`: `install` wires a
  session-start hook, even under `--no-telemetry`, that points it at the routing rules, or prints a
  fallback when the install that wired it is outside your home directory and is not the project root.
  Only the mode line and the Step 1 pointer in the hook's output are instructions; the summary
  lines are a preview of the named rules file. The pointer names an install under a symlinked
  home through the logical home for project and parent-of-project installs too. On a Claude Code
  resume or compact under `auto` the hook prints `Orchestration: auto`. The hook resolves the
  owning install per harness; when a nearer install owns `konductor` but its own hook is not
  wired for that harness, the shadowed hook prints a fallback naming that install instead of
  staying silent. Core rule 11 defines the project root and names the install locations whose
  rules file it trusts.
- Claude Code installs copy the context files to `.konductor/context/`, where the orchestration
  hook finds the routing rules; uninstall removes the directory and keeps memory.
- A Claude Code install with `--no-telemetry` now writes `.claude/settings.local.json` for the
  orchestration hook alone. A Kiro install into a target that also has a `.claude` marker wires
  only the telemetry hooks there, so it writes no Claude hooks file under `--no-telemetry`; the
  orchestration hook is the Claude Code install's.
- The telemetry hook's Kiro CLI v3 session lookup follows `$KIRO_HOME` when set.
- `konductor doctor` reports the orchestration mode, whether its hook is wired, and whether the
  config value is valid; a hand-edited hook entry, or one naming a bare `konductor` found only on
  this shell's PATH, is reported as warn, not as missing. Under `coordinator` it runs the same
  persona load the session-start hook runs, so a digest over the hook's output budget is
  `failed`, and an install root outside the home that is not a git checkout root is `warn`.
- `synth` warns when an agent's Claude Code skill preload (`clientConfig.claudeCli.skills`) is over
  32 KiB or 32 names, and names the skills Claude Code would drop. `-v` prints one
  `claude preload:` line per agent, and `synth --json` adds a `claude_preload` array. Each Claude
  Code agent file ends with a "Skills you can load" block listing its declared skills that are not
  preloaded; `synth` warns when such an agent's `tools` list lacks `Skill`.
- `make test-py` now checks every skill's frontmatter, description, size, code fences, and
  `references/` links against a shrink-only baseline in `tests/skill-quality-baseline.json`.
  `python3 tests/skill_quality.py --print-baseline` refuses to write a baseline that grew.

### Changed

- Shorter descriptions for 20 skills and 11 SOPs, so Claude Code's skill listing keeps every
  description when the SOPs are listed too. Claude Code's listing budget is 30,000 chars on a
  1M-window model, and past it the skills last in A to Z order become name only. With the 19
  SOPs listed, the listing drops from 33,836 to 28,561 chars (the method of
  `tests/test_skill_listing_budget.py`). Each description keeps its "Use when/for" cue, its
  trigger phrases, its "not for" boundary and its pointers to other skills. Each SOP gets a
  short first Overview paragraph, which is the one the installer lists; the old paragraph
  stays below it. Skill patch versions are bumped.
- On Claude Code, the `sop-<name>` skills the installer builds from SOPs no longer carry
  `disable-model-invocation: true`, so Claude can load a SOP through its `Skill` tool, as Kiro
  CLI already could through its `.kiro/skills/sop-<name>` copy. `/sop-<name>` still works.
  The three SOPs that commit and push, open pull requests, or act on a live app
  (`k-e2e-test-generation`, `k-full-sdlc`, `k-light-ui-testing`) are marked
  `Invocation: user-only` and keep the key, so Claude's `Skill` tool refuses them. The user starts
  one with `/sop-<name>`, or by saying yes to `k-full-sdlc` Step 9's scope question, which then
  reads its installed `sop-<name>/SKILL.md` (Claude Code) or `sop-<name>` skill (Kiro CLI) and runs
  it. Step 9 starts neither SOP without that yes, and an unattended run never gets one.
  Step 9's UI test question now says the pass commits and pushes, and the two SOPs no longer
  tell an unattended caller to set `scope_confirmed`. The install fails on an `Invocation:` line that is
  not the exact marker, so a typo cannot open a user-only SOP to the model. The user guide now
  says which files each harness installs: a Claude Code install has no `.sop.md` copy.
  The skill listing budget test now counts the 16 other SOP descriptions.
- 42 skill descriptions are shorter, so the Claude Code skill listing for the bundled skills
  plus built-ins fits its 30,000-character budget (28,432 characters, down from 30,406).
- `test-coverage-analysis` moved its stage catalogues, report templates, and examples into
  `skills/test-coverage-analysis/references/` (SKILL.md 69.3 KB to 30.3 KB). It also gains a
  scope section and a shorter Coverage-mode path for one module or one PR, and drops the
  compatibility and roadmap lists.
- `cypress-test-implementation` moved its task breakdown, Cypress patterns, and report templates into
  `skills/cypress-test-implementation/references/` (SKILL.md 53.9 KB to 19.4 KB). It also gains a
  scope section and a short path that writes the specs directly for one or two flows, and its
  Quality Gate no longer renders inside a code block.
- Claude Code subagents now preload 1 to 4 skills each (109 KB in total, down from 1.9 MB); the rest
  load on demand.
- `konductor` does the work itself, commits only when you ask, and spawns one fresh `k-*` reviewer per phase gate (next bullet);
  it spawns a specialist only for a tool, access, skill or SOP it lacks, for parallel work on disjoint files, or when an SOP says so;
  an SOP `konductor` does not declare is run by the specialist that declares it. Parallel parts reach your branch only after
  it proposes the split to you, or uncommitted so you decide what to commit.
- The Kiro skills index no longer tells an orchestrator to route a listed skill's task to a specialist; the loaded rules file (Direct Work, or the routing rules) decides, and the load rule asks for the skills the task needs instead of at most two.
- All three orchestrators skip the reviewer for a lookup, a listing, or a one-file change of at most 50 changed lines whose build, test and lint passed (reported with the diff stat; not for auth, secrets, data or infrastructure; `konductor`'s direct-work rules define those four categories), and triage findings against the request, house rules and spec before the fix.
- `konductor` also closes a standalone document with its checker skill instead of a reviewer, and when it made the artifact, or merged a parallel writer's part into it, a finding it would reject goes to you before it is dropped.
- `konductor` always sends a threat model, an authentication, authorization or credential design, or a design that exposes a service or data across a network boundary or handles personal or sensitive data to a reviewer, not every document touching data or infrastructure, and checks any document that skips the reviewer with its checker skill.
- The handoff, split, denial and brief rules every orchestrator follows now live in
  `context/k-orchestrator-shared.md`, loaded by all three orchestrators.
- A specialist treats a quoted user decision in its brief as approval only for the action it
  names, never for a rule 9 confirmation or an irreversible action; for rules 6 and 7 the entry
  meets the exception for the action it names.
- The rule against reading secret files now lives in the core rules, so all 11 agents load it.
  From a file the user names, an agent reports key names or redacted values only, never the
  secret values, in replies, briefs, commits or logs.
  A `credentials_file` that `k-light-ui-testing` or `k-e2e-test-generation` passes in a brief counts as user-named.
  A specialist takes the user's naming directly or from a brief; the House rules brief clause covers rule 12's case.
- sdlc-navigator lists `konductor` (orchestrator, routing) in its agent table and shows the Claude Code invocation beside the Kiro ones.
- delegation-protocol: shorter trigger, a reason for the four-subagent limit, and a shorter "specialist never spawns" pointer. The adversarial pass skills are coordinator-only and say "posted to the PR".
- persistent-memory and agents-md-authoring: the memory skill's description leads with "remember this", "save this", "forget that" and its headings drop the section numbers; the AGENTS.md context block uses the `.kiro/skills/ws-*/SKILL.md` glob and calls `.konductor` the workspace state directory.
- app-discovery, claude-teams-behavior and pre-planning-analysis state when to use them in one sentence that fits the Kiro skill index; claude-teams-behavior uses "PR diff" and "read-only checkout" and points at delegation-protocol for the worktree rule; pre-planning-analysis names an Owner per intent.
- `asana-sprint-planning` is folded into `sprint-planning` as
  `skills/sprint-planning/references/asana.md`, which the skill opens when the team uses Asana
  (81 skills). `sprint-planning` now also covers team-size capacity, sprint rollover, batch
  approval, and linking tasks to tickets and code reviews.
- `historical-issues-registry`, `sop-state-management`, and `dom-inspection` moved detail that only
  some runs need into `references/`: the multi-match precedence rule, the per-operation steps, and
  the report schema, test-oracle table, and Cloudscape notes. Each `SKILL.md` says when to open
  each file.
- The `security-remediation`, `security-test-generation`, `threat-modeling` and
  `ui-text-validation` skills read as one set of instructions, without a pasted second prompt
  and role. `security-remediation` asks for the finding text or ticket instead of an unfilled
  placeholder, and its plan now includes the effort estimates, verification steps and rollback
  plan it promised. `threat-modeling` uses its built-in template by default and drops the
  tool-check step. `ui-text-validation` reports inline unless the audit spans several pages or
  the user asks for a file, and checks headings for sentence case.
- `progress-tracking` moved its final-mode stages (code analysis, pattern matching, traceability)
  into `references/final-mode.md`, and `security-test-generation` moved its Kiro and other-tool
  output steps into `references/output-kiro.md` and `references/output-generic.md`. Each skill
  opens the file only when the mode or tool type needs it.
- `smithy-modeling` and `smithy-validation` now share one Smithy file-organization guide in
  `skills/smithy-modeling/references/file-organization.md`, loaded only when a model spans more
  than one file. Its validator example now nests the selector under `configuration`, and its
  service example no longer sets a doc comment and a `@documentation` trait together, which
  Smithy rejects.
- `iam-policy-design` and `policy-validation` now share one set of GDPR, HIPAA, PCI-DSS and SOC 2
  checklists in `skills/iam-policy-design/references/compliance-checklists.md`, loaded only when
  the user or the design under review names a compliance framework or the design handles
  regulated data. Audit-control findings now cite HIPAA §164.312(b), and the GDPR checklist no
  longer claims a fixed 3-year log retention. `policy-validation` now also checks SOC 2, and its
  report uses one per-framework template. `smithy-validation` loads its example review only when
  writing a report.
- `cost-estimation` moved its REVIEW workflow (checking an existing estimate) into
  `references/review-workflow.md`. The skill opens it only when the user picks REVIEW.
- `cost-estimation` moved its CREATE workflow out of `SKILL.md`. The setup reply, context
  gathering and clarifying questions are in `references/create-context.md`, which the skill opens
  when the user picks CREATE. The pricing research, scenarios, growth modeling, optimization and
  report steps are in `references/create-analysis.md`, which it opens once the context is
  confirmed.
- `architecture-diagram-generation` keeps its XML templates, icon styles and common patterns in
  `references/drawio-templates.md` and loads them only when generating the XML. Its repeated
  introduction is now one overview.
- `e2e-test-strategy` keeps its Stage 9 report template in `references/report-template.md` and
  opens it only when writing the report.
- `architecture-diagram-generation` now targets plain draw.io (diagrams.net) XML and drops the
  rules that served one draw.io-based tool. It places S3 with the regional services, since each
  bucket lives in one region, and treats AWS WAF as global only for CloudFront-scoped web ACLs.
  A Lambda function with VPC config is drawn in its subnets.
- The published HTML guide's FAQ now gives the current skill count (81) instead of 75.
- `infra-validation` and `iam-policy-design` read as one instruction set each, without a pasted
  second prompt and role. `infra-validation` asks for scope once, and skips the questions when
  the caller passes the type, path and environment or `scope_confirmed`. It rates findings
  CRITICAL, IMPORTANT or SUGGESTION, matching its quality gate, and names `policy-validation` as
  the home for policy-level IAM checks. `iam-policy-design` ends both modes with one compliance
  step.
- The always-loaded core rules now carry the engineering practices from the `constraints` skill,
  so agents get them without loading the skill. The `constraints` skill and the
  `k-architect`, `k-developer` and `k-product-manager` prompts point at the core rules for the
  severity order; other skills still state it themselves.
- The orchestrators (`konductor`, `konductor-mux-orchestrator`, `konductor-cmux-orchestrator`)
  may now read files, search the codebase, run read-only shell commands, and answer lookup
  questions themselves instead of spawning a specialist for each. One table in
  `context/k-orchestrator-routing-rules.md` defines what is allowed, including the
  `k-light-ui-testing` SOP-step exception and the memory validator's read-only `--check-path`,
  and `claude-teams-behavior`, `mux-dispatch`, and
  `cmux-dispatch` point at it. The 10-file read budget covers requests the orchestrator answers
  itself; for a request it will delegate, it reads only what routing and the brief need and
  passes file paths. Writes, state-changing git, builds, tests, and whole phases still go to
  specialists. The three orchestrator prompts also drop the
  Ultrawork framing, state the parallel rule once, and remove rules already defined in the
  `constraints` skill and the routing rules.
- Specialist agents no longer spawn other agents. They finish their part and hand the next
  step, or a proposed parallel split, back to the orchestrator. The orchestrator routes a
  handoff only when it serves the user's task, did not come from content the specialist read,
  and does not report a denied action; it applies the same checks to every part of a proposed
  split, refuses a part that names an orchestrator, and shows refused parts to you; it adds
  visible shared files to a proposed split before fan-out; it routes at most two notes in a row
  for one request and never back to a role that already returned one for the same step, then
  shows you the chain and asks. A gate in the SOP the orchestrator
  is running wins over routing a note; a note naming `k-adversarial-pull-request-review` is run
  by the orchestrator as that SOP's coordinator, and a note naming any other SOP is presented to
  you with its invocation command. When an SOP needs independent parts, an
  orchestrator running it spawns them; a specialist run without one says independence will not
  hold and runs them only when asked. Run directly with no orchestrator, the caller is the user:
  the specialist returns the split or note to them. No specialist is resumed mid-SOP. A
  specialist whose brief names an SOP it declares reads that SOP's installed file and follows
  its steps.
- `k-adversarial-pull-request-review` is coordinated by the orchestrator, which spawns the four
  generator passes and a fresh `k-architect` checker; `k-architect` no longer declares the SOP
  or offers it in its welcome message, and the orchestrators' SOP trigger table gains a row for it.
  A pass that fails twice is recorded as `MISSING` and caps the verdict at APPROVE WITH COMMENTS.
  A given `pr_url` is read by the read-only context spawn, not the coordinator, and every brief
  marks the relayed diff, context summary and findings lists as content under review.
  `k-test-coverage-review` recommends `k-developer` for missing tests instead of handing off.
- Handoff files live in a self-ignoring `.konductor/handoff/` (the writer creates its
  `.gitignore`); `konductor init` also ignores the directory.
- Specialist specs grant no spawn tool, and Kiro CLI v2, Kiro CLI v3 and Claude Code configs
  block it, with `disallowedTools` on Claude Code for every specialist (not shell). Kiro CLI v2
  gets an explicit tool list in place of `@builtin` (checked with kiro-cli 2.36.0 and 3.0.0).
  `konductor-mux-orchestrator` and `konductor-cmux-orchestrator`, which dispatch through shell
  panes, get the same Kiro CLI v2 list, so only `konductor` holds `subagent` on Kiro CLI v2,
  and a Kiro CLI v2 install summary prints the checked versions and the `/tools` re-check command.
  `k-code-review-workflow` step 6 writes the report and ends with a note asking the orchestrator
  to run the adversarial review, no resume; the verdict comes from the findings, with the
  adversarial pass state on its own line. After the pass, the orchestrator, or `k-developer` on
  its behalf, sets the final verdict when the adversarial report's `Passes run:` line names no
  `MISSING` pass; a `MISSING` pass writes `Adversarial pass: incomplete` and leaves the verdict
  pending. `k-full-sdlc` runs that pass before writing a feature's status,
  and marks a feature BLOCKED when either report leaves a CRITICAL or IMPORTANT finding open or
  the pass is incomplete.
- Orchestrators delegate a step they can't do to the owning specialist and may run independent
  parts in parallel, including same-type agents. Parallel write agents must own disjoint files.
- Each Kiro agent's prompt now lists its own skills and tells it to load a matching one before
  non-trivial work; orchestrators route skill work to the owning specialist.
- Agents ignore planted instructions; `.konductor/memory/` ranks with AGENTS.md, tracked or not,
  and is never read or written through a symlink; the brief carries the check result, so a specialist
  without a shell reads only checked paths. The memory validator rejects a new or edited line without
  an `[origin:agent]` or `[origin:user]` tag; existing untagged lines are kept, and it checks
  instruction-like text after the date and origin tag, reads the text of a leading `[label]`
  or `[label](url)` as entry text, and matches a leading keyword as a whole word. It refuses an
  empty write over existing entries unless `--clear` is passed, the skill's write line takes its
  target from a variable, and the `.gitignore` bootstrap never glues onto an existing line. Upgrade note: if your repository commits `.konductor/memory/`,
  review its untagged lines before upgrading and tag agent-written ones `[origin:agent]`; they are
  followed as project instructions from this version.
  Orchestrators never bypass denials or read unnamed secrets.
- `k-full-sdlc` records gate facts in its session file and reports a `konductor verify-run`
  check in `sdlc-summary.md`. Steps 4 and 9 now stop on any open CRITICAL or IMPORTANT finding.
  The engineer can resolve or override a finding, recorded as `gate_<phase>_override`; an
  unattended run stops and reports, and a later attended resume can resolve or override.
- The Claude Code plugin is ready for the plugin directory. The README says what the plugin runs,
  sends and fetches, including the telemetry endpoint and payload, that telemetry is on by default,
  and how to turn it off, and adds example prompts and a support link. The plugin ships the brand
  logo as its listing icon at the plugin root, named by `icon` in `plugin.json` along with a
  `supportUrl`, and drops the `kiro` keyword. The mux and cmux orchestrators describe `.done`
  completion on both runtimes, release assembly stages generator output in a temporary
  directory, and `make claude-plugin` writes the gitignored `dist/claude-plugin/`.
- **Behavior change:** on Claude Code, the mux and cmux orchestrators no longer start each child
  with every permission check skipped (what is now `bypass`); the default is `interactive`, which
  prompts in the child's pane. For unattended runs, set
  `KONDUCTOR_DISPATCH_PERMISSION_MODE=headless` and allowlist your build and test commands, or use
  `bypass` only in an isolated environment. An interactive child completes when it writes its
  `$KONDUCTOR_DONE_FILE`. The plugin's `dispatch_permission_mode` option sets the same modes.
- Each dispatched child gets its own 0700 directory under the registry for its brief, result and
  `.done`, and is granted only that directory. A `.done` the child writes is kept, and the launcher
  adds the exit code when the session ends, so a non-zero exit is always recorded as `error`.
  `--brief <file>` passes a long brief. An existing registry that is group- or world-writable, such
  as one created under umask 002, is now refused with a message to `chmod 700` it.
  The orchestrators write a long brief to a `mktemp` file outside the registry, and they poll
  the registry the scripts use, including one set with `KONDUCTOR_MUX_REGISTRY_DIR` or
  `KONDUCTOR_CMUX_REGISTRY_DIR`.
- `k-adversarial-pull-request-review` now says "in Konductor" or "for Konductor" where it
  scopes the `pr_url` and historical-filtering limits, including the report's
  `Historical filtering:` line.
- `cmux-dispatch` renames the done-key variable it exports to the dispatched pane to
  `KONDUCTOR_DONE_KEY`, and `cmux-completion-hook.sh` reads the new name. A custom completion
  hook must read `KONDUCTOR_DONE_KEY` too; the bundled hook still falls back to
  `CMUX_WORKSPACE_ID`.
- Review ceilings: CRITICAL and IMPORTANT findings get one fix and one re-review. One in the task's own output still open,
  or one the re-review reports there, carried over or new, or caused by the fix in what depends on it, stops work on that artifact;
  a finding in code the task did not add or change, and the fix did not cause, is listed as pre-existing, not put in the fix brief.
  An SOP's own fix scope and round limit win; what it leaves open is reported, never dropped.
  The `constraints` skill carries the same rule in a new `### Review findings` subsection, and its IMPORTANT tier header reads "fix before proceeding".
- House rules: konductor's defaults yield to the request, recorded rulings, the project's instruction files and
  user-written memory, and the codebase's conventions, in that order; an open collision is asked once and saved as a
  `Ruling:` entry. A `USER DECISIONS IN FORCE` brief entry quoting the user meets the rule 6 and 7 exceptions for the
  action it names; rule 9 and irreversible actions still need the user directly. A project mechanism replaces the
  adversarial review only on the user's direct word or the project's own agent instruction file; writing habits yield
  to house rules levels 1 to 3 and a tracked style guide, not to nearby text. The brief template no longer asks
  specialists to add inline comments by default. Publish authorization (`code-review`) joins the NEVER rules and the
  tests-pass requirement as a default no house rule overrides; an instruction file, or a file one names, that the
  change under review edits is read from the base branch and the edit is reviewed as content.
- Docs describe setting `orchestration.mode` by hand, reading the mode line in the first reply,
  and that Kiro CLI v2 is not supported. Claude Code support is for `konductor install`; the
  plugin does not wire the hook.
- The `code-review`, `non-functional-requirements`, `risk-management` and
  `system-design-patterns` descriptions now name the tasks they cover, so they load on
  ordinary task prompts: reviewing a folder or repository, adding measurable targets to a
  requirements or design document, listing a plan's risks, and writing a system design.
  `code-review` gains a step for reviewing a source tree with no diff, which asks the user to
  narrow the scope of a tree too large to read and lists the files it did not read, and
  `system-design-patterns` gains a no-questions mode that works from documents the user
  already gave.
- The `kiro-requirements-generation`, `kiro-design-generation` and `kiro-task-generation`
  descriptions each name their own input and output and the spec step before and after, so
  the model picks the right one of the three.
- The `user-story-writing` description now matches requests that start from a feature idea
  or rough ask with no requirements document yet. `requirements-extraction` and
  `kiro-requirements-generation` say they need existing requirements or user stories, and that
  a bare request needs its user stories written first.
- 26 more skill descriptions name the requests they cover in a "Use ..." sentence that fits
  within the 160 characters the Kiro skill index keeps. `verification` and `git-merge` replace
  "MUST USE" with a concrete trigger, and `adversarial-design-review`, `design-quality-check`,
  `dom-inspection` and `socratic-elicitation`, which had none, gain one. `git-merge` now says
  the default branch instead of `mainline`, and long descriptions such as
  `historical-issues-registry` and `legacy-to-agentic-estimate` are shorter. `adr-generator`
  and `adversarial-code-review` also shorten theirs to fit, and a test now checks every skill.
- `k-product-manager`, `k-tpm` and `k-quality-assurance` prompts drop their hand-written
  skill lists, whose old triggers contradicted the new descriptions. Each skill's description is
  now the one place that says when to use it.
- `about-konductor` and `design-doc-guidelines` load less up front. CLI, install-check, and model
  detail, and the rules for multi-document designs and renames, now live under each skill's
  `references/` and load only when the task needs them. `design-doc-guidelines` uses generic
  examples for technical accuracy and threat models.
- `requirements-extraction`, `user-story-writing`, and `system-design-patterns` now read as one
  set of instructions each, without a pasted prompt and its separate role. Repeated rules are
  stated once. `requirements-extraction` folds its checklist into the Quality Gate, so a missing
  output file is CRITICAL and missing integration points are IMPORTANT. `system-design-patterns`
  lists its real five interview phases and four documents, adds a non-functional requirements
  section to the design document, and points follow-up work at konductor skills instead of
  prompts that don't exist. Its S3 Intelligent-Tiering advice now targets data with unknown or
  changing access patterns, not infrequently accessed data.
- Fact-checking starts at `doc-accuracy-analyzer`. It routes AWS feature, limit, pricing and
  Region claims to `aws-service-validator`, rates findings CRITICAL, IMPORTANT or SUGGESTION,
  and states when a document passes. When checking an artifact, `decision-research` now adds only
  prior art and missing context. `k-product-manager` gains `doc-accuracy-analyzer`.
- `smithy-modeling`, `smithy-validation`, and `progress-tracking` now read as one set of
  instructions instead of a summary followed by a pasted prompt. `smithy-validation`'s output
  format uses its Quality Gate's severity names, and it flags operations left callable without
  authentication instead of operations missing `@auth`. `smithy-modeling`'s service templates
  carry an auth scheme trait and no longer set a doc comment and `@documentation` on the same
  shape, which Smithy rejects as a trait conflict. `progress-tracking` takes `plan_path`
  and per-feature `spec_dir`, defaulting to the `.kiro/specs/` paths it used
  before.
- `policy-validation` reads as one instruction set, without a pasted second prompt and role. It
  keeps one Rules section, one IAM score rubric and one Iteration Progress template, and rates
  findings CRITICAL, IMPORTANT or SUGGESTION, matching its quality gate.
- About 40 skills were revised after test runs showed where they went wrong. What changes when
  you use them:
  - Review and validation skills rate findings CRITICAL, IMPORTANT or SUGGESTION and keep
    CRITICAL for real blockers such as exposure, data loss and credential risk. Each finding
    cites its location and a concrete fix. Context the skill could not check is reported as an
    assumption or an unscored note, not a rated finding.
  - Tell a skill not to ask questions, or pass the scope up front, and it records its
    assumptions in the output and finishes instead of stopping to ask. This covers the kiro
    spec, requirements, user story, threat model, NFR, cost and sprint-planning skills.
  - A request for a security-focused or adversarial second pass loads `adversarial-code-review`
    instead of `code-review`. `verification`, `git-merge` and `decision-research` load on more
    of the requests they cover, such as finishing a change test-first or syncing a branch.
  - `git-merge` checks the staged merge before it commits and recovers from a rejected push
    without force-pushing or rebasing.
- AWS guidance comes from the AWS MCP server's skills instead of local copies:
  - `dynamodb-design` is now a short skill: access patterns first, keys and per-partition
    limits, GSI write sharding for low-cardinality keys with a worked example, capacity, and a
    review gate that rates a hot partition or an unsharded low-cardinality GSI key CRITICAL, with
    six checks that each state their fact and severity: throttle alarm metrics, sharding a
    deployed GSI key, PITR and deletion protection, TTL, the capacity-mode switch limit and
    price provenance. It points to the server's `amazon-dynamodb` skill, loaded through `find-aws-skills`, which
    `k-architect` now declares, for Streams, backup, security and cost depth.
    `dynamodb-validation` is removed; `dynamodb-design`'s gate reviews a finished design. Custom
    agent specs that declare it must drop it: `konductor synth` rejects a spec that names a skill
    that does not exist.
  - `find-aws-skills` now loads for any AWS service guidance, even when a local skill covers part
    of the task, and `architecture-advisor`, `kiro-design-generation` and `system-design-patterns`
    load `dynamodb-design` and apply its quality gate before designing DynamoDB keys and indexes.
    When a lookup fails, `find-aws-skills` offers direct API calls through `aws___run_script` only
    when the agent has that tool.
  - `infra-validation` runs the server's `aws-cloudformation`, `aws-cdk` and
    `aws-well-architected-review` checks (cfn-lint, cfn-guard, cdk-nag, a pillar review)
    read-only and rates their findings CRITICAL, IMPORTANT or SUGGESTION. It runs `cdk synth`
    only after the user confirms the code is trusted; otherwise it reads the template in
    `cdk.out/` or the constructs and lists synth and cdk-nag as not run. An unsharded
    low-cardinality DynamoDB partition key is CRITICAL, matching `dynamodb-design`. Without the server it
    runs the local tools the project has and checks its quality gate items by reading the code.
    `k-code-review-workflow` passes it `scope_confirmed`, the infra files and a new optional
    `environment` parameter, so the review does not stop to ask for scope.
  - `iam-policy-design` generates policies with `aws-iam` and takes S3, secrets and CloudTrail
    settings from the server's skills for them. `policy-validation` checks statements against
    `aws-iam`'s edge cases and S3 buckets against `securing-s3-buckets`. It and
    `infra-validation` rate `iam:PassRole` or an IAM escalation action on `*` CRITICAL, a scoped
    escalation action or `ForAllValues` without a `Null` check IMPORTANT, and map the S3
    checklist's tiers onto their own scale. The `iam-policy-design` tenant isolation example
    pairs its `LeadingKeys` condition with a `Null` check and limits the actions.
  - `cost-estimation` prices through Price List API calls on the AWS MCP server, guided by
    `aws-billing-and-cost-management`, instead of the separate AWS Pricing MCP server. With a
    shell, it prices DynamoDB with the `amazon-dynamodb` cost calculator, fetched from the
    server, shown to the user and run locally only after the user confirms. When the server is available it requires a Price List lookup for
    each line item and labels any figure it did not look up "recalled, unverified".
  - `policy-validation` checks the API Gateway `SecurityPolicy` property, treats the KMS key
    rotation period as configurable, uses the Security Hub CSPM name, and, when the user asks,
    runs IAM Access Analyzer `ValidatePolicy` in the user's AWS account.
  - `konductor` declares `aws-mcp` and `find-aws-skills`, like `k-architect` and `k-developer`,
    so it can run `infra-validation`'s AWS checks. On Kiro CLI the three agents pre-approve only the server's
    read-only documentation, skill and Region tools. On both harnesses `konductor` is granted only
    those five tools by name (`aws___retrieve_skill`, `aws___search_documentation`,
    `aws___read_documentation`, `aws___list_regions`, `aws___get_regional_availability`), so it
    has no `aws___run_script`, and its prompt requires confirmation before any mutating AWS action.
    All three start the server with `--skip-auth`, so documentation search and skills work
    without AWS credentials; calls that act on an account still need them.
    The skill-name test now also checks aws-mcp skill names in table cells and prose.
- The Kiro spec skills and the `kiro-spec-workflow` SOP write specs in the format Kiro writes
  them:
  - `requirements.md` has a Glossary, and each requirement names the user story it came from on
    a `**Source:**` line (for example `US-3`), so it traces back to the PM handoff.
  - `design.md` has Kiro's seven sections, with Correctness Properties: `*For any* ... SHALL`
    statements, each with the requirements it validates.
  - `tasks.md` marks optional test tasks with `- [ ]*`, adds checkpoint tasks, names the
    property each property test checks, and ends with a Task Dependency Graph (a flowchart and
    a JSON list of waves, with each checkpoint alone in its wave, same-file writes in
    separate waves, and every task after the waves its required predecessors are listed in),
    which Kiro's spec format check requires.
  - The SOP takes `spec_type` (`feature` or `bugfix`) and `workflow` (`requirements-first` or
    `design-first`), and writes `.config.kiro`. A bugfix spec writes `bugfix.md` with Current,
    Expected and Unchanged Behavior sections from a `bug_report_path`. Run on its own on Kiro,
    the SOP offers `/spec new` seeded with the handoff files and hands execution to `/spec run`;
    inside `k-full-sdlc` it leaves execution to that SOP. Its last step reports gaps between the
    documents instead of a traceability table.

- Overlapping skills now keep each rule set in one place. `decision-writing` gains an ADR Mode
  that replaces `adr-generator`, which is removed (79 skills). `adversarial-code-review` points
  to its three pass skills for each lens's checklist and severities, keeping a severity rule
  of its own for a run that loads no pass, and `frontend-review` checks changes against the
  rules in `frontend-development`.
- Two pass ratings now match the old `adversarial-code-review` gate: a new field missing
  validation or a default at any entry point is IMPORTANT (was SUGGESTION), and any unguarded
  map or optional access is IMPORTANT (was limited to access reached at runtime). The security
  pass also rates an internal error code or raw exception message surfaced to a caller CRITICAL.
- `frontend-review` now checks the full `frontend-development` rule set, including `.refine()`
  over `.transform()` for cross-field validation, defensive checks on array index access, and
  TypeScript utility types.
- Update the aws-mcp proxy to mcp-proxy-for-aws-cli 2.0.0. It needs Python 3.11 to 3.14; `uvx`
  downloads a compatible one if none is installed.

### Removed

- Breaking: three skills are renamed and their old names are removed, with no aliases:
  `asdlc-aspect-review` is now `k-aspect-review`, `asdlc-code-simplifier` is now
  `k-code-simplifier`, and `document-formats` is now `docx-conversion`, whose description names
  `.docx`. Custom agent specs must use the new names: `konductor synth` rejects a spec that still
  declares an old one.

### Fixed

- Three skill descriptions now say what each skill takes in and puts out, so the model can tell
  them from their neighbors. `requirements-extraction` is for handing finished requirements and
  stories to an architect, once stories exist. `trade-off-evaluator` is for a side-by-side
  comparison of options for a design decision, with a pick. `status-reporting` turns done, late and blocked work
  into a weekly update with a RAG rating. The `about-konductor` SOP overview says it is not for
  real work. Together the three descriptions are 11 characters shorter, so the Claude Code
  skill listing shrinks. The descriptions keep the nouns a skill search is likely to use
  ("decision", "comparison") and leave out the words of requests they exclude, because
  `find_skills` matches any part of a description.
- `konductor` now declares the 46 role skills the specialists use (such as `dynamodb-design`,
  `code-review`, `program-planning` and `e2e-test-strategy`), so the single-writer `konductor` on
  Kiro CLI can see and load them instead of writing without them. Claude Code could already load
  them. The adversarial-review pass skills and `historical-issues-registry` stay with the
  specialists, as that SOP requires. Cost: about 2,000 tokens more in the Kiro `konductor` prompt
  and about 300 more in the Claude Code one. The guide's skill counts and "Declared by" columns are updated to match.
- `scope_confirmed=true` in `k-e2e-test-generation`, `k-light-ui-testing` and
  `k-test-coverage-review` now counts only when it comes from the user: the SOPs tell the model
  to ignore a flag it set itself. `k-e2e-test-generation` is told not to stage, commit or push
  without that yes, or to push the default branch. Orchestrators never add the flag to a SOP
  command unless the user gave it.
- The `adversarial-code-review` description says "Use for a second pass after code review"
  (was "Use as"), so a trigger check that looks for "use when/for/after" can read its
  activation condition. The trigger itself is unchanged.
- Skill bodies no longer contradict themselves or the codebase. `backend-development` and
  `backend-review` keep a facade, factory or repository layering only when the codebase already
  uses one, and `backend-development` says it targets TypeScript/Node. `verification` scopes
  TDD's RED phase to code changes, and `k-code-simplifier` runs the tests before and after
  and reports each change with its reason. The full deliberation panel run is defined once, in
  `deliberation-panel`; `socratic-elicitation` keeps a short inline offer that points to it.
  Repeated paragraphs and tables are cut from several skills.
- Design and planning skills no longer contradict themselves or point at sections that don't
  exist. The design review skills and their SOPs call the lowest finding tier SUGGESTION, as the
  other checkers do. `design-evaluation` lists missing artifacts before it scores and its gate
  items map to its 10 dimensions, which both design review SOPs and the user guide now use.
  Eight of them are scored. The high-level assessment and the recommendations are unscored
  report sections, so a SOP's confidence score averages only the eight.
  Missing artifacts are listed apart from findings and carry no severity, and the PE review and
  design-doc SOPs evaluate a single document without asking for the rest of a package, so a
  one-doc review can reach PE-READY. In `k-existing-design-review` a missing threat model rules
  out READY FOR IMPLEMENTATION.
  `plan-review` has a SHIP IT template and star rules that don't overlap, and
  `trade-off-evaluator` writes to the caller's output directory or reports inline. The
  `external-research` AWS example states a checked fact instead of a wrong one.
  `program-decision-docs` treats fewer than 2 options, counting do nothing, as CRITICAL.
  `non-functional-requirements` asks for targets per operation type. `design-evaluation` does
  not prompt when a SOP runs it. `trade-off-evaluator` writes no file standalone unless asked.
- `infra-validation` and `policy-validation` no longer flag an S3 bucket or DynamoDB table as
  unencrypted for lacking an encryption setting, since both encrypt at rest by default. They
  flag them only when the data needs SSE-KMS or a customer managed key. For a customer managed
  key, `iam-policy-design` adds a bucket policy statement that denies `s3:PutObject` under any
  other key, and `policy-validation` asks for one; only the deny on unencrypted uploads is gone.
- `smithy-modeling` and `smithy-validation` describe current Smithy rules: `enum` and `intEnum`
  shapes instead of the deprecated `@enum` trait, the full `@paginated` rules, required
  `@httpLabel` members, the DANGER severity, `smithy validate --severity` and
  `smithy diff --mode git`, `@readonly` and `@idempotent` as behavior traits, member renames as
  breaking even with `@jsonName`, and IDL 2.1 needing Smithy 1.75.0 or later. The example
  review puts `@sensitive` on a target shape, since the trait cannot apply to members, and the
  file-organization reference pins every Smithy artifact no newer than the installed CLI, with
  1.75.0 in the example, and adds `$schema`.
- The Smithy skills say `$version: "2"` resolves to IDL 2.1 on Smithy 1.75.0 or later.
- The Smithy skills treat `@paginated` `items` as recommended, not required, and say each list
  operation carries its own `@paginated`, which can take its settings from a service-level
  `@paginated`.
- The Smithy skills accept any string as a service `version`; a date is only a convention.
- `smithy-modeling` adds a resource lifecycle example, a `GetUserInput` with a required
  `@httpLabel` member, and says mixins pass their traits to the shapes that use them.
- The file-organization reference's documentation validator checks operations only, and the
  guide calls its file naming a convention and a doc comment plus `@documentation` redundant.
- Agent files rendered by `scripts/generate-agent-files.js` use the Claude Code model ID
  (`claude-sonnet-5-5`), not Kiro's `claude-sonnet-5.5`, which Claude Code ignores.
- Docs: under mux and cmux, Claude Code deny rules still block and ask rules deny; plugin agent
  and SOP names use the `konductor:` prefix; `skill-lookup-mcp --help` describes the filters.
- `--skill-name-filter` now limits each Kiro agent's skill server to that agent's declared
  skills; it used to serve every installed skill.
- The routing rules no longer say the Kiro IDE copy of an SOP (`.kiro/skills/sop-<name>/SKILL.md`)
  is out of the agent's reach: Kiro CLI lists that copy to every agent as a skill, and it is not
  one of the agent's declared SOPs.
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
- The config lock gives up with a contention error at its 5-second deadline when the lock file
  keeps being replaced under it, instead of retrying without a limit. The error now says the lock
  is held by another process or the lock file kept changing.
- The plugin README link rewrite handles `[label]: <target>` reference definitions: it pins a
  relative target to the release tag and leaves an absolute one alone, keeping the brackets.
- `konductor config set` no longer drops other keys and blocks from `.konductor/config.yml`,
  such as a `telemetry:` opt-out. It now changes only the named key.
  The file is rewritten, so comments (including the field reference `init` writes), YAML tags,
  anchors and merge keys, quoting, and number spelling such as `0x1F` or `3.10` are not kept.
- `NOTICE.txt` lists every shipped crate, and `make notice-check` keeps it current.
- Nine skills no longer name tools, templates or steps that don't exist where they run.
  `humanize-writing`, `mux-dispatch` and `workspace-skills` use harness-neutral wording, and
  `workspace-skills` says where Claude Code keeps workspace skills. `cost-estimation` names the
  AWS Pricing MCP server and how to install it, and says why it waits for load figures before
  pricing. `program-planning` and `playwright-test-implementation` no longer point at SOP steps
  that are missing when the skill runs alone. `cmux-dispatch`, `design-doc-guidelines` and
  `external-research` drop terms that do not apply in this repo.
- `konductor config set` keeps an existing `config.yml`'s permission bits and refuses a symlinked
  `.konductor/` or `config.yml` instead of writing through it.
- The session keys for gate facts and the fix-cycle cap are listed once, in the `gate_facts` block
  of `sop-orchestration.yml`, and `konductor verify-run` reads them from there.
  `make sop-orchestration-check` fails when a gated SOP stops naming its boundaries' keys. A key
  named only inside a fenced code block does not count.
- `verify-run`'s `CONFIG_SOURCE` line now comes from the same config read as the threshold.
- `verify-run`'s `EVIDENCE_MISSING` message now names the root the evidence path was resolved
  against. The reason code and exit code are unchanged.
- Orchestrators run `git` reads as `git --no-pager -c core.fsmonitor=` with `--no-ext-diff
  --no-textconv --submodule=short` (and `--no-show-signature` on `log` and `show`). These forms
  stop repository config from running a program through `core.fsmonitor`, `core.pager`,
  `diff.external`, a textconv driver, signature checks or a submodule diff. `git status` and
  `git diff` also take `--ignore-submodules=dirty`, so they never check a submodule's working
  tree, where the submodule's own config could run a `filter.<driver>`. Submodule working-tree
  changes stay hidden from these reads; a submodule at a new commit still shows. No flag stops a
  `filter.<driver>`, so orchestrators skip `git status`, working-tree `git diff`, `git blame` and
  `git ls-files -m` when `.git/config` or a file it includes defines one, or when
  `extensions.worktreeConfig` is true in `.git/config` and the worktree's `config.worktree` (or a
  file it includes) defines one. They also skip them when `extensions.worktreeConfig` holds a value that is not a boolean. They use
  `git diff --cached`, `git log`, `git show` and the file tools instead, and tell the user why.
- The orchestrator routing rules list memory and skill capture as direct work, matching what
  Memory & Skill Reflexes ask for.
- Core rule 12's example search that skips `.env` files keeps `.env.example` in its results.
- `persistent-memory` allows removing an untagged entry when the user asks, as the agent prompts do.
- `verify-run` rejects a misspelled key in `sop-orchestration.yml`, such as `boundries`, instead of
  reading it as a SOP with no gate boundaries.
- `git-merge` shows the merge log and diff and asks before pushing to the default branch, and
  only when the repo merges locally; otherwise, or if the user declines, it opens a PR. Tagging
  and branch cleanup wait for a successful push. The merge into the default branch never runs in
  a dispatched pane. `git-workflow` now merges the default branch in
  before a PR instead of rebasing, matching `git-merge`.
- `cmux-dispatch` and `mux-dispatch` no longer claim every task, and say that Claude Code panes
  skip permission prompts, so dispatch only tasks you would approve unattended.
- Kiro CLI v3 synth now prints a warning when it drops an orchestrator's
  `toolsSettings.subagent.availableAgents`, or any other unmapped `toolsSettings` key, instead of
  dropping it silently. Specialists get no `availableAgents` warning: their output carries no
  subagent tools, and synth already warns when a specialist's spec names a subagent.
- Doc comments in the kiro-v3 synth module now cite the real sources for its `hooks`, tool-ID
  and `trustedAgents`/`availableAgents` mappings (public kiro.dev pages and live testing against
  the installed Kiro CLI `agent upgrade` engine) instead of a vendored module that doesn't exist
  in this repository. They say which tool-ID rows no source confirms, and correctly state that
  `install/registry.rs` registers three install strategies, not two.
- Kiro CLI V3 agents' skills index now tells every agent and subagent to load the `get_skill`
  schema before its first `get_skill` call, naming both of V3's loaders with the id each takes:
  `load_resource` with id `tool::konductor-skills::get_skill` when that tool is in the agent's
  tool list, `tool_load` with tool_ids `["konductor-skills::get_skill"]` when it is not. The V2
  index says to call `tool_search` with tool_id `konductor-skills::get_skill` when `get_skill`
  is not in the tool list. Both indexes used to name `tool_load` alone, which V2 does not have
  and which V3 exposes only while the `load_resource` catalogue is off.
- When `get_skill` can't find a skill, its error says if `--skill-name-filter` hides an existing
  skill from the agent. For a name the index has never seen it lists up to three close skill
  names instead, so a skill the agent named exactly is never answered with a different one.
- Kiro CLI v3 agent files no longer carry an empty `hooks: []` list. Only the mux and cmux
  orchestrators, which have a `stop` hook, still have a `hooks` field.
- Kiro CLI agents now get the bundled `aws-mcp` server from their agent spec, as Claude Code
  agents already did, so `konductor`, `k-architect` and `k-developer` can use their `aws-mcp` tools
  without a hand-added MCP config. Without `uvx` the server fails to start and the agents work
  without it.
- `uninstall` now keeps tracked files that changed since install and warns about them, instead of
  deleting them. The warning says a kept file is still live and, for a Kiro CLI v3 hook document,
  names the Konductor hook entries to remove; that document's lock file is kept with it. A Kiro
  agent file that `kiro-cli agent upgrade` rewrote is still removed when its `.json.bak` backup
  matches what Konductor installed. This also removes an agent file you edited after the upgrade,
  since the backup still matches. `uninstall` never deletes a `.bak` file; it lists each matching
  backup by full path and suggests removing them by hand. The `--json` output adds `kept_changed`,
  `kept_changed_paths` and `kept_backups`. Under `--dry-run --json`, `would_delete` holds only real
  removals and a new `would_keep` array lists the kept files, with `would_delete_count` and
  `would_keep_count`.
- `k-verify` no longer runs `cdk synth`, `cdk ls` or `cdk diff` until the user confirms the CDK
  app is trusted, since all three run the app's code and `cdk diff` also reads the deployed stack.
  Without named credentials, `cdk ls` and `cdk synth` run with `--no-lookups`.

### Security

- Behavior change for `allowlist_patterns` in the persistent-memory validator: with an allowlist
  set, only `https` links pass, and an IP-literal host passes only when a pattern spells it
  exactly. `*` still matches exactly one label. A new `**` leading label matches one or more
  (`**.example.com` covers `docs.aws.example.com` but not `example.com`). Patterns now match the
  URL's hostname only, so a query string, fragment or userinfo can no longer carry an allowed
  suffix (for example `https://evil%2Ecom?.example.com/x`), and a host with an encoded dot or raw
  non-ASCII characters is rejected. Every `scheme://` is checked in any letter case, including a
  second link glued to an allowed one, and `http`, `https`, `ws`, `wss` and `ftp` are checked
  with any number of slashes, so `https:evil.test` and `https:/evil.test` no longer skip the
  allowlist. `file:` is a link only with two or more slashes, so `file:line` is prose. Punctuation that closes a markdown link, quote or emphasis right after the host
  no longer blocks an allowed link. A backslash-escaped colon or a character reference in the
  scheme (`https\://`, `https&#58;//`) is checked like a plain one, and a tab, CR or LF inside a
  link is removed before the check. A bare scheme inside a code span or emphasis (`` `https:` ``)
  is prose. Links without a scheme (`//host`, `www.host`) are not checked.
  An interpreter failure during the check is reported as an environment problem.
- `rustls` moves from 0.23.45 to 0.23.46 in the CLI, MCP server and shared crates. It fixes
  GHSA-c8m5-c952-6cm4 (TLS session secrets exposed in `Debug` output), GHSA-h2v8-394m-p7vv,
  GHSA-vp88-798v-h67f and GHSA-w44r-93j7-qv28.
- Update Rust dependencies, with fixes for RUSTSEC-2026-0381, -0382, -0386, -0457, -0462 and
  -0486.

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