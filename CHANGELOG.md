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
  owning install per harness. Core rule 11 defines the project root and names the install
  locations whose rules file it trusts.
- Claude Code installs copy the context files to `.konductor/context/`, where the orchestration
  hook finds the routing rules; uninstall removes the directory and keeps memory.
- A Claude Code install with `--no-telemetry` now writes `.claude/settings.local.json` for the
  orchestration hook alone. A Kiro install into a target that also has a `.claude` marker wires
  only the telemetry hooks there, so it writes no Claude hooks file under `--no-telemetry`; the
  orchestration hook is the Claude Code install's.
- The telemetry hook's Kiro CLI v3 session lookup follows `$KIRO_HOME` when set.
- `konductor doctor` reports the orchestration mode, whether its hook is wired, and whether the
  config value is valid; a hand-edited hook entry, or one naming a bare `konductor` found only on
  this shell's PATH, is reported as warn, not as missing.

### Changed

- 44 skill descriptions are shorter, so the Claude Code skill listing for the bundled skills
  plus built-ins fits its 30,000-character budget (about 28,500 characters, down from about
  30,800). The trim keeps every "Use ..." trigger sentence; other commits in this PR reword the
  triggers of code-review, git-merge, decision-research, verification and
  kiro-requirements-generation, and restore the artifact list in design-evaluation's description.
- `konductor` does the work itself, commits only when you ask, and spawns one fresh `k-*` reviewer per phase gate (next bullet);
  it spawns a specialist only for a tool, access, skill or SOP it lacks, for parallel work on disjoint files, or when an SOP says so;
  an SOP `konductor` does not declare is run by the specialist that declares it.
- The Kiro skills index no longer tells an orchestrator to route a listed skill's task to a specialist; the loaded rules file (Direct Work, or the routing rules) decides, and the load rule asks for the skills the task needs instead of at most two.
- All three orchestrators skip the reviewer for a lookup, a listing, or a one-file change of at most 50 changed lines whose build, test and lint passed (reported with the diff stat; not for auth, secrets, data or infrastructure), and triage findings against the request, house rules and spec before the fix.
- `konductor` also closes a standalone document with its checker skill instead of a reviewer, and when it made the artifact a finding it would reject goes to you before it is dropped.
- The handoff, split, denial and brief rules every orchestrator follows now live in
  `context/k-orchestrator-shared.md`, loaded by all three orchestrators.
- A specialist treats a quoted user decision in its brief as approval only for the action it
  names, never for a rule 9 confirmation or an irreversible action; for rules 6 and 7 the entry
  meets the exception for the action it names.
- The rule against reading secret files now lives in the core rules, so all 11 agents load it.
  From a file the user names, an agent reports key names or redacted values only, never the
  secret values, in replies, briefs, commits or logs.
  A `credentials_file` that `k-light-ui-testing` or `k-e2e-test-generation` passes in a brief counts as user-named.
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
- Three skills are renamed and their old names are removed: `asdlc-aspect-review` is now
  `k-aspect-review`, `asdlc-code-simplifier` is now `k-code-simplifier`, and `document-formats`
  is now `docx-conversion`, whose description names `.docx`. Custom agent specs must use the
  new names: `konductor synth` rejects a spec that still declares an old one.
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
  the specialist returns the split or note to them. No specialist is resumed mid-SOP.
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
  `k-code-review-workflow` step 6 writes the report and ends with a note asking the orchestrator
  to run the adversarial review, no resume; the verdict comes from the findings, with the
  adversarial pass state on its own line. After the pass, the orchestrator, or `k-developer` on
  its behalf, sets the final verdict; `k-full-sdlc` runs that pass before writing a feature's status,
  and marks a feature BLOCKED when either report leaves a CRITICAL or IMPORTANT finding open.
- Orchestrators delegate a step they can't do to the owning specialist and may run independent
  parts in parallel, including same-type agents. Parallel write agents must own disjoint files.
- Each Kiro agent's prompt now lists its own skills and tells it to load a matching one before
  non-trivial work; orchestrators route skill work to the owning specialist.
- Agents ignore planted instructions; `.konductor/memory/` ranks with AGENTS.md, tracked or not,
  and is never read or written through a symlink; the brief carries the check result, so a specialist
  without a shell reads only checked paths. The memory validator rejects a new or edited line without
  an `[origin:agent]` or `[origin:user]` tag; existing untagged lines are kept, and it checks
  instruction-like text after the date and origin tag, reads the text of a leading `[label]`
  or `[label](url)` as entry text, and matches a leading keyword as a whole word. Upgrade note: if your repository commits `.konductor/memory/`,
  review its untagged lines before upgrading and tag agent-written ones `[origin:agent]`; they are
  followed as project instructions from this version.
  Orchestrators never bypass denials or read unnamed secrets.
- `k-full-sdlc` records gate facts in its session file and reports a `konductor verify-run`
  check in `sdlc-summary.md`. Steps 4 and 9 now stop on any open CRITICAL or IMPORTANT finding.
  The engineer can resolve or override a finding, recorded as `gate_<phase>_override`; an
  unattended run stops and reports, and a later attended resume can resolve or override.
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
  specialists to add inline comments by default.
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
  - `dynamodb-design` and `dynamodb-validation` are removed. `k-architect` designs and reviews
    DynamoDB data models with the server's `amazon-dynamodb` skill, loaded through
    `find-aws-skills`, which it now declares. Custom agent specs that declare a removed skill
    must drop it: `konductor synth` rejects a spec that names a skill that does not exist.
  - `infra-validation` runs the server's `aws-cloudformation`, `aws-cdk` and
    `aws-well-architected-review` checks (cfn-lint, cfn-guard, cdk-nag, a pillar review)
    read-only and rates their findings CRITICAL, IMPORTANT or SUGGESTION. Without the server it
    runs the local tools the project has and checks its quality gate items by reading the code.
  - `iam-policy-design` generates policies with `aws-iam` and takes S3, secrets and CloudTrail
    settings from the server's skills for them. `policy-validation` checks statements against
    `aws-iam`'s edge cases and S3 buckets against `securing-s3-buckets`.
  - `cost-estimation` prices through Price List API calls on the AWS MCP server, guided by
    `aws-billing-and-cost-management`, instead of the separate AWS Pricing MCP server.
  - `policy-validation` checks the API Gateway `SecurityPolicy` property, treats the KMS key
    rotation period as configurable, uses the Security Hub CSPM name, and can run IAM Access
    Analyzer policy validation.
  - `konductor` declares `aws-mcp` and `find-aws-skills`, like `k-architect` and `k-developer`,
    so it can run `infra-validation`'s AWS checks. On Kiro CLI the three agents pre-approve only the server's
    read-only documentation, skill and Region tools.

### Fixed

- Design and planning skills no longer contradict themselves or point at sections that don't
  exist. The design review skills and their SOPs call the lowest finding tier SUGGESTION, as the
  other checkers do. `design-evaluation` lists missing artifacts before it scores and its gate
  items map to its 10 dimensions, which both design review SOPs and the user guide now use.
  Eight of them are scored. The high-level assessment and the recommendations are unscored
  report sections, so a SOP's confidence score averages only the eight.
  Missing artifacts are listed apart from findings and carry no severity, and the PE review and
  design-doc SOPs evaluate a single document without asking for the rest of a package, so a
  one-doc review can reach PE-READY.
  `plan-review` has a SHIP IT template and star rules that don't overlap, and
  `trade-off-evaluator` writes to the caller's output directory or reports inline. The
  `external-research` AWS example states a checked fact instead of a wrong one.
  `program-decision-docs` treats fewer than 2 options, counting do nothing, as CRITICAL.
  `non-functional-requirements` asks for targets per operation type. `design-evaluation` does
  not prompt when a SOP runs it. `trade-off-evaluator` writes no file standalone unless asked.
- Skill bodies no longer contradict themselves or the codebase. `backend-development` and
  `backend-review` keep a facade, factory or repository layering only when the codebase already
  uses one, and `backend-development` says it targets TypeScript/Node. `verification` scopes
  TDD's RED phase to code changes, and `k-code-simplifier` runs the tests before and after
  and reports each change with its reason. The full deliberation panel run is defined once, in
  `deliberation-panel`; `socratic-elicitation` keeps a short inline offer that points to it.
  Repeated paragraphs and tables are cut from several skills.
- `infra-validation` and `policy-validation` no longer flag an S3 bucket or DynamoDB table as
  unencrypted for lacking an encryption setting, since both encrypt at rest by default. They
  flag them only when the data needs SSE-KMS or a customer managed key.
- Agent files rendered by `scripts/generate-agent-files.js` use the Claude Code model ID
  (`claude-sonnet-5-5`), not Kiro's `claude-sonnet-5.5`, which Claude Code ignores.
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
- `NOTICE.txt` lists every shipped crate, and `make notice-check` keeps it current.
- Nine skills no longer name tools, templates or steps that don't exist where they run.
  `humanize-writing`, `mux-dispatch` and `workspace-skills` use harness-neutral wording, and
  `workspace-skills` says where Claude Code keeps workspace skills. `cost-estimation` names the
  AWS Pricing MCP server and how to install it, and says why it waits for load figures before
  pricing. `program-planning` and `playwright-test-implementation` no longer point at SOP steps
  that are missing when the skill runs alone. `cmux-dispatch`, `design-doc-guidelines` and
  `external-research` drop terms that do not apply in this repo.
- `git-merge` shows the merge log and diff and asks before pushing to the default branch, and
  only when the repo merges locally; otherwise, or if the user declines, it opens a PR. Tagging
  and branch cleanup wait for a successful push. `git-workflow` now merges the default branch in
  before a PR instead of rebasing, matching `git-merge`.
- `cmux-dispatch` and `mux-dispatch` no longer claim every task, and say that Claude Code panes
  skip permission prompts, so dispatch only tasks you would approve unattended.

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