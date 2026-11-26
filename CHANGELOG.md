# Changelog

All notable changes to Konductor are documented here.

This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries are consolidated per release,
not per individual commit.

Skill, agent and SOP names in an entry are the names they had when the entry was written. The
entry that renames or removes one says so, so an old name in this file is history, not a live
reference.

## [Unreleased]

## [2.0.0] - 2026-11-25

### Upgrade notes

Read these before upgrading from 1.2.0.

- **Six skill names are gone, with no aliases.** `konductor synth` rejects a custom agent spec
  that still declares one.
  - Renamed: `asdlc-aspect-review` is now `k-aspect-review`, `asdlc-code-simplifier` is now
    `k-code-simplifier`, and `document-formats` is now `docx-conversion`.
  - Removed: `adr-generator` (use `decision-writing`'s ADR Mode), `asana-sprint-planning` (now
    `sprint-planning`'s `references/asana.md`) and `dynamodb-validation` (use `dynamodb-design`'s
    review gate).
- **A custom cmux completion hook must read `KONDUCTOR_DONE_KEY`.** `cmux-dispatch` renamed the
  variable it exports to the pane. The bundled hook still falls back to `CMUX_WORKSPACE_ID`.
- **A group- or world-writable dispatch registry is refused**, such as one created under umask
  002. Run `chmod 700` on it.
- **Specialists no longer spawn other agents.** They finish their part and hand the next step,
  or a proposed parallel split, back to the orchestrator. Spawn tools are blocked for
  specialists on Kiro CLI v2, Kiro CLI v3 and Claude Code. A workflow that relied on a
  specialist spawning must run through an orchestrator.
- **On Claude Code, mux and cmux children no longer skip every permission check.** The default
  dispatch mode is now `interactive`, which asks in the child's pane. For unattended runs, set
  `KONDUCTOR_DISPATCH_PERMISSION_MODE=headless` and allowlist your build and test commands, or use
  `bypass` only in an isolated environment. The plugin's `dispatch_permission_mode` option sets
  the same modes.
- **Entries in `.konductor/memory/` are now followed as project instructions**, at the same level
  as AGENTS.md, whether git tracks them or not. If your repository commits that directory, review
  its untagged lines before upgrading and tag agent-written ones `[origin:agent]`. The memory
  validator rejects a new or edited line without an `[origin:agent]` or `[origin:user]` tag;
  existing untagged lines are kept.

### Added

- `konductor metrics [--since 7d] [--by agent|model|day|repo] [--json]` reports local usage of
  Konductor sessions in Claude Code, Kiro CLI v2 and Kiro v3: tokens for Claude Code, credits for
  Kiro. It counts only sessions run by installed Konductor agents.
- `konductor verify-run --session <path> [--root <dir>]` checks a SOP session file against its
  gates and exits through the existing exit-code contract. It writes nothing. Phase-gated SOPs
  treat an open HIGH finding as unresolved even when the threshold is CRITICAL.
  - `cli/gate-config/sop-orchestration.yml` lists every SOP as gated or not, with each gated
    SOP's phases, gate boundaries and session keys. The four phase-gated SOPs, such as
    `k-full-sdlc`, carry an `Orchestration: strict (phase-gated SOP)` line.
  - `severity-schema.yml` maps the severity words checkers write (IMPORTANT, WARNING,
    SUGGESTION, MINOR and others) to severity ids. An unknown word or a risk, priority or
    confidence scale such as `High Risk` ranks as CRITICAL.
  - `k-full-sdlc` records gate facts in its session file and reports a `verify-run` check in
    `sdlc-summary.md`. Steps 4 and 9 stop on any open CRITICAL or IMPORTANT finding. The engineer
    can resolve a finding or override it (recorded as `gate_<phase>_override`); an unattended run
    stops and reports.
- `orchestration.mode` (`auto` or `coordinator`) in `~/.konductor/config.yml`. Under
  `coordinator`, `konductor` runs as a coordinator: `install` wires a session-start hook, even
  under `--no-telemetry`, that points it at the routing rules, and Claude Code installs copy the
  context files to `.konductor/context/` for it. `konductor doctor` reports the mode, whether
  the hook is wired, and whether the config value is valid. The docs describe setting the mode
  by hand and reading the mode line in the first reply. Kiro CLI v2 is not supported, and the
  Claude Code plugin does not wire the hook.
  - The mode applies to any installed agent that loads the `k-direct-work.md` context, not only
    to `konductor`, so a fork or distribution that renames the orchestrator still gets
    `coordinator` mode. On Kiro CLI v2 the renamed agent's own file gets the hook, and `doctor`
    checks it in each one. Agents that load the routing rules instead, like the mux and cmux
    orchestrators, are unchanged. An agent file over 1 MiB that the hook cannot check gets
    `Orchestration: auto (fallback: ...)` under `coordinator` instead of no output.
- `konductor synth` warns when an agent's Claude Code skill preload is over 32 KiB or 32 names
  and names the skills Claude Code would drop (`-v` and `--json` report it per agent). Each
  Claude Code agent file ends with a "Skills you can load" block listing its other declared
  skills.
- PR CI now runs `make lint` (clippy with `-D warnings` and `cargo fmt --check` on a pinned
  toolchain), `make version-check` (crates, Konductor lockfile entries and the CHANGELOG heading
  must match `VERSION`), `make sop-orchestration-check`, `make notice-check`, and a skill quality
  gate in `make test-py` that checks every skill against a shrink-only baseline in
  `tests/skill-quality-baseline.json`.

### Changed

#### Orchestration

- `konductor` does the work itself and commits only when you ask. It spawns a specialist only
  for a tool, access, skill or SOP it lacks, for parallel work on disjoint files, or when a SOP
  says so, and one fresh `k-*` reviewer per phase gate. Parallel parts reach your branch only
  after it proposes the split to you, or uncommitted so you decide what to commit. It now
  declares the AWS MCP server and `find-aws-skills`, granted only the five read-only tools.
- All three orchestrators may read files, search the codebase, run read-only shell commands, and
  answer lookups themselves, within a 10-file read budget. One table in
  `context/k-orchestrator-routing-rules.md` defines what is allowed. Writes, state-changing git,
  builds, tests and whole phases still go to specialists. They run the SOP check on every
  request, and a request matches a SOP row when it asks for what the row's User intent
  describes, including a single-procedure SOP such as `k-plan`.
- Review ceilings: a CRITICAL or IMPORTANT finding gets one fix and one re-review. A finding in
  the task's own output that is still open after that stops work on the artifact. A finding in
  code the task did not touch, and the fix did not cause, is listed as pre-existing instead of
  fixed. A SOP's own fix scope and round limit win.
- All three orchestrators skip the reviewer for a lookup, a listing, or a one-file change of at
  most 50 lines whose build, test and lint passed, and say so with the diff stat. The skip never
  applies to auth, secrets, data or infrastructure. `konductor` closes a standalone document with
  its checker skill instead, and a finding it would reject on an artifact it made goes to you
  before it is dropped. A threat model, an auth or credential design, or a design that crosses
  a network boundary or handles sensitive data always goes to a reviewer.
- House rules: Konductor's defaults yield to the request, recorded rulings, the project's
  instruction files and user-written memory, and the codebase's conventions, in that order. An
  open collision is asked once and saved as a `Ruling:` entry. A quoted user decision in a brief
  approves only the action it names, never a rule 9 confirmation or an irreversible action.
- Every agent loads the engineering practices, the severity order and the no-secret-files rule
  from the core rules instead of the `constraints` skill. Handoff, split, denial and brief rules
  shared by the orchestrators live in `context/k-orchestrator-shared.md`. Handoff files go to a
  self-ignoring `.konductor/handoff/`.
- `k-adversarial-pull-request-review` is coordinated by the orchestrator, which spawns the four
  passes and a fresh `k-architect` checker. A pass that fails twice is recorded as `MISSING` and
  caps the verdict at APPROVE WITH COMMENTS. `k-code-review-workflow` ends by asking the
  orchestrator to run it. `k-full-sdlc` runs it before writing a feature's status, and marks the
  feature BLOCKED when a report leaves a CRITICAL or IMPORTANT finding open or the pass is
  incomplete.
- Each dispatched mux or cmux child gets its own 0700 directory for its brief, result and
  `.done`, and is granted only that directory. A non-zero exit is always recorded as `error`.
  `--brief <file>` passes a long brief.

#### SOPs

- On Claude Code, the installed `sop-<name>` skills can be loaded by Claude's `Skill` tool, as
  on Kiro CLI. The three SOPs that commit and push, open pull requests, or act on a live app
  (`k-e2e-test-generation`, `k-full-sdlc`, `k-light-ui-testing`) are marked
  `Invocation: user-only`; start them with `/sop-<name>` or by saying yes to `k-full-sdlc`
  Step 9's scope question.
- The Kiro spec skills and the `kiro-spec-workflow` SOP write specs in Kiro's current format:
  a Glossary and `**Source:**` story links in `requirements.md`, Kiro's seven design sections
  with Correctness Properties, optional test tasks, checkpoints and a Task Dependency Graph in
  `tasks.md`. The SOP takes `spec_type` (`feature` or `bugfix`) and `workflow`
  (`requirements-first` or `design-first`) and writes `.config.kiro`.

#### Skills

- AWS guidance comes from the AWS MCP server's skills instead of local copies. `dynamodb-design`
  is a short skill with a review gate that rates a hot partition or an unsharded
  low-cardinality GSI key CRITICAL. `infra-validation` runs the server's CloudFormation, CDK and
  Well-Architected checks read-only. `iam-policy-design` and `policy-validation` draw on the
  server's IAM and S3 skills, and `policy-validation` now also checks SOC 2. `cost-estimation`
  prices through Price List API calls on the AWS MCP server and labels any figure it did not look
  up "recalled, unverified".
- About 40 skills were revised after test runs. Review and validation skills rate findings
  CRITICAL, IMPORTANT or SUGGESTION, cite a location and a concrete fix, and report unchecked
  context as an assumption. Told not to ask questions, or given the scope up front, a skill
  records its assumptions and finishes.
- Skills that carried a pasted second prompt now read as one set of instructions, and
  overlapping skills keep each rule set in one place: `adversarial-code-review` defers to its
  three pass skills and `frontend-review` checks against `frontend-development`. Two pass
  ratings rise to IMPORTANT: a new field missing validation or a default at any entry point, and
  any unguarded map or optional access.
- Skill descriptions name the requests they cover, fit the Kiro skill index, and keep Claude
  Code's skill listing within its budget with the SOPs listed. Hand-written skill lists in the
  `k-product-manager`, `k-tpm` and `k-quality-assurance` prompts are gone; each skill's
  description is the one place that says when to use it.
- Detail that only some runs need moved into `skills/<name>/references/`, loaded on a stated
  cue. The largest cuts: `test-coverage-analysis` (69.3 KB to 30.3 KB) and
  `cypress-test-implementation` (53.9 KB to 19.4 KB).
- Claude Code subagents preload 1 to 4 skills each (109 KB in total, down from 1.9 MB); the rest
  load on demand. Each Kiro agent's prompt lists its own skills and tells it to load a matching
  one before non-trivial work.
- `architecture-diagram-generation` targets plain draw.io (diagrams.net) XML.
- The skill count is now 79.

#### Plugin and dependencies

- The Claude Code plugin is ready for the plugin directory: its README says what the plugin
  runs, sends and fetches, that telemetry is on by default and how to turn it off, and it ships
  a listing icon and a `supportUrl`.
- The AWS MCP proxy is now `mcp-proxy-for-aws-cli` 2.0.0, which needs Python 3.11 to 3.14;
  `uvx` downloads one if none is installed.

### Fixed

- CLI:
  - `konductor config set` changes only the named key instead of dropping the rest of
    `.konductor/config.yml`. It keeps the file's permission bits and refuses a symlinked
    `.konductor/` or `config.yml`. Comments, anchors and quoting are not preserved.
  - The config lock gives up with a contention error at its 5-second deadline instead of
    retrying without a limit.
  - `uninstall` keeps tracked files that changed since install and warns about them instead of
    deleting them, and lists matching Kiro `.json.bak` backups for manual removal. `--json`
    adds `kept_changed`, `kept_changed_paths` and `kept_backups`; `--dry-run --json` adds
    `would_keep`.
  - `update --no-telemetry` keeps a project opted out on later updates; the new
    `--enable-telemetry` opts it back in. The skill-lookup MCP server follows the same setting.
- Kiro CLI:
  - Agents get the bundled `aws-mcp` server from their agent spec, as on Claude Code.
  - `konductor` declares the role skills the specialists use, so the single-writer `konductor`
    can load them.
  - `--skill-name-filter` limits each agent's skill server to its declared skills, and a
    `get_skill` miss says whether the filter hides the skill or lists up to three close names.
  - The skills index tells V3 agents to load the `get_skill` schema first with the loader they
    have, and V2 agents to use `tool_search`.
  - Kiro CLI v3 agent files no longer carry an empty `hooks: []`, and v3 synth warns when it
    drops an unmapped `toolsSettings` key.
- Claude Code: agent files and benchmarks use the Claude Code model ID (`claude-sonnet-5-5`).
  Plugin agents show up in `claude plugin details` and `/plugin`, the plugin ships `NOTICE.txt`
  with README links pinned to its release, and the plugin tag workflow can create the tag again.
- Skills and routing:
  - Skills no longer contradict themselves or point at tools, templates, steps or sections that
    don't exist. This covers the design, planning, backend, verification and routing skills.
  - The Smithy skills describe current Smithy rules, including `enum` shapes over `@enum`,
    `@paginated`, required `@httpLabel` members and IDL 2.1 on Smithy 1.75.0 or later.
  - `infra-validation` and `policy-validation` no longer flag an S3 bucket or DynamoDB table as
    unencrypted for lacking an encryption setting.
  - `git-merge` shows the merge and asks before pushing to the default branch, and only when
    the repo merges locally; otherwise it opens a PR. `git-workflow` merges the default branch
    in before a PR instead of rebasing.
- `NOTICE.txt` lists every shipped crate.

### Security

- On Claude Code, `konductor install --harness claude` writes permission rules for the
  `aws-mcp` tools to `.claude/settings.json`. Tools that act on AWS with your credentials
  (`aws___run_script`, which runs agent-written Python, `aws___get_presigned_url` and
  `aws___get_tasks`) get an ask rule. The five read-only documentation and region tools get an
  allow rule, matching Kiro CLI. `k-architect` and `k-developer` grant the server's tools by
  name, so a tool the server adds later stays unavailable until it is classified. User `deny` and
  `ask` entries are kept, and `uninstall` removes only the entries install added. The rules
  apply to every Claude Code session using that settings file. A `headless` or `bypass` mux or
  cmux pane cannot call the ask-gated tools. The plugin cannot ship permission rules: plugin users
  add `mcp__plugin_konductor_aws-mcp__<tool>` for each of the three to `permissions.ask`.
- `k-verify` and `infra-validation` no longer run `cdk synth`, `cdk ls` or `cdk diff` until the
  user confirms the CDK app is trusted, since all three run the app's code.
- `scope_confirmed=true` in `k-e2e-test-generation`, `k-light-ui-testing` and
  `k-test-coverage-review` counts only when it comes from the user, and orchestrators never add
  it themselves.
- Orchestrators run `git` reads with flags that stop repository config from running a program
  (`core.fsmonitor`, `core.pager`, `diff.external`, textconv, signature checks, submodule diffs),
  and skip working-tree reads when the config defines a `filter.<driver>`.
- Agents ignore planted instructions, never read or write `.konductor/memory/` through a
  symlink, and report only key names or redacted values from a secret file the user names.
- `rustls` 0.23.46 fixes GHSA-c8m5-c952-6cm4, GHSA-h2v8-394m-p7vv, GHSA-vp88-798v-h67f and
  GHSA-w44r-93j7-qv28. Other Rust dependency updates fix RUSTSEC-2026-0381, -0382, -0386, -0457,
  -0462 and -0486.

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