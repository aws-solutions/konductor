# Kiro Spec Workflow

Orchestration: strict (phase-gated SOP)
Strict means: stop at each recorded gate, record the gate facts, and do not proceed past an unmet gate unless the engineer overrides it, or the SOP's own round-cap rule says to proceed; record which.

Recorded gates are the stops this SOP names; where the run keeps a session file, record their gate facts there.

## Overview

End-to-end workflow that transforms PM and design artifacts into Kiro IDE spec documents. Chains three skills in sequence: kiro-requirements-generation → kiro-design-generation → kiro-task-generation, producing a complete `.kiro/specs/{feature-name}/` directory (by default — see `spec_dir` below) with requirements.md, design.md, and tasks.md.

> **Execution context:** Each skill below lives on the domain specialist who owns that artifact type, not on the orchestrator — this delegation buys capability specialization, since generating EARS requirements, a low-level design, or a Kiro task list each requires a different domain skill the orchestrator doesn't hold inline. The orchestrator delegates each step to the named agent and passes it the step's parameters; the specialist runs its skill and returns the output file.

The orchestrator does not look these skills up or load them itself; the delegate named in each step runs its skill.

> **No independent review exists for design.md today:** Steps 2 and 3 each run a lightweight self-check inside the same agent that generated the artifact. This catches clear defects but is not an independent review, since the generator and the checker share one context and one set of blind spots. `k-full-sdlc` runs `k-principal-engineer-design-review`, but against the earlier, project-wide `system-design.md` its own Step 3 produces, not against this SOP's per-feature `design.md`. Composing this SOP inside `k-full-sdlc` does not add an independent pass for the artifact this SOP produces. Whether run standalone or composed, this SOP's `design.md` gets only the self-check above until an independent review step is added after `k-full-sdlc`'s Step 6.

## Parameters

- **feature_name** (required): Feature name in kebab-case (e.g., "user-authentication")
- **feature_scope_path** (required for a feature spec): Path to feature-split file containing this feature's scoped user stories, key components, and dependencies
- **user_stories_path** (required for a feature spec): Path to full user stories file from user-story-writing skill
- **design_artifacts_path** (required for a feature spec, optional for a bugfix spec): Path to design artifacts directory from architect phase
- **spec_type** (optional, default `feature`): `feature` or `bugfix`. A bugfix spec writes `bugfix.md` (Current, Expected and Unchanged Behavior) in place of `requirements.md`
- **workflow** (optional, default `requirements-first`): `requirements-first` or `design-first`, the two orders Kiro offers for a feature spec. A bugfix spec always starts from `bugfix.md`, so this parameter applies only when `spec_type` is `feature`
- **bug_report_path** (required for a bugfix spec): Path to the bug report: observed behavior, reproduction steps and the issue ID
- **spec_dir** (optional): path where spec artifacts are written. If the caller does not provide one, You MUST resolve it yourself, right now, to `.kiro/specs/{feature_name}/` — do not leave it unresolved and do not defer resolution to the skills in Steps 1-3. This is the single place the default is decided; every step below passes the resulting concrete value down explicitly. A caller that wants a different location (e.g. `k-full-sdlc`/`full-sdlc-pass`) passes its own `spec_dir` explicitly — that override always wins.

## Steps

### 0. Set Up the Spec

**Constraints:**

- You MUST first choose the path. Offer the native path only when the session runs in Kiro (Kiro CLI or the Kiro IDE), this SOP runs standalone rather than inside a caller such as `k-full-sdlc`, and `spec_dir` is `.kiro/specs/{feature_name}/`. The native path points Kiro at the handoff files (feature scope, user stories, design artifacts, or the bug report) and starts Kiro's own spec flow seeded with them: `/spec new {feature_name}` in Kiro CLI, or a spec session or Quick Spec in the IDE. Kiro then writes the three documents and `.config.kiro` with its own review stops and shows traceability in its spec view. If the user picks the native path, skip Steps 1 to 3 and run only Step 4 on what Kiro wrote. In every other case, including every run a caller started, take the generated path: Steps 1 to 3
- On the generated path, the spec's config file is `spec_dir/.config.kiro`, in the form Kiro writes it: one JSON object with `specId` (a new random UUID), `workflowType` (the `workflow` value, `requirements-first` for a bugfix spec) and `specType` (the `spec_type` value), for example `{"specId": "ceceb69e-75d3-4917-bec9-8e787aa95bf2", "workflowType": "requirements-first", "specType": "feature"}`. You do not write it: the delegate of the first generation step creates `spec_dir` and writes it, `k-product-manager` in Step 1 for a requirements-first or bugfix spec and `k-architect` in the first Step 2 pass for a design-first spec. An existing `.config.kiro` and its `specId` are kept when the spec already exists
- You MUST run the steps in this order: requirements-first runs Steps 1, 2, 3. Design-first runs Step 2 (design.md from the design artifacts alone), then Step 1 (requirements derived from that design), then Step 2's link pass, then Step 3. A bugfix spec runs Step 1 in bugfix mode, then Steps 2 and 3
- Execution is handed off after Step 4; see Step 4 for when Kiro runs the tasks and when the caller does

**Expected Output:** The path chosen (native or generated) and the step order

### 1. Generate Requirements (EARS Format)

Delegate to `k-product-manager`. It runs the `kiro-requirements-generation` skill to convert user stories into EARS-format requirements.

**Constraints:**

- You MUST read the feature scope from feature_scope_path to identify which user stories and components are in scope for this feature
- You MUST read user stories from user_stories_path, filtering to only those mapped to this feature in the feature scope
- In a requirements-first or bugfix spec, You MUST have the delegate create spec_dir/ and write spec_dir/.config.kiro as Step 0 defines it
- You MUST pass the resolved `spec_dir` from Parameters (above) to the skill as its own `spec_dir` parameter — never omit it and never rely on the skill's own internal default to decide it
- You MUST pass `spec_type` and `workflow` to the skill
- For a feature spec, You MUST pass feature_scope_path and user_stories_path to the skill. The feature split at feature_scope_path, from `task-decomposition`, is authoritative for story IDs: where it and user_stories_path number a story differently, the split's ID wins
- You MUST produce requirements.md with a Glossary and EARS acceptance criteria (WHEN/IF/WHILE...SHALL), each requirement with a `**Source:**` line naming its user story by the ID feature_scope_path uses (for example `US-3`), the story title, and the feature-split file, so each requirement traces back to the story in the PM handoff
- For a bugfix spec, You MUST instead read the bug report from bug_report_path, skip the feature scope and user stories reads above, and produce bugfix.md
- You MUST present requirements.md (or bugfix.md) to user for approval before proceeding
- If user requests changes, You MUST revise and re-present (max 2 cycles). If the user still requests changes after 2 cycles, You MUST stop and ask the user how to proceed: accept the current draft with noted open concerns, continue revising past the cap, or escalate/abandon — do not silently continue looping or silently proceed with unresolved feedback.

**Expected Output:** spec_dir/requirements.md, or spec_dir/bugfix.md for a bugfix spec

### 2. Generate Design (Per-Feature)

Delegate to `k-architect`. It runs the `kiro-design-generation` skill to produce per-feature low-level design.

**Constraints:**

- You MUST read requirements.md (or bugfix.md) from Step 1 and design artifacts from design_artifacts_path. The first pass of a design-first spec runs before Step 1, so it reads the design artifacts only
- In the first pass of a design-first spec, You MUST pass feature_scope_path and user_stories_path to the skill, which takes the feature's scope from them, and have the delegate create spec_dir/ and write spec_dir/.config.kiro as Step 0 defines it
- You MUST pass the resolved `spec_dir` from Parameters (above) to the skill as its own `spec_dir` parameter — never omit it and never rely on the skill's own internal default to decide it
- You MUST pass `spec_type` and `workflow` to the skill. In a design-first spec, the first pass runs before requirements.md exists, and the link pass after Step 1 adds the requirement numbers to the design. The link pass presents design.md again through the approval gate below, within the same 2-cycle cap as the first pass
- You MUST produce design.md with all 7 required sections (Overview, Architecture, Components and Interfaces, Data Models, Correctness Properties, Error Handling, Testing Strategy). A bugfix design uses the skill's bugfix section list instead
- You MUST ensure design addresses ALL requirements from requirements.md (all Expected and Unchanged Behavior items from bugfix.md), from the link pass on in a design-first spec
- Before presenting, You MUST run a lightweight self-check pass over design.md: does every major section stay internally consistent, and does the design plausibly satisfy every requirement's acceptance criteria (not just exist as a section heading)? If a self-check finds a clear defect, fix it before presenting rather than presenting a known-broken draft.
- You MUST present design.md to user for approval before proceeding
- If user requests changes, You MUST revise and re-present (max 2 cycles). If the user still requests changes after 2 cycles, You MUST stop and ask the user how to proceed: accept the current draft with noted open concerns, continue revising past the cap, or escalate/abandon — do not silently continue looping or silently proceed with unresolved feedback.
- **For UI features**: before presenting design.md for approval, if a UI-prototyping agent is available, spawn it with the HLD or product requirements document URL to generate a Cloudscape mock UI. Present the mock alongside design.md so the user can validate both the design and the UI before handing off to implementation.

**Expected Output:** spec_dir/design.md

### 3. Generate Tasks (Kiro Format)

Delegate to `k-developer`. It runs the `kiro-task-generation` skill to produce a Kiro IDE-compatible task list.

**Constraints:**

- You MUST read requirements.md (or bugfix.md) and design.md from previous steps
- You MUST pass the resolved `spec_dir` from Parameters (above) to the skill as its own `spec_dir` parameter — never omit it and never rely on the skill's own internal default to decide it
- You MUST pass `spec_type` to the skill
- You MUST produce tasks.md in Kiro IDE format: numbered checkboxes, max 2-level hierarchy, requirement references, optional test tasks marked `- [ ]*`, checkpoint tasks, and the `## Task Dependency Graph` section with its waves. A bugfix tasks.md uses the skill's shorter bugfix form, which has no graph
- You MUST ensure every requirement has at least one task
- Before presenting, You MUST verify every task in tasks.md maps to a real, actionable implementation step (not a placeholder or restated requirement) — if a task doesn't survive that check, revise it before presenting.
- You MUST present tasks.md to user for approval
- If user requests changes, You MUST revise and re-present (max 2 cycles). If the user still requests changes after 2 cycles, You MUST stop and ask the user how to proceed: accept the current draft with noted open concerns, continue revising past the cap, or escalate/abandon — do not silently continue looping or silently proceed with unresolved feedback.

**Expected Output:** spec_dir/tasks.md

### 4. Validate Spec Completeness

The orchestrator checks that the three documents agree. It MAY delegate this to a specialist agent (e.g. architect or QA) but is not required to. Kiro shows requirement-to-task traceability in its own spec view, so this step reports gaps, not a full traceability table.

**Constraints:**

- You MUST verify requirements.md (or bugfix.md), design.md, tasks.md and .config.kiro all exist in spec_dir
- You MUST verify every acceptance criterion (every bugfix.md item) is cited by a design property's Validates line or by a task
- In a feature spec on the generated path, You MUST verify every requirement has a `**Source:**` line whose story ID exists in feature_scope_path when one was given, else in user_stories_path. On the native path, Kiro's own requirements.md has no Source lines: report requirements without one as information, not as gaps
- In a bugfix spec, You MUST verify bugfix.md's Introduction names the bug report ID from bug_report_path
- You MUST verify every correctness property has a test task, and, in a feature spec, every leaf task appears in exactly one wave of the Task Dependency Graph
- You MUST report each gap found, or state that there are none
- You MUST hand execution off only when Step 0 allowed the native path: in Kiro, standalone, with `spec_dir` at `.kiro/specs/{feature_name}/`. Then spec_dir holds a Kiro spec, so `/spec view {feature_name}` opens them, `/spec analyze_requirements {feature_name}` checks requirements.md for ambiguities and missing criteria, and `/spec run {feature_name}` executes tasks.md in dependency waves; offer these rather than working through tasks.md by hand. Property-based testing and Kiro's correctness checks run in the Kiro IDE only; Kiro CLI runs the tasks, including the property test tasks, as ordinary tasks. In every other case, stop after the gap report: a caller such as `k-full-sdlc` owns execution

**Expected Output:** The gap list (or "no gaps"), confirmation that the spec is ready for execution, and who runs it (Kiro or the caller)
