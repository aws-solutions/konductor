# Kiro Spec Workflow

## Overview

End-to-end workflow that transforms PM and design artifacts into Kiro IDE spec documents. Chains three skills in sequence: kiro-requirements-generation → kiro-design-generation → kiro-task-generation, producing a complete `.kiro/specs/{feature-name}/` directory (by default — see `spec_dir` below) with requirements.md, design.md, and tasks.md.

> **Execution context:** Each skill below lives on the domain specialist who owns that artifact type, not on the orchestrator — this delegation buys capability specialization, since generating EARS requirements, a low-level design, or a Kiro task list each requires a different domain skill the orchestrator doesn't hold inline. The orchestrator delegates each step to the named agent and passes it the step's parameters; the specialist runs its skill and returns the output file.

> **No independent review exists for design.md today:** Steps 2 and 3 each run a lightweight self-check inside the same agent that generated the artifact. This catches clear defects but is not an independent review, since the generator and the checker share one context and one set of blind spots. `k-full-sdlc` runs `k-principal-engineer-design-review`, but against the earlier, project-wide `system-design.md` its own Step 3 produces, not against this SOP's per-feature `design.md`. Composing this SOP inside `k-full-sdlc` does not add an independent pass for the artifact this SOP produces. Whether run standalone or composed, this SOP's `design.md` gets only the self-check above until an independent review step is added after `k-full-sdlc`'s Step 6.

## Parameters

- **feature_name** (required): Feature name in kebab-case (e.g., "user-authentication")
- **feature_scope_path** (required): Path to feature-split file containing this feature's scoped user stories, key components, and dependencies
- **user_stories_path** (required): Path to full user stories file from user-story-writing skill
- **design_artifacts_path** (required): Path to design artifacts directory from architect phase
- **spec_dir** (optional): path where spec artifacts are written. If the caller does not provide one, You MUST resolve it yourself, right now, to `.kiro/specs/{feature_name}/` — do not leave it unresolved and do not defer resolution to the skills in Steps 1-3. This is the single place the default is decided; every step below passes the resulting concrete value down explicitly. A caller that wants a different location (e.g. `k-full-sdlc`/`full-sdlc-pass`) passes its own `spec_dir` explicitly — that override always wins.

## Steps

### 1. Generate Requirements (EARS Format)

Delegate to `k-product-manager`. It runs the `kiro-requirements-generation` skill to convert user stories into EARS-format requirements.

**Constraints:**

- You MUST read the feature scope from feature_scope_path to identify which user stories and components are in scope for this feature
- You MUST read user stories from user_stories_path, filtering to only those mapped to this feature in the feature scope
- You MUST create the output directory: spec_dir/
- You MUST pass the resolved `spec_dir` from Parameters (above) to the skill as its own `spec_dir` parameter — never omit it and never rely on the skill's own internal default to decide it
- You MUST produce requirements.md with EARS acceptance criteria (WHEN/IF/WHILE...SHALL)
- You MUST present requirements.md to user for approval before proceeding
- If user requests changes, You MUST revise and re-present (max 2 cycles). If the user still requests changes after 2 cycles, You MUST stop and ask the user how to proceed: accept the current draft with noted open concerns, continue revising past the cap, or escalate/abandon — do not silently continue looping or silently proceed with unresolved feedback.

**Expected Output:** spec_dir/requirements.md

### 2. Generate Design (Per-Feature)

Delegate to `k-architect`. It runs the `kiro-design-generation` skill to produce per-feature low-level design.

**Constraints:**

- You MUST read requirements.md from Step 1 and design artifacts from design_artifacts_path
- You MUST pass the resolved `spec_dir` from Parameters (above) to the skill as its own `spec_dir` parameter — never omit it and never rely on the skill's own internal default to decide it
- You MUST produce design.md with all 6 required sections (Overview, Architecture, Components and Interfaces, Data Models, Error Handling, Testing Strategy)
- You MUST ensure design addresses ALL requirements from requirements.md
- Before presenting, You MUST run a lightweight self-check pass over design.md: does every major section stay internally consistent, and does the design plausibly satisfy every requirement's acceptance criteria (not just exist as a section heading)? If a self-check finds a clear defect, fix it before presenting rather than presenting a known-broken draft.
- You MUST present design.md to user for approval before proceeding
- If user requests changes, You MUST revise and re-present (max 2 cycles). If the user still requests changes after 2 cycles, You MUST stop and ask the user how to proceed: accept the current draft with noted open concerns, continue revising past the cap, or escalate/abandon — do not silently continue looping or silently proceed with unresolved feedback.
- **For UI features**: before presenting design.md for approval, if a UI-prototyping agent is available, spawn it with the HLD or product requirements document URL to generate a Cloudscape mock UI. Present the mock alongside design.md so the user can validate both the design and the UI before handing off to implementation.

**Expected Output:** spec_dir/design.md

### 3. Generate Tasks (Kiro Format)

Delegate to `k-developer`. It runs the `kiro-task-generation` skill to produce a Kiro IDE-compatible task list.

**Constraints:**

- You MUST read requirements.md and design.md from previous steps
- You MUST pass the resolved `spec_dir` from Parameters (above) to the skill as its own `spec_dir` parameter — never omit it and never rely on the skill's own internal default to decide it
- You MUST produce tasks.md in Kiro IDE format: numbered checkboxes, max 2-level hierarchy, requirement references
- You MUST ensure every requirement has at least one task
- Before presenting, You MUST verify every task in tasks.md maps to a real, actionable implementation step (not a placeholder or restated requirement) — if a task doesn't survive that check, revise it before presenting.
- You MUST present tasks.md to user for approval
- If user requests changes, You MUST revise and re-present (max 2 cycles). If the user still requests changes after 2 cycles, You MUST stop and ask the user how to proceed: accept the current draft with noted open concerns, continue revising past the cap, or escalate/abandon — do not silently continue looping or silently proceed with unresolved feedback.

**Expected Output:** spec_dir/tasks.md

### 4. Validate Spec Completeness

The orchestrator verifies all three documents are consistent and complete. It MAY delegate this to a specialist agent (e.g. architect or QA) but is not required to.

**Constraints:**

- You MUST verify requirements.md, design.md, and tasks.md all exist in spec_dir
- You MUST verify every requirement in requirements.md is addressed in design.md
- You MUST verify every requirement has at least one task in tasks.md
- You MUST present a traceability summary: requirement → design section → task(s)

**Expected Output:** Traceability summary and confirmation that spec is ready for execution
