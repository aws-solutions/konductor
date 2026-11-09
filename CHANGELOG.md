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

### Changed

- sdlc-navigator lists `konductor` (orchestrator, routing) in its agent table and shows the Claude Code invocation beside the Kiro ones.
- delegation-protocol: shorter trigger, a reason for the four-subagent limit, and a shorter "specialist never spawns" pointer. The adversarial pass skills are coordinator-only and say "posted to the PR".
- persistent-memory and agents-md-authoring: the memory skill's description leads with "remember this", "save this", "forget that" and its headings drop the section numbers; the AGENTS.md context block uses the `.kiro/skills/ws-*/SKILL.md` glob and calls `.konductor` the workspace state directory.
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
- Specialist specs grant no spawn tool, and Kiro CLI v3 and Claude Code configs block it, with
  `disallowedTools` on Claude Code for every specialist (not shell or Kiro CLI v2).
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

### Fixed

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
- `konductor config set` no longer drops other keys and blocks from `.konductor/config.yml`,
  such as a `telemetry:` opt-out. It now changes only the named key.
  The file is rewritten, so comments (including the field reference `init` writes), YAML tags,
  anchors and merge keys, quoting, and number spelling such as `0x1F` or `3.10` are not kept.
- `NOTICE.txt` lists every shipped crate, and `make notice-check` keeps it current.

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