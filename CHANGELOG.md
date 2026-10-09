# Changelog

All notable changes to Fuse-Konductor are documented here. Fuse-Konductor is a fork of
[Konductor](https://github.com/aws-solutions/konductor) 1.0.0, developed on the `fuse` branch.
The 1.0.0 entry at the bottom is Konductor's own release, the starting point of the fork.

This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Entries describe what changed since the
previous release, not each commit.

## [Unreleased]

Fuse-Konductor keeps Konductor's skills and the guidance in them, and replaces the machinery around
them. Instead of specialist agents coordinated by orchestrators, your harness's default agent runs
a workflow step by step with fuse-flow, a small engine that tracks the steps, artifacts and gates of
each piece of work. Instead of a compiled installer that generates output per harness, a shell
script installs plain skills and an always-on instruction block that every supported harness reads.

### Added

- **fuse-flow,** in `fuse/flow/`, a workflow engine that runs on Bun, or on Node 22.18 or later
  with npm, with no build step. It installs its two dependencies, zod and yaml, on first use.
  - A workflow is a YAML file of ordered steps. Each step has an instruction, the artifacts it
    consumes, produces or updates, an optional condition, and gates: checks and scripts, agent
    reviews with a round cap, and owner actions. JSON schemas in `fuse/flow/workflows/schemas/`
    give editors completion and validation.
  - A workstream is one piece of work following one workflow. Its state lives in the project's
    `.konductor/workstreams/`, so work resumes in a later session. Steps have six states, from
    `PENDING` to `COMPLETED` or `SKIPPED`.
  - Commands: `start` creates or resumes a workstream; `continue` finishes the current step and
    records the agent's artifact reports and the owner's decisions (approve, more review rounds,
    back to an earlier step, forward, skip); `status`, `list` and `validate`.
  - The engine refuses to complete a step while a required artifact is missing without a reason
    or a check fails. It hands over to the owner at owner gates and when a review reaches its
    round cap, with the owner's options in plain words.
  - Where a step's instruction and an artifact's guide disagree, the step block says the
    instruction wins and asks the agent to name each disagreement; the review request tells the
    reviewer the same.
  - When the owner sends work back, from the current step in any status, the files the steps
    wrote stay recorded as draft and each reopened step's next pass lists them to keep, update or
    redo. Review rounds count per pass, with the pass in the findings file names from the second
    pass on. `status` shows each file once, under the latest step that records it. A produced
    folder that existed before the step, such as a shared research folder, is recorded file by
    file from the files the agent names.
  - Workflows are found by name in the project's `.konductor/workflows/`, then
    `~/.konductor/workflows/`, then the shipped ones, at any folder depth, so personal and team
    workflows can sit in their own folders or symlinked repositories.
  - An artifact library in `fuse/flow/library/artifacts/` holds a guide for each kind of
    document, often with a template and a review guide, for requirements, user stories, designs,
    specs, feature splits, implementation plans, research notes, test coverage and more. A project
    or a user can override any entry.
  - Policy files (`~/.konductor/policy-overrides.yml`, the project's `.konductor/policy-overrides.yml`
    and `.konductor/policy-overrides.local.yml`) set check commands, artifact paths, the reviewer
    model for each author model and how the reviewer is launched, and the owner's rulings where
    fuse-flow and other installed rules overlap. Reviewers write findings as JSON to
    `.konductor/reviews/`.
- **Shipped workflows:**
  - `fuse-feature-development`, one feature in an existing codebase: intake, design,
    implementation and code review, with agent reviews before the owner approves the spec and
    lands the branch.
  - `fuse-system-development`, a new system or a module with its own architecture: intake,
    requirements, optional prototypes, a system design with a principal engineer review by an
    agent, and a build order whose features are then built with `fuse-feature-development`. The
    owner approves the prototype findings or sends the work back to the requirements.
  - `fuse-dependency-migration`, a migration or refactoring that must keep the behavior: catalogue
    the checks, add missing ones, record a baseline, migrate in increments and compare.
  - `fuse-rapid-prototyping`, a new product idea explored as a runnable prototype: a short
    interview, many small build-and-feedback iterations with no code review loop, and a product
    brief of what to build that `fuse-system-development` can take up.
  - `_k-full-sdlc` and `_k-phase-chain`, Konductor's full lifecycle pass and lighter phase chain,
    expressed as fuse-flow workflows.
  - Examples: four project-specific workflows, and a native workflow after obra/superpowers.
  - The fuse-development workflows take acceptance tests from the spec, start every bug fix with a
    failing reproduction, and have the reviewer check the tests against the spec, instead of
    forcing test-first on every change. Specs are saved under date-prefixed paths in
    `docs/specs/`.
- **Komposer,** in `fuse/komposer/`, a local web editor for workflows. It shows a workflow as a
  diagram, edits it without losing the file's comments and layout, browses the artifact library,
  and shows the runs of a project's workstreams. It keeps unsaved edits as a working copy, warns
  before a save affects a running workstream, follows the system's light or dark theme, and
  serves only to 127.0.0.1 behind a token.
- **Skills:**
  - `fuse-workstream`: finds a workstream to resume, recommends a workflow for new work, starts it
    once the user agrees, and runs it, keeping fuse-flow's commands out of what the owner reads.
    Its opt-in debug mode ends every reply with a report of what fuse did.
  - `fuse-flow-builder`: builds or changes a workflow with the user, by interview, by encoding an
    existing process, or together in Komposer, following fuse's principles for workflows.
  - `fuse-tutorial`: a coach for new users. Started in the clone before anything is installed, it
    installs Fuse-Konductor with the user after checking their harnesses and conflicting skills or
    instructions, explains the repository, and teaches hands-on: choosing a workflow, working on a
    real project, building a greenfield demo project, or shaping a workflow to how the user works.
  - `aws-mcp-usage`: confirmation rules for AWS MCP tools that act on an account, and which AWS
    guidance to load for common tasks, taken from the removed architect and developer agents.
- **The always-on block** `AGENTS.fuse.md`, which `install.sh` writes into instruction files. It
  says when fuse applies, the rules that hold while a workstream runs, and how to write for the
  owner: self-explaining headings, decisions and commit messages, without bare labels such as `D1`.
- **`install.sh` and `INSTALL.md`.** `--project <dir>` copies the skills into the project's
  `.agents/skills/`, links `.claude/skills` and `.kiro/skills` to it, and adds the block to the
  project's `AGENTS.md`, for the team to commit. `--global <file>...` adds the block to each
  harness's user-level instruction file and copies the skills next to it; `--link` links them into
  the clone instead, for people who edit the skills. `--uninstall` reverses either. The script
  changes only what it installed and keeps the rest of each instruction file byte for byte.
  Supported harnesses: Claude Code, Codex, Cursor (project install only), OpenCode and Kiro CLI.
- A smoke-test harness in `fuse/smoke/`: an orchestrating agent plays the user, has a separate
  fuse agent build a trivial program with a workflow, and judges whether an engineer who knows
  nothing about fuse-flow could get through it.
- `docs/GLOSSARY.md`, including the scope terms prohibited, deferred and out of scope.

### Changed

- **Installation uses a shell script instead of a compiled installer.** Most of Fuse-Konductor's
  value comes from teams that fork it and change the skills and rules to their own conventions.
  With a binary, each such change reaches engineers only after the fork runs a release pipeline,
  which most forks will not maintain. With the script, a change needs no release: a project install
  is committed and shared with `git pull`, and a global install picks up a change when the user
  pulls the clone and runs the script again. What is given up is the checksummed binary download;
  a clone over an authenticated connection and a script short enough to read take its place.
  Revisit this if forks become rare.
- **The running agent does the work** that SOPs and skills used to delegate to specialist agents,
  with generic subagents or separate passes where independence matters.
- The `verification` skill names the checker for each kind of artifact and when to run
  `design-impact-review`, taken from the removed agent prompts.
- Skill descriptions open with when to use the skill, and the prose in skills and SOPs is
  rewritten in plain language.
- The `persistent-memory` validator runs on Bun instead of Python, so the repository and its tests
  need only Bun.
- `README.md` describes Konductor and Fuse-Konductor, starts new users with the tutorial, and links
  the workflows, Komposer and the skills.
- All pull requests target `fuse`, whose history stays linear.

### Removed

- All 11 agent specs, including the three orchestrators, and the layer that only routed work to
  them: the `delegation-protocol`, `claude-teams-behavior`, `mux-dispatch`, `cmux-dispatch` and
  `sdlc-navigator` skills, the `k-delegate` SOP and the orchestrator routing rules.
- The `konductor` command line tool, its per-harness synthesis, release pipeline, bootstrap
  installers and telemetry. Fuse-Konductor collects no data.
- The `skill-lookup` MCP server.
- The `legacy-to-agentic-estimate` skill.
- The `about-konductor` skill and SOP, whose onboarding the `fuse-tutorial` skill now covers.
- The user guide and its Python tooling, and the agent benchmark harness.
- Installation of the SOPs. The files remain in `agent-sops/` for reference; fuse-flow workflows
  replace them.

### Upgrading from Konductor

Uninstall Konductor with its own `konductor uninstall` before installing Fuse-Konductor, so that
its agents and generated files do not stay behind next to the new skills. Then follow
`INSTALL.md`, or open a session in the clone and ask for the tutorial.

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
