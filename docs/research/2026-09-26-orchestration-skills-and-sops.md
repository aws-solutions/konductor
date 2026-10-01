# Orchestration skills and SOPs

Date: 2026-09-26
Updated: 2026-10-01
Branch: `agents/defiant-claude-2`, based on `7c95c51`

## Scope

This note covers every skill, SOP and context file in this repository that routes work to
subagents or named agents, manages subagent lifecycles, or dispatches agents into terminal
multiplexer panes. For each one it records what the file does and whether that is all it does, or
whether it also carries domain procedure, quality criteria, artifact formats or tool knowledge
that would be lost if the file were deleted.

The note was written right after the agent specs in `agents/` were removed. The orchestrators
(`konductor`, `konductor-mux-orchestrator`, `konductor-cmux-orchestrator`) and the specialists
(`k-architect`, `k-browser`, `k-developer`, `k-media-analyzer`, `k-product-manager`,
`k-quality-assurance`, `k-researcher`, `k-tpm`) therefore no longer exist. Any file that names
them now points at nothing.

Candidates were found by searching `skills/`, `agent-sops/` and `context/` for subagent, spawn,
delegate, dispatch, orchestrate, `Agent(`, mux and the agent names, then reading each hit in full.
Files where the only hit was a passing mention (for example a single sentence in
`backend-development` or `iam-policy-design`) were checked and left out.

## Key findings

- Six files only route or dispatch: the skills `delegation-protocol`, `claude-teams-behavior`,
  `mux-dispatch` and `cmux-dispatch`, the SOP `k-delegate`, and the context file
  `context/k-orchestrator-routing-rules.md`. Nothing in them is useful without the orchestrator
  agents, and nothing in them is domain knowledge.
- Twenty-one other files contain orchestration steps but also carry substantial other function.
  The orchestration in them is how the work was divided among agents, not what the work is.
- At the time of this audit, several of the surviving files still named agents that no longer
  exist. The orchestration part of each file is described below as it stood then; the same change
  later rewrote those bindings (see Risks and open questions).

## Routing, subagent management and multiplexer dispatch only

| File | What it does |
| ---- | ------------ |
| `skills/delegation-protocol/SKILL.md` | The orchestrator's delegation contract: the 8-field delegation prompt (target agent plus TASK, EXPECTED OUTCOME, REQUIRED SKILLS, REQUIRED TOOLS, MUST DO, MUST NOT DO, CONTEXT), the rule never to omit the target agent, the agent registry, tool-to-agent routing, the per-agent SOP registrations read from `agents/*.agent-spec.json`, parallelism limits, handoff files under `.konductor/handoff/`, subagent retry rules, and a quality gate over delegation. Every section is about choosing, prompting or supervising a subagent. |
| `skills/claude-teams-behavior/SKILL.md` | Claude Code Agent Teams rules for the orchestrator: hub-and-spoke messaging, when to use background agents and `SendMessage`, agent name prefix resolution, and how to name a worktree in a write agent's dispatch prompt. It also carves out exceptions to the orchestrator's own no-shell rule (`Glob`, `Grep`, `git worktree list`), which only exist because of that rule. |
| `skills/mux-dispatch/SKILL.md` and its scripts | Dispatching an agent into a tmux or zellij pane: multiplexer detection, `dispatch.sh` and the per-multiplexer scripts, `.done` completion markers, pane peeking, closing panes, and worktree provisioning for dispatched write agents. |
| `skills/cmux-dispatch/SKILL.md` and its scripts | The same for cmux surfaces on macOS. |
| `agent-sops/k-delegate.sop.md` | A step-by-step template for writing the 7-section delegation prompt, sending it to a named agent, and checking the result against the prompt. It is the SOP form of the delegation-protocol prompt format. |
| `context/k-orchestrator-routing-rules.md` | Startup rules loaded only by the three orchestrator agents through their `contextNames`: never mutate directly, never say "I can't", classify each message against a SOP trigger table, how to hand a user a SOP invocation command, and a capability-to-agent routing table. With the orchestrators gone, nothing loads it. |

The only content in this group that is not strictly routing is the worktree-naming rule for write
agents (in `delegation-protocol`, `claude-teams-behavior` and both dispatch skills). It exists to
stop two dispatched agents from writing into the same tree, so it is subagent management too.

The dispatch skills have their own shell tests under `tests/skills/mux-dispatch/` and
`tests/skills/cmux-dispatch/`. Those tests only exercise the dispatch scripts.

## Orchestration plus other function

### Skills

| File | Orchestration part | Other function |
| ---- | ------------------ | -------------- |
| `skills/about-konductor/SKILL.md` | Telling the user to start a `konductor` session and let it pick specialists. | Building and installing the CLI, the CLI command reference, diagnosing a broken install, and what agents, skills and SOPs are. |
| `skills/pre-planning-analysis/SKILL.md` | A "Route to" line per intent type and a recommended agent chain. | Six-way intent classification, intent-specific questions, AI failure-mode detection, scope bounding and an output schema. |
| `skills/sdlc-navigator/SKILL.md` | The agent registry, the agent label on each phase, and invocation commands. | The SDLC phase order and the artifact each phase hands to the next. |
| `skills/sop-state-management/SKILL.md` | One sentence saying dependent writes must not be parallelized. | The whole resumable-state protocol for SOPs: file schema, identity and resume algorithm, atomic writes, locking and finalization. It cites the `mux-dispatch` registry lock as precedent for its lock design. |
| `skills/asdlc-aspect-review/SKILL.md` | One generic subagent per review aspect. It names no agent and falls back to inline review. | Choosing orthogonal aspects per artifact type, the neutral review prompt, and synthesis rules. |
| `skills/deliberation-panel/SKILL.md` | Parallel generic subagents for advocacy and cross-examination. It names no agent and has an inline fallback. | Consent contract, axis derivation, anonymous cross-examination, the confidence formula and the decision scorecard. |
| `skills/adversarial-code-review/SKILL.md` | Mentions that the validator runs as a different persona. | Generator and validator procedures, the three gap categories, severity criteria and the finding format. |
| `skills/adversarial-code-review-pass-security/SKILL.md`, `-pass-integrity`, `-pass-schema` | Each describes itself as one parallel pass that forwards candidates to a checker. | The review checklist for its lens, test-fixture exclusions, severity rules and the finding format. Each works when run directly. |
| `skills/historical-issues-registry/SKILL.md` | Placement in a review coordinator's lifecycle. | Fingerprinting findings across revisions and the suppression rules. It depends on a platform delta layer, not on agents. |
| `skills/test-coverage-analysis/SKILL.md` | Dispatches a `general-task-execution` subagent through `invokeSubAgent` for integration extraction and for architecture-specific code analysis. | Almost all of its 2,000 lines: requirement-to-test mapping, coverage calculations, gap severities, analysis prompts per architecture, and release readiness. |

### SOPs

| File | Orchestration part | Other function |
| ---- | ------------------ | -------------- |
| `agent-sops/k-full-sdlc.sop.md` | "Every phase runs in a subagent"; a task-to-agent table. | The full lifecycle procedure: state tracking and recovery, artifact layout, intake and feasibility gates, the collision-safe feature slug algorithm, branch and review rules, test tiers and documentation formats. `fuse/flow/workflows/_k-full-sdlc.yml` reproduces its steps without subagents. |
| `agent-sops/k-e2e-test-generation.sop.md` | Assigns discovery, authoring and validation to `k-browser`, `k-quality-assurance` and `k-developer`. | Credential handling, crawl limits, Cypress and Playwright scaffolding, selector patterns, validation and the plaintext-password check. |
| `agent-sops/k-light-ui-testing.sop.md` | Assigns discovery and execution to `k-browser` and `k-quality-assurance`; describes the orchestrators' carve-out for its credential steps. | Credential handling, the structured test prompt format with DOM context, the review gate, evidence rules and the results schema. |
| `agent-sops/k-adversarial-pull-request-review.sop.md` | Three parallel `k-developer` passes, a reuse pass, and a `k-architect` checker. | Diff ingestion rules, the checker's keep-or-reject contract, deduplication, the severity algorithm and the report format. |
| `agent-sops/k-plan.sop.md` | Step 4 assigns tasks to agents; the projection prefers `k-tpm`. | Success criteria, task breakdown, dependency analysis, estimation with an explicit fallback method, and the execution plan. |
| `agent-sops/k-comprehensive-search.sop.md` | Step 2 spawns `k-developer` and `k-researcher` searches. | Query variation, search syntax, result caps, deduplication and synthesis. |
| `agent-sops/k-context-gathering.sop.md` | Parallel `k-researcher` work and escalation to `k-architect`. | The five mandatory analysis questions, the complexity matrix and the synthesis sections. |
| `agent-sops/kiro-spec-workflow.sop.md` | Assigns the three generation steps to `k-product-manager`, `k-architect` and `k-developer`. | Spec directory resolution, revision caps, per-step self-checks and requirement-to-task traceability. |
| `agent-sops/about-konductor.sop.md` | The final handoff to `konductor`. | Runtime identification, install guidance and live discovery commands. |

## How the pieces fit together

The orchestration layer was three levels deep. The orchestrator agents loaded
`k-orchestrator-routing-rules.md` at startup, which decided whether a message matched a SOP or a
specialist. `delegation-protocol` (and `k-delegate` in SOP form) defined how to write the prompt
for the chosen specialist. `claude-teams-behavior`, `mux-dispatch` and `cmux-dispatch` defined how
that prompt reached the specialist on each runtime. The two tables in `delegation-protocol` and
the routing context file were maintained as duplicates, with a note in each saying which one wins.

The SOPs sit beside this layer rather than inside it. Each SOP was written for an orchestrator and
names the specialist that should run each step, but the steps themselves are the substance. The
fuse-flow workflows in `fuse/flow/workflows/` already show the alternative: one agent runs every
step and loads the step's skill directly.

Today, step-to-step orchestration is the fuse-flow step function's job, while the default agent does
all work because specialist agents are not inherently better at a job; they are only artificially
limited from doing other work. The agent may still spawn subagents to parallelize work or preserve
a clean context, but it can decide when that is useful without our instructions, and it does not
need agent specs to spawn subagents.

## Risks and open questions

This section was written as an audit of the tree right after the deletion. The same change then
resolved most of what it found; each item says where it stands at the end of that change.

- Resolved: surviving files named the deleted routing files (`k-full-sdlc` named
  `delegation-protocol`, `k-comprehensive-search` pointed to the delegate SOP format,
  `sop-state-management` cited the `mux-dispatch` lock). Those references were removed.
- Resolved: the surviving SOPs and skills listed above assigned steps to deleted `k-*` agents or to
  the orchestrator. They now tell the agent running them to do each step itself, with generic
  subagents or separate passes where a step needs independence. `k-adversarial-pull-request-review`
  now distinguishes an isolated mode (generic subagents) from a single-context mode whose verdict is
  advisory.
- Resolved: `test-coverage-analysis` required a `general-task-execution` subagent, a name that was
  never part of this repository's fleet. It now runs that analysis in a generic subagent when one
  is available and inline otherwise.
- Resolved: for the Kiro harnesses, skills installed under `.konductor/skills/`, which Kiro CLI does
  not scan; an agent reached them through the konductor-skills MCP server that its own spec
  configured. The CLI now installs the skills of an agentless synth output under `.kiro/skills/`,
  where Kiro CLI finds them natively, and fuse-flow's skill lookup searches `.kiro/skills/` first.
- Resolved: installing over an agent-bearing install left the old agents and skills on disk and
  untracked. `konductor install` now removes files the previous install of the same harness wrote
  that the new source dropped, when they are unchanged and provably Konductor's.
- Open: the user guide under `docs/user-guide/`, the HTML bundles in `docs/` and the integration
  guides under `docs/guides/` still describe the agent fleet and the orchestrators. `make
  guide-check` therefore reports drift. README states this.
- Open: the Konductor CLI (`cli/`) still supports synthesizing and installing agent specs, and
  the orchestrators were the only agents that listed most SOPs. Without them nothing points a user
  at a SOP; the README, `about-konductor` and `sdlc-navigator` do that job now.
