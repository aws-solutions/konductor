# Kiro Spec Workflow

## Overview

End-to-end workflow that transforms PM and design artifacts into Kiro IDE spec documents. Chains three skills in sequence: kiro-requirements-generation → kiro-design-generation → kiro-task-generation, producing a complete `.kiro/specs/{feature-name}/` directory (by default — see `spec_dir` below) with requirements.md, design.md, and tasks.md.

> **Execution context:** Each skill below lives on the domain specialist who owns that artifact type, not on the orchestrator. The orchestrator delegates each step to the named agent and passes it the step's parameters; the specialist runs its skill and returns the output file.

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
- If user requests changes, You MUST revise and re-present (max 2 cycles)

**Expected Output:** spec_dir/requirements.md

### 2. Generate Design (Per-Feature)

Delegate to `k-architect`. It runs the `kiro-design-generation` skill to produce per-feature low-level design.

**Constraints:**

- You MUST read requirements.md from Step 1 and design artifacts from design_artifacts_path
- You MUST pass the resolved `spec_dir` from Parameters (above) to the skill as its own `spec_dir` parameter — never omit it and never rely on the skill's own internal default to decide it
- You MUST produce design.md with all 6 required sections (Overview, Architecture, Components and Interfaces, Data Models, Error Handling, Testing Strategy)
- You MUST ensure design addresses ALL requirements from requirements.md
- You MUST present design.md to user for approval before proceeding
- If user requests changes, You MUST revise and re-present (max 2 cycles)
- **For UI features**: before presenting design.md for approval, if a UI-prototyping agent is available, spawn it with the HLD or product requirements document URL to generate a Cloudscape mock UI. Present the mock alongside design.md so the user can validate both the design and the UI before handing off to implementation.

**Expected Output:** spec_dir/design.md

### 3. Generate Tasks (Kiro Format)

Delegate to `k-developer`. It runs the `kiro-task-generation` skill to produce a Kiro IDE-compatible task list.

**Constraints:**

- You MUST read requirements.md and design.md from previous steps
- You MUST pass the resolved `spec_dir` from Parameters (above) to the skill as its own `spec_dir` parameter — never omit it and never rely on the skill's own internal default to decide it
- You MUST produce tasks.md in Kiro IDE format: numbered checkboxes, max 2-level hierarchy, requirement references
- You MUST ensure every requirement has at least one task
- You MUST present tasks.md to user for approval
- If user requests changes, You MUST revise and re-present (max 2 cycles)

**Expected Output:** spec_dir/tasks.md

### 4. Validate Spec Completeness

The orchestrator verifies all three documents are consistent and complete. It MAY delegate this to a specialist agent (e.g. architect or QA) but is not required to.

**Constraints:**

- You MUST verify requirements.md, design.md, and tasks.md all exist in spec_dir
- You MUST verify every requirement in requirements.md is addressed in design.md
- You MUST verify every requirement has at least one task in tasks.md
- You MUST present a traceability summary: requirement → design section → task(s)

**Expected Output:** Traceability summary and confirmation that spec is ready for execution
