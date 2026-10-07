# Changelog

All notable changes to ASDLC Core AI Capabilities will be documented here.

This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries are consolidated per release,
not per individual commit.

## [Unreleased]

### Added

- `fuse-workstream` skill: finds a workstream to resume, recommends a workflow for new work when
  the user names none, starts it once the user agrees, and records the owner's rulings where
  installed rules overlap. It takes over that guidance from the always-on block.
- `fuse-flow list` prints the project's workstreams with their current step, and every workflow a
  new workstream can follow, by location, with its description and the name that starts it.
- Fuse debug mode, turned on or off by asking for it. While it is on, every reply to the owner ends
  with a fuse report (a diagram of the workflow and four lines on the step, what comes next, the
  fuse instructions used and any surprises), and each turn is logged in `.konductor/debug/`. The
  instructions are in `skills/fuse-workstream/debug-mode.md` and load only when needed.
- `aws-mcp-usage` skill: confirmation rules for AWS MCP tools that act on an account, and which
  AWS guidance to load for common development tasks. Extracted from the removed architect and
  developer agent prompts.
- The `verification` skill now names the checker for each kind of artifact and when to run
  `design-impact-review`. Extracted from the removed architect, developer and product manager
  agent prompts.
- Research note `docs/research/2026-09-26-orchestration-skills-and-sops.md` on which skills and
  SOPs only route work to subagents.

### Changed

- `fuse-flow-builder` now also holds the workflow format, the encoding procedure and the dry run,
  which were in `fuse-workflow-authoring`.
- The always-on block `AGENTS.fuse.md` keeps only when fuse applies, the rules that hold while a
  workstream runs, and writing for the owner. It points at the `fuse-workstream` skill for the rest.
- fuse-flow's step block ends with the five lines the agent fills in when it hands back to the
  owner before the step is done, with status `needs input` or `paused`.
- fuse-flow artifact paths accept `{date}`, the local date the workstream started. The
  fuse-development workflows name their specs `docs/specs/<date>-<slug>.md` (or a
  `docs/specs/<date>-<slug>/` folder).
- fuse-flow's hand-over block gives the owner's options in plain words and prints the matching
  commands after the block, for the agent only. The always-on block tells agents to keep fuse-flow
  out of what they show the owner unless asked, and to write headings, decisions and commit
  subjects that explain themselves without labels such as `D1` or `round 3`.
- fuse-flow policy files take `review.reviewers`, the reviewer's model for each author model;
  `review.launch`, a subagent in the same harness by default or a command such as another harness
  on the terminal; and `rulings`, the owner's decisions where fuse-flow and other installed rules
  overlap. Reviewers write findings to `.konductor/reviews/<slug>/` as JSON, following
  `review-findings.schema.json`. The fuse-development review guide no longer asks for the most
  capable model, and agents run one review where two rule sets each ask for one.
- `konductor install --harness kiro-cli-v2|kiro-v3` installs skills under `.kiro/skills/`
  instead of `.konductor/skills/` when the synthesized output contains no agents, so a plain
  Kiro CLI session discovers them. Output that contains agents is unchanged. A skill named like
  a SOP's `sop-<name>` conversion is refused in that layout.
- fuse-flow also looks for skills in `.kiro/skills/` and `~/.kiro/skills/`, before
  `.konductor/skills/`, so a copy an older install left there does not shadow the current one.
- fuse-flow workstreams each record the workflow they follow, given to `start --workflow` as a
  path or as a name looked up in `.konductor/workflows/`, `~/.konductor/workflows/` and the shipped
  workflows. `start` no longer copies a workflow to `.konductor/workflow.yml`. fuse-flow also runs
  on Node 22.18+, 23.6+ or 24+ when Bun is not installed.
- fuse-flow has three commands instead of five. `start` prints the current step, and the one
  input `continue` moves the workstream on: it records the current step finished (the former
  `done`), or with `--owner-approved` records the owner's approval (the former `gate`), and prints
  the next step. `next` is gone; `start` resumes a workstream. Commands no longer take a step id:
  steps run one at a time in file order, and `depends_on` documents what a step builds on.
- The `fuse-flow` script installs its dependencies when `node_modules` lacks them, normally only
  on first use, with `bun install` or, under Node, `npm install` (Node needs npm next to it). That
  is the only time fuse-flow uses the network; offline, that run fails and names the command to run. `install.sh` replaces `{{CLONE}}` in `AGENTS.fuse.md`
  so the installed rules say where the clone is instead of asking the user: a global instruction
  file gets the clone's path; a project's `AGENTS.md`, which is committed, gets a pointer to
  `~/.konductor/fuse-konductor-clone`, a one-line file (`clone=<path>`) the installer writes in
  the user's home.
- The `persistent-memory` and `legacy-to-agentic-estimate` script lookups also try
  `.kiro/skills/` and `.claude/skills/`, in the project and in `$HOME`.
- `konductor install` and `konductor update` now remove files the previous install of the same
  harness wrote that the new source no longer contains, such as a removed agent or skill, or a
  skill that moved to a different directory. Only files that are unchanged since that install,
  were created or replaced by it, and are not named by any current manifest entry are removed;
  edited and foreign files stay.

### Upgrading

Installing this version over an earlier one removes the old agents, the routing context and the
removed skills automatically, as described above. Files you edited after the earlier install are
kept, untracked; delete them by hand if you no longer want them.

### Removed

- `fuse-workflow-authoring`, merged into `fuse-flow-builder`.
- `sdlc-navigator`, which routed between Konductor's phases and is not used on the fuse branch.
- All 11 agent specs in `agents/`, including the three orchestrators.
- The routing and dispatch layer that only served them: the `delegation-protocol`,
  `claude-teams-behavior`, `mux-dispatch` and `cmux-dispatch` skills, the `k-delegate` SOP, and
  `context/k-orchestrator-routing-rules.md`, with the dispatch scripts' tests.
- The agent benchmark harness (`scripts/benchmark.js`, `scripts/run-claude-subset.js`,
  `scripts/generate-agent-files.js`, `tests/judges/`, the benchmark datasets and registry, and
  `docs/guides/benchmarking.md`) and the agent-spec regression test.

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