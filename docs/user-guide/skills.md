<!-- SPDX-License-Identifier: Apache-2.0 -->

# Skills catalog

[← Back to guide index](README.md)

All **82 skills** the package ships, grouped by what they are for. Each entry gives what the
skill does, when it makes sense to reach for it, and which agents declare it.

A **skill** is a module of knowledge an agent loads on demand — see
[Core concepts → skill](concepts.md#skill). You do not usually invoke one by name: you describe
what you want and the agent loads what it needs. Naming one explicitly is still useful when you
know exactly which lens you want applied.

> **A skill is only available in a session with an agent that declares it.** The "Declared by"
> column is therefore the practical one — it tells you who to talk to. Every skill is declared by
> at least one agent; see [Coverage](#coverage).

---

## Contents

- [Behaviour, routing, and memory](#behaviour-routing-and-memory) — 13
- [Requirements and product](#requirements-and-product) — 7
- [Program and delivery management](#program-and-delivery-management) — 7
- [Architecture and design](#architecture-and-design) — 12
- [Design quality gates](#design-quality-gates) — 6
- [API and data modelling](#api-and-data-modelling) — 6
- [Security](#security) — 3
- [Implementation and code review](#implementation-and-code-review) — 17
- [Testing and browser automation](#testing-and-browser-automation) — 7
- [Kiro spec generation](#kiro-spec-generation) — 3
- [Research](#research) — 1
- [Coverage](#coverage)
- [Which agent has the most skills?](#which-agent-has-the-most-skills)

---

## Behaviour, routing, and memory

Loaded to shape *how* an agent works rather than what it produces. Several are on every agent.

| Skill | What it does | Reach for it when | Declared by |
| --- | --- | --- | --- |
| `constraints` | Hard behavioural rules for every agent — what they must never and always do, across code quality, security, and verification. | Always on. You never invoke it; it is the floor every agent stands on. | all 11 |
| `about-konductor` | Gets a new user from nothing to a working session: the real `konductor` CLI command surface, example orchestrator prompts, and the agent/skill/SOP model. | Someone asks what this is, how to install it, or what they can ask for. Backs the SOP of the same name. | all 3 orchestrators |
| `sop-state-management` | Session and checklist mechanics for long-running SOPs: minting or resuming a session by project identity, per-phase status, and serialized fix-cycle counters. | You are running or resuming `k-full-sdlc`. It owns the state file schema and the resume-discovery walk. | all 3 orchestrators |
| `delegation-protocol` | The authoritative delegation format: the 8-field prompt (target agent + 7 sections), the agent registry, parallel-execution rules, and handoff patterns. | Read it to understand what the orchestrator sends a specialist. Edit it to change routing — it outranks the routing-rules context file. | all 3 orchestrators |
| `sdlc-navigator` | Guidance on which agent to use next and how artifacts connect across SDLC phases. | You are unsure what comes next, or which agent owns the thing you want. | `konductor`, `konductor-mux-orchestrator`, `konductor-cmux-orchestrator`, `k-architect`, `k-browser`, `k-product-manager`, `k-quality-assurance`, `k-researcher`, `k-tpm` |
| `pre-planning-analysis` | Classifies an ambiguous request into 6 intent types, names the ambiguities, bounds scope, and recommends an agent chain. | Your request is vague and you would rather be asked good questions than get a confident wrong answer. | all 3 orchestrators |
| `socratic-elicitation` | Interactive Socratic questioning in two modes — Mode A intake (before work) and Mode B challenge (stress-testing a plan you already hold). | You want assumptions surfaced before anything gets built, or you want your own plan attacked. | `konductor`, `konductor-mux-orchestrator`, `konductor-cmux-orchestrator`, `k-architect`, `k-developer`, `k-product-manager`, `k-researcher` |
| `verification` | TDD workflow and evidence-collection protocol; nothing is declared complete without proof. | Always on for orchestrators. It is what makes "done" mean something. | all 3 orchestrators |
| `claude-teams-behavior` | Claude Code Agent Teams patterns — hub-and-spoke contract, when to use SendMessage, background spawning, agent-name resolution. | Claude Code only. Loaded automatically; relevant if you are debugging why teammates behave a certain way. | `konductor` |
| `mux-dispatch` 📎 | Dispatches specialists into parallel tmux or zellij panes. Auto-detects the active multiplexer. Ships five shell scripts. | You want to watch each specialist work in its own pane. | `konductor-mux-orchestrator` |
| `cmux-dispatch` 📎 | Same as `mux-dispatch` but for cmux surfaces. Ships two shell scripts. | You use cmux and want parallel surfaces. | `konductor-cmux-orchestrator` |
| `persistent-memory` 📎 | Reads and writes bounded memory files that persist facts across sessions. Ships a config template and scripts. | You are tired of re-explaining project conventions every session. | `k-architect`, `k-developer`, `konductor`, `k-product-manager`, `k-researcher`, `k-tpm` |
| `workspace-skills` | Teaches agents when and how to create project-specific skills, with dedup and provenance protection. | A workflow you just did by hand is one you will repeat — capture it. | `k-architect`, `k-developer`, `konductor`, `k-product-manager`, `k-quality-assurance`, `k-researcher`, `k-tpm` |

📎 ships helper files alongside `SKILL.md`: `mux-dispatch` (`mux-close-pane.sh`, `mux-completion-hook.sh`, `tmux-dispatch.sh`, `zellij-dispatch.sh`), `cmux-dispatch` (`cmux-completion-hook.sh`, `cmux-dispatch.sh`), `persistent-memory` (`memory-config.json.template`, `scripts`)

---

## Requirements and product

Turning a business ask into something an engineer can build.

| Skill | What it does | Reach for it when | Declared by |
| --- | --- | --- | --- |
| `requirements-extraction` | Extracts design inputs from requirements outputs into three focused files: business-context.md, requirements-summary.md, user-stories-extract.md. | You are moving from requirements into design and want the architect to start from something structured. | `k-architect`, `k-product-manager` |
| `user-story-writing` | Creates user stories with INVEST principles, epics, and acceptance criteria. Scales to MVP (10-15), Production (20-30), or full scope (30-40 stories). | Validated requirements exist and you need development-ready stories. | `k-product-manager` |
| `task-decomposition` | Splits stories and a system design into independent features that individual engineers can build with minimal overlap. | The HLD is done and you need to parallelise the work across people. | `k-developer`, `k-product-manager`, `k-tpm` |
| `sprint-planning` | Task hierarchy, story-point sizing, capacity tracking, sprint workflow. | You are planning a sprint or sizing work, with no external tracker involved. | `k-product-manager`, `k-tpm` |
| `asana-sprint-planning` | The same sprint workflow, driven through Asana. | You track sprints in Asana. Needs an Asana MCP server — opt-in. | `k-product-manager` |
| `decision-research` | Research patterns for gathering context before deciding and verifying artifact claims: prior art, alternatives, trade-offs, evidence base, assumption challenges. | A decision needs evidence rather than opinion. | `k-architect`, `k-product-manager` |
| `document-formats` | Reads and writes `.docx` via pandoc. | Your requirements arrived as a Word document. | `k-product-manager`, `k-quality-assurance`, `k-researcher`, `k-tpm` |

---

## Program and delivery management

Coordination across people and time rather than within one codebase.

| Skill | What it does | Reach for it when | Declared by |
| --- | --- | --- | --- |
| `program-planning` | Program plans with timelines, milestones, dependencies, and critical-path analysis. | Starting or replanning a program spanning multiple workstreams. | `k-tpm` |
| `program-decision-docs` | Program-level decision documents with options analysis, trade-offs, and a recommendation. | A cross-team decision needs to be written down formally. | `k-tpm` |
| `status-reporting` | Program status reports for stakeholders. | Weekly updates, executive summaries, milestone reviews. | `k-tpm` |
| `risk-management` | Identifies, assesses, and tracks program risks with mitigation plans and RAID logs. | Starting a risk assessment, or a risk register has gone stale. | `k-tpm` |
| `plan-review` | Critically reviews a work plan against clarity, verifiability, context completeness, and big picture. Gives a 1-5 rating and a BLOCKED / OKAY / SHIP IT verdict. | You have a plan and want it torn apart before anyone executes it. | `k-tpm` |
| `legacy-to-agentic-estimate` 📎 | Converts all-human effort estimates into agentic-SDLC estimates accounting for AI toolchains. Ships `convert_estimates.py` plus evals. | Re-baselining a legacy estimate for AI-assisted delivery. Note the tier presets are uncalibrated defaults. | `k-product-manager`, `k-tpm` |
| `progress-tracking` | Validates feature plans and tracks implementation against requirements traceability, in three modes: initial, progress, final. | Mid-implementation, and you want to know what is genuinely done. | `k-developer` |

📎 ships helper files alongside `SKILL.md`: `legacy-to-agentic-estimate` (`evals`, `scripts`)

---

## Architecture and design

Producing the design itself.

| Skill | What it does | Reach for it when | Declared by |
| --- | --- | --- | --- |
| `system-design-patterns` | Guides system architecture design through a structured interview. Produces the system design, NFRs, threat-model inputs, and an architecture-diagram description. | Starting a new service or feature that needs a design document. | `k-architect` |
| `architecture-advisor` | Quick recommendation mode — concise opinions with trade-off analysis instead of a full artifact. | You want a sanity check or an opinion, not a document. | `k-architect` |
| `design-doc-guidelines` | Rules for writing and reviewing design docs: outside-in structure, plain writing, AI-slop detection, diagram accuracy, technical accuracy. | Writing or reviewing any design doc. It is also the maker-checker rubric `k-design-doc-creation` runs against. | `k-architect` |
| `non-functional-requirements` | Extracts measurable NFRs across performance, availability, security, scalability, and observability. | The design exists and "it should be fast" needs to become a number. | `k-architect` |
| `architecture-diagram-generation` | Generates AWS architecture diagrams as draw.io XML with official service icons and directional data flows; single or multi-account. | You need a real diagram from a written design. | `k-architect` |
| `cost-estimation` | AWS cost estimates in baseline, optimized, and high-availability scenarios. | Someone asked what this will cost to run. Needs service configs and expected load. | `k-architect` |
| `adr-generator` | Produces inline Architecture Decision Records — Context, Decision, Status, Alternatives Considered, Consequences. | A significant design choice needs a written record. | `k-architect` |
| `decision-writing` | How to write decision records well: structure, tone, alternatives framing, consequence articulation. | Your ADRs are technically complete but nobody can follow them. | `k-architect` |
| `trade-off-evaluator` | Scores options across cost, latency, complexity, scalability, and operability into a comparison matrix plus a recommendation. | A decision has more than one credible option. | `k-architect` |
| `deliberation-panel` | Multi-perspective deliberation: derives decision-specific axes, argues each independently, cross-examines anonymously, synthesizes a scored recommendation. Requires explicit consent. | A high-stakes decision where you want genuine disagreement, not a single voice. | `konductor`, `k-architect`, `k-developer`, `k-product-manager`, `k-researcher` |
| `argumentation-reference` | Primer on argumentation theory — Toulmin model, fallacy taxonomy, argument scoring. | Used during adversarial review to name why an argument is weak. | `k-architect` |
| `design-impact-review` | Traces the downstream, cross-artifact impact of a change before it cascades — DB column to API to frontend. Classifies each artifact BREAKING / STALE / UNAFFECTED. | You are about to change a data model, API schema, or interface and want to know what breaks. | `k-developer` |

---

## Design quality gates

Checking a design before anyone builds it.

| Skill | What it does | Reach for it when | Declared by |
| --- | --- | --- | --- |
| `design-evaluation` | Evaluates a complete design package for production readiness across 10 dimensions. | The final gate before implementation. Wants all artifacts present — design, threat model, API specs, data models, diagrams, IAM. | `k-architect` |
| `design-quality-check` | Scores a design doc for writing quality, structural completeness, and KISS/YAGNI compliance. Detects filler, hedging, unsupported claims, passive voice, circular reasoning. | The doc is complete but reads badly, or you suspect padding. | `k-architect` |
| `doc-accuracy-analyzer` | Six-step verification of a technical document against primary sources: extracts claims, investigates each, classifies, reports. | You need to know which claims in a document are actually true. | `k-architect` |
| `aws-service-validator` | Validates AWS service and feature claims against live AWS documentation. Catches hallucinated AWS assertions. | Any design that names AWS services. This is the anti-hallucination gate. | `k-architect` |
| `adversarial-design-review` | Reviews design sections from an adversarial stance, classifying CRITICAL / IMPORTANT / MINOR. Path B fallback when no devil's-advocate subagent is installed. | You want the design attacked and have no separate adversarial agent available. | `k-architect` |
| `humanize-writing` | Rewrites text to remove AI-writing tells across 34 categories while preserving meaning and voice. | A draft is accurate but obviously machine-written. | `k-architect`, `k-developer`, `k-product-manager`, `k-tpm` |

---

## API and data modelling

Interface and storage design, each paired with its own validator.

| Skill | What it does | Reach for it when | Declared by |
| --- | --- | --- | --- |
| `smithy-modeling` | Generates Smithy API models — service definitions, operations, structures, validation, errors. Supports TypeScript, OpenAPI, and AWS SDK codegen. | Designing a new service API. | `k-architect` |
| `smithy-validation` | Validates Smithy models for structure, naming, security, and codegen readiness. | Before implementing against a Smithy model. | `k-architect` |
| `dynamodb-design` | DynamoDB table designs optimized for access patterns: partition keys, GSI strategy, capacity planning, plus CDK/CloudFormation code. | Designing a data model on DynamoDB. | `k-architect` |
| `dynamodb-validation` | Validates a DynamoDB design against best practice across 13 categories — hot partitions, missing indexes, cost, security. | Before implementing a DynamoDB design. | `k-architect` |
| `iam-policy-design` | Generates least-privilege IAM role policies, resource policies, and compliance configuration. | Designing access control for a new service. | `k-architect` |
| `policy-validation` | Validates IAM policies for over-permissive grants, missing conditions, and compliance gaps. | Before deploying any IAM change. | `k-architect` |

---

## Security

Security-specific analysis, spanning design through remediation.

| Skill | What it does | Reach for it when | Declared by |
| --- | --- | --- | --- |
| `threat-modeling` | AWS threat models via STRIDE — architecture analysis, threat identification, security controls. | After system design, on anything touching auth, PII, or an external boundary. | `k-architect` |
| `security-test-generation` | Security test plans by domain and layer, covering all 7 domains: authentication, input validation, API security, data protection, session management, error handling, infrastructure. | You need security test coverage, not just functional coverage. | `k-quality-assurance` |
| `security-remediation` | Analyzes security findings and produces prioritized remediation plans with effort estimates and risk context. | You have a vulnerability report or appsec findings to work through. | `k-developer` |

---

## Implementation and code review

Writing and reviewing code.

| Skill | What it does | Reach for it when | Declared by |
| --- | --- | --- | --- |
| `backend-development` | Implements backend changes — Lambda handlers, service layers, DynamoDB operations. KISS/YAGNI/DRY, minimal surgical changes. | Implementing or fixing backend logic. | `k-developer` |
| `backend-review` | Reviews backend changes for pattern compliance, type safety, DynamoDB correctness, and test quality. Produces CRITICAL / IMPORTANT / SUGGESTION findings. | After backend changes, before opening a review. | `k-developer` |
| `frontend-development` | Implements React/TypeScript frontend using AWS Cloudscape. Cloudscape-only components, no native HTML. | Implementing UI in a Cloudscape app. | `k-developer` |
| `frontend-review` | Reviews frontend changes for Cloudscape compliance, React Hook Form patterns, type safety, and test quality. | After frontend changes, before opening a review. | `k-developer` |
| `infra-validation` | Validates CDK and CloudFormation against AWS best practice, security standards, and Well-Architected principles. | Before deploying any infrastructure change. | `k-developer` |
| `code-review` | Standard pull-request review workflow — creating PRs, reviewing diffs, addressing feedback, post-implementation cycles. | Ordinary code review, using git and the GitHub CLI. | `k-developer` |
| `adversarial-code-review` | Reviews a diff from an adversarial security-focused stance, arguing against approval. Targets information disclosure, data-integrity failures, and schema/validation gaps. | After standard review, on anything security-sensitive. This is what `k-adversarial-pull-request-review` runs on. | `k-architect`, `k-developer` |
| `adversarial-code-review-pass-security` | One parallel pass of the adversarial review, scoped to security: information disclosure, authorization, injection, secrets. | You do not invoke it directly — the `k-adversarial-pull-request-review` coordinator spawns it alongside the integrity and schema passes. | `k-architect`, `k-developer` |
| `adversarial-code-review-pass-integrity` | One parallel pass, scoped to data integrity: multi-item mutations, atomicity, ordering, idempotency. | Same — spawned by the coordinator, not called on its own. | `k-architect`, `k-developer` |
| `adversarial-code-review-pass-schema` | One parallel pass, scoped to schema and contract: API/schema/type changes, backward compatibility, validation completeness. | Same — spawned by the coordinator, not called on its own. | `k-architect`, `k-developer` |
| `historical-issues-registry` | Loads prior review state for a pull request, then filters new findings that duplicate ones already fixed or already declined by a human reviewer. | Reviewing a second or third revision of the same change, to stop the same comment reappearing. | `k-architect` |
| `asdlc-code-simplifier` | Simplifies code for clarity and consistency without changing behaviour. | Recently modified code is correct but hard to read. | `k-developer` |
| `asdlc-aspect-review` | Parallel n-aspect review of an artifact using subagents. | You want several independent review lenses on the same thing at once. | `k-developer` |
| `git-workflow` | Atomic commits, branch management, history operations. | Committing, branching, or searching history. | `k-developer` |
| `git-merge` | Branch merges — feature into mainline, dev into mainline, release merges. | Merging anything. Declared only by the two multiplexer orchestrators. | `konductor-cmux-orchestrator`, `konductor-mux-orchestrator` |
| `find-aws-skills` | Discovers additional AWS skills from the AWS MCP server for tasks the bundled skills do not cover. | Your task involves an AWS service and nothing bundled matches. | `k-developer` |
| `agents-md-authoring` | Creates and maintains AGENTS.md files that bootstrap agent context. Covers the agents.md standard, the context-loading block, and the CLAUDE.md bridge. | Onboarding a repo for agents, or your conventions have drifted from what agents are told. | `k-developer`, `konductor` |

---

## Testing and browser automation

Verifying behaviour, including through a real browser.

| Skill | What it does | Reach for it when | Declared by |
| --- | --- | --- | --- |
| `test-coverage-analysis` | Analyzes coverage across unit, integration, and E2E to find gaps. Two modes: coverage analysis and release readiness. | After implementation, before release. | `k-quality-assurance` |
| `e2e-test-strategy` | Turns gap analysis and user stories into a prioritized E2E test matrix (P0-P3) with execution approach and framework recommendations. | You know the gaps and need a plan to close them. | `k-quality-assurance` |
| `cypress-test-implementation` | Turns an E2E strategy into Cypress implementation tasks. Three modes: initial, progress, final. | You have chosen Cypress and need the work planned and tracked. | `k-quality-assurance` |
| `playwright-test-implementation` | Authors Playwright specs: selector strategy, authenticated-session setup via `global-setup.ts` and `storageState`, and Cloudscape-specific locator patterns. | You have chosen Playwright, are wiring up `global-setup.ts`, or are fixing flaky selectors on a Cloudscape UI. | `k-quality-assurance` |
| `app-discovery` | Navigates a deployed web app, discovers pages and interactive elements, and produces a structured discovery report. | You need to test an app nobody has mapped yet. | `k-browser` |
| `dom-inspection` | Extracts field-level metadata from web forms via the DOM and HTML5 Constraint Validation API — validation rules, error selectors, conditional visibility. | Generating tests for a form and you need its real validation rules. | `k-browser`, `k-quality-assurance` |
| `ui-text-validation` | Validates UI text against public AWS style guidance, Cloudscape standards, and content-quality principles, with before/after examples. | Reviewing user-facing copy in a console-style app. | `k-quality-assurance` |

---

## Kiro spec generation

Three chained skills that produce a Kiro IDE spec, run in order by the `kiro-spec-workflow` SOP.

Each one lives on the **domain specialist** that owns its artifact type, not on the orchestrator.
The SOP is explicit about this: the orchestrator delegates each step to the named agent and passes
it that step's parameters, and the specialist runs its own skill.

| Skill | What it does | Reach for it when | Declared by |
| --- | --- | --- | --- |
| `kiro-requirements-generation` | Turns user stories into a Kiro IDE `requirements.md` with EARS-format acceptance criteria. | Step 1 of the `kiro-spec-workflow` SOP. | `k-product-manager` |
| `kiro-design-generation` | Turns design artifacts into a per-feature Kiro IDE `design.md` with all 6 required sections. | Step 2 of the `kiro-spec-workflow` SOP, after requirements are approved. | `k-architect` |
| `kiro-task-generation` | Generates a Kiro IDE `tasks.md` — numbered checkboxes with requirement references. | Step 3 of the `kiro-spec-workflow` SOP, after design is approved. | `k-developer` |

---

## Research

Looking things up outside the repository.

| Skill | What it does | Reach for it when | Declared by |
| --- | --- | --- | --- |
| `external-research` | Searches external documentation, web resources, and best practices. | Gathering information on open-source libraries, AWS services, industry patterns, or external tools. | `k-researcher` |

---

## Coverage

**All 82 skills are declared by at least one agent.** That matters because a skill no agent
declares cannot be loaded by anything — which bites hardest when a SOP instructs an agent to use
it. Contributors adding a skill should see
[Contributing → check skill coverage](appendix/contributing.md#check-skill-coverage).

> **Recently fixed.** Four skills used to be declared by no agent: the three
> `kiro-*-generation` skills — which `kiro-spec-workflow` explicitly instructs the agent to run —
> and `security-remediation`. The three Kiro skills are now declared by all three orchestrators
> (the agents that own `kiro-spec-workflow`), and `security-remediation` by `k-developer`.
> Both runtimes were wired: the skill name in `dependencies.skills.skillNames`, which is what
> `konductor synth` reads for either harness, and in `clientConfig.claudeCli.skills`, which is what
> Claude Code lists in the rendered agent's `skills:` frontmatter.

---

## Which agent has the most skills?

Useful when deciding which agent to talk to directly.

| Agent | Skills declared |
| --- | --- |
| `k-architect` | 38 |
| `k-developer` | 27 |
| `k-product-manager` | 16 |
| `k-tpm` | 14 |
| `konductor` | 13 |
| `k-quality-assurance` | 12 |
| `konductor-cmux-orchestrator` | 10 |
| `konductor-mux-orchestrator` | 10 |
| `k-researcher` | 8 |
| `k-browser` | 4 |
| `k-media-analyzer` | 1 |

`k-architect` carries by far the most, which is why design work routed anywhere else tends to
come back thinner. `k-media-analyzer` carries only `constraints` — its capability is the
model's ability to interpret PDFs and images, not a skill library.

---

## Related

- [Agents reference](agents.md) — every agent, and what each one can access
- [SOP workflows](sop-workflows/README.md) — the 19 procedures that orchestrate these skills
- [Use cases](use-cases/README.md) — end-to-end walkthroughs
- [Core concepts → skill](concepts.md#skill) — what a skill is and how loading works

---

[← Back to guide index](README.md) · [Next: Agents reference →](agents.md)
