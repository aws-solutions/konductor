---
name: progress-tracking
description: Validates feature plans, tracks implementation progress, and verifies code-level requirements traceability. Use in three modes — initial (pre-implementation), progress (during), and final (post-implementation with code verification).
version: 1.0.0
tags: [skill, progress-tracking, implementation, traceability, validation]
---

# Progress Tracking

## Overview

Operates in three modes: initial validates feature plan completeness before implementation starts; progress tracks task completion and identifies blockers during development; final verifies that implemented code matches the design and all requirements are traceable.

## Usage

Use this skill when:

- Initial mode: validating a feature plan before implementation begins
- Progress mode: checking completion status during a sprint
- Final mode: verifying code matches design before handoff to QA

## Core Concepts

### Three Modes

Initial mode (pre-implementation) validates feature plan completeness, checks requirements coverage, and identifies dependency issues. Progress mode (during implementation) tracks task completion, identifies blockers, and monitors velocity. Final mode (post-implementation) verifies code matches design, validates traceability, and checks pattern compliance.

## Execution

When this skill is activated, use the following as your full instruction set for tracking progress. Apply the Quality Gate at the end before presenting output to the user.

---

# Execution Plan Tracker

## Purpose

Validate feature plans for completeness, track implementation progress, and ensure code-level requirements traceability. Operates in three modes: initial (pre-implementation), progress (during implementation), and final (post-implementation with code verification).

## Target Personas

- **Team Leads**: Pre-implementation validation and progress monitoring
- **Developers**: Code-level verification and pattern alignment
- **Product Managers**: Requirements traceability and coverage tracking

## Prerequisites

1. **Feature Plan**: Task breakdown in `.kiro/specs/feature-implementation/tasks.md`
2. **Feature Specs**: Individual feature directories with requirements.md, design.md, tasks.md
3. **Validation Mode**: Initial, Progress, or Final

## Execution Flow

Follow stages sequentially based on selected mode:

**Mode Branching:**

- **Initial**: Stages 1, 2, 3A, 4, 5 → Report
- **Progress**: Stages 1, 2, 3B → Report
- **Final**: Stages 1, 2, 3A, 4, 5, 6, 7, 8 → Report

---

## Common Reference Sections

### Data Structures

**Feature Map:**

```typescript
features_map: Map<
  featureName,
  {
    requirements: [{ id; userStory; acceptanceCriteria: [{ id; text }] }];
    design: {
      components: [{ name; type; description }];
      apis: [{ endpoint; method; schemas }];
      dataModels: [{ name; fields }];
    };
    tasks: [
      {
        id;
        description;
        state: 'not_started' | 'in_progress' | 'completed';
        requirementRefs;
        optional;
      },
    ];
    stats: { totalRequirements; totalTasks; completedTasks };
  }
>;
```

**Validation State:**

```typescript
{
  mode: "initial"|"progress"|"final",
  feature_plan_path, detailed_analysis, save_history,
  features_map, parsing_errors,
  validation_results: { structure?, coverage?, dependencies?, progress?, code_analysis?, pattern_analysis?, traceability? }
}
```

### Visual Indicators

Use consistently across all reports:

- ✅ Pass/Completed | ❌ Fail/Missing | ⚠️ Warning/At-Risk | 🔄 In Progress | 🚫 Blocked | ⏳ Not Started
- 📊 Coverage/Metrics | 💻 Code | 🔍 Pattern | 🔗 Traceability/Dependencies

**Progress Bar:** `[████████░░] 80% (8/10)` (each block = 10%)

### Standard Report Template

All reports follow this structure (customize sections per mode):

**CRITICAL: Status Reporting Rules**

- Use CURRENT date/time (never hardcoded dates)
- Distinguish Spec Status (files exist) from Implementation Status (tasks done)
- Feature status format: "Specs: [Complete/Pending] | Implementation: [Complete/In Progress/Not Started]"
- NEVER report "Complete" based only on file presence

```
═══════════════════════════════════════════════════
[REPORT TITLE]
═══════════════════════════════════════════════════

Validation Date: [CURRENT_DATE] | Mode: [mode] | Features: [N]

## HIGH-LEVEL PROGRESS

**Project Status:** [Overall assessment in 1-2 sentences]

| Phase              | Complete | In Progress | Not Started | Total | Progress |
| ------------------ | -------- | ----------- | ----------- | ----- | -------- |
| Spec Generation    | [M]      | [P]         | [Q]         | [N]   | [X]%     |
| Implementation     | [A]      | [B]         | [C]         | [N]   | [Y]%     |

**Estimated Remaining Effort:** [X] person-hours ([Y] person-days)

## SUMMARY
Overall Status: [✅ PASS | ❌ FAIL | ⚠️ WARNINGS]
Specs: [M] complete, [P] pending | Implementation: [A] complete, [B] in progress, [C] not started
[Mode-specific metrics]

## [MODE-SPECIFIC SECTIONS]
[Content varies by validation mode]

## RECOMMENDATIONS
Critical Actions (Must Fix): [numbered list]
Warnings (Should Address): [numbered list]

## NEXT STEPS
[Mode-specific guidance]
```

### Error Handling Patterns

**File System:** Missing files → log warning, continue with available, suggest template | Permission errors → report issue, suggest chmod, offer alternative | Invalid paths → provide error, suggest correction

**Parsing:** Malformed markdown → report line number, skip section, continue | Missing sections → log missing, extract available, continue | Invalid format → skip items, log lines, show correct format

**Validation:** Coverage gaps → identify, provide remediation, continue with warnings | Circular dependencies → detect cycles, report features, suggest breaking points | Invalid references → report IDs, suggest corrections, mark as errors

**General:** Fail gracefully with partial data | Provide context (file paths, line numbers) | Suggest concrete fixes | Prioritize: Critical (blocks) vs Warnings (should fix) vs Info (nice to have)

---

## Stage 1: Mode Selection & Context Gathering

**Objective:** Determine mode, locate feature plan, gather preferences.

**CRITICAL: Use Current Date** - Always use the actual current date/time when generating reports. Never use hardcoded example dates. Get the current date from the system.

**Mode Detection:** Analyze request for keywords:

- Initial: "validate", "check completeness", "pre-implementation", "before we start"
- Progress: "track progress", "status update", "check blockers", "how far along"
- Final: "final validation", "code verification", "post-implementation", "traceability"

If ambiguous, ask: "Which validation mode? (initial/progress/final)" with descriptions. Default: initial.

**Locate Feature Plan:** Check `.kiro/specs/feature-implementation/tasks.md`. If not found, ask user for path. Validate exists and readable.

**Gather Preferences:**

1. Detail Level: "Detailed analysis?" (yes/no, default: no) → Yes: explanations, examples, paths | No: summary only
2. Save History: "Save validation history?" (yes/no, default: no for initial, yes for progress/final) → Saves to `.kiro/specs/validation-history/[timestamp].json`

**Output:** `✅ Configuration: Mode: [mode] | Plan: [path] | Detail: [level] | History: [yes/no]`

Store: mode, feature_plan_path, detailed_analysis, save_history

**Requirements:** 8.1, 8.2

---

## Stage 2: Spec Discovery & Parsing

**Objective:** Parse feature plan, discover features, extract structured data.

**Parse Feature Plan:** Extract feature names using patterns: task descriptions, task details (`_Spec: path_`), section headers, explicit refs. Build list with: featureName, specPath, displayName, discovered status.

**Parse Spec Files:** For each feature:

**requirements.md:** Extract requirement sections, user stories, acceptance criteria. Build: `{ id, userStory, acceptanceCriteria: [{ id, text }] }`. Criteria IDs: requirement + item (e.g., "3.2").

**design.md:** Extract components, APIs, data models. Build: `{ components: [{ name, type, description }], apis: [{ endpoint, method, schemas }], dataModels: [{ name, fields }] }`.

**tasks.md:** Extract checkbox tasks with states (`- [ ]` → not*started, `- [-]` → in_progress, `- [x]` → completed). Build: `{ id, description, state, requirementRefs, optional }`. Parse refs: `\_Requirements: 1.1, 1.2*`. Optional: ends with `\*`.

Apply error handling patterns for missing files, malformed markdown, invalid formats.

**Build Feature Map:** Combine parsed data. Calculate stats: totalRequirements, totalTasks, completedTasks.

**CRITICAL: Feature Status Logic** - Distinguish between spec status and implementation status:

- **Spec Status:** Whether spec files (requirements.md, design.md, tasks.md) exist
  - ✅ Specs Complete: All 3 files exist
  - ⏳ Specs Pending: Files missing or incomplete
- **Implementation Status:** Whether tasks are actually completed (based on checkbox states)
  - ✅ Implementation Complete: All required tasks marked [x]
  - 🔄 Implementation In Progress: Some tasks marked [-] or [x]
  - ⏳ Implementation Not Started: All tasks marked [ ]

**NEVER** report a feature as "Complete" just because spec files exist. A feature is only complete when implementation tasks are done.

**Report:** `📋 Discovery Complete: [N] features | [W] warnings | [E] errors`. List per-feature with BOTH spec status AND implementation status. If ALL failed → stop, request path verification. If >50% missing → warn, ask to continue.

Store: features_map, parsing_errors

**Requirements:** 1.1, 1.2, 3.1

---

## Stage 3A: Structure Validation (Initial & Final)

**Objective:** Validate structure and completeness.

**Mode:** Initial and Final only (skip in Progress).

**Check File Presence:** Verify requirements.md, design.md, tasks.md exist for each feature. Report missing with expected paths, suggest templates.

**Validate Sections:**

- requirements.md: Introduction, Requirements, User Stories, Acceptance Criteria | Warning: Glossary
- design.md: Overview, Architecture/Components, Data Models | Warning: API section
- tasks.md: Task list heading, at least one checkbox task

**Validate Task Format:**

- Checkbox: Valid `- [ ]`, `- [-]`, `- [x]` | Invalid: `- []`, `- [X]`, `* [ ]`
- IDs: Single number or decimal | Invalid: missing, invalid chars
- Hierarchy: Consistent indentation, proper parent-child | Invalid: inconsistent, orphaned sub-tasks
- Requirement Refs: Valid formats, refs exist, >50% tasks have refs

**Report:** Use standard template. Summary: features passed, critical issues, warnings. Sections: File Presence, Section Validation, Task Format. Detailed mode: full paths, examples, templates. Summary mode: counts, critical only.

**Decision:** PASS (no critical) → Stage 4 | PASS with WARNINGS → recommend fixes, allow proceed | FAIL (critical) → block, require fixes.

Store: validation_results.structure

**Requirements:** 1.2, 1.3

---

## Stage 3B: Task State Analysis (Progress Mode)

**Objective:** Parse states, calculate progress, identify blockers.

**Mode:** Progress only (skip in Initial and Final).

**Parse States:** Extract checkbox states, count per feature. Track optional tasks separately. Validate: parent completed but sub-tasks incomplete → warning.

**Calculate Progress:**

- Per-feature: `(completed / total) * 100` (round to 1 decimal)
- Overall: `(total_completed / total_tasks) * 100`
- Status: not_started (0%), in_progress (1-99%), completed (100%), blocked (has blockers)
- Historical: If history exists, compare to previous, calculate velocity, project completion

**Identify Blockers:** Parse dependencies: explicit (`Depends on: 1.1`), implicit (sub-tasks, sequential IDs), cross-feature. For each incomplete task, check if dependencies completed. If not → blocked. Types: Critical (explicit, parent, cross-feature) | Warning (sequential, soft). Provide recommendations.

**Calculate Remaining Effort:**

- Task Count: `remaining * avg_duration` (default: 1 task = 1 day)
- Complexity: Sum effort from task details
- Velocity: `remaining / (completed / days_elapsed)` (if history)
- Provide range (optimistic, realistic, pessimistic) and confidence

**Report:** Use standard template. Summary: overall %, task counts, feature counts, estimated remaining. Feature Progress: per-feature breakdown with progress bars, task lists, blockers. Blockers Analysis: critical and warning blockers with recommendations. Insights: strong progress, concerns, recommendations. Detailed mode: all tasks, dependency graphs, historical charts. Summary mode: stats, blocked tasks, critical issues.

**Save History:** If enabled, save to `.kiro/specs/validation-history/progress-[timestamp].json` with: timestamp, mode, overall_percentage, features summary, blockers_count, estimated_remaining_days.

Store: validation_results.progress

**Requirements:** 2.1, 2.2, 2.3, 2.4

---

## Stage 4: Coverage Analysis (Initial & Final)

**Objective:** Verify requirements covered by tasks, identify gaps, calculate coverage.

**Mode:** Initial and Final only (skip in Progress).

**Build Requirement-Task Mapping:** Parse task details for requirement refs using patterns: `_Requirements: 1.1, 1.2_`, `_Requirement: 3.4_`, ranges. Build reverse mapping: requirement → tasks. Coverage status: Covered (completed task), At-Risk (incomplete tasks), Uncovered (no tasks).

**Identify Gaps:** Critical: Uncovered requirements, Invalid refs | Warning: At-risk requirements, Orphaned tasks | Info: Optional tasks without refs. For each gap: requirementId, description, gapType, severity, impact, recommendation.

**Calculate Coverage:**

- Per-feature: `(covered / total) * 100` (round to 1 decimal)
- Quality: totalRequirements, coveredRequirements, atRiskRequirements, uncoveredRequirements, taskReferencePercentage
- Quality Levels: Excellent (≥95%), Good (80-94%), Fair (60-79%), Poor (<60%)
- Overall: `(total_covered / total_requirements) * 100`

**Report:** Use standard template. Summary: coverage %, requirements breakdown, tasks breakdown, quality level. Feature Coverage: per-feature with progress bars, covered/at-risk/uncovered lists (detailed mode). Coverage Gaps: critical and warning gaps. Insights: strong coverage, concerns, recommendations. Detailed mode: full matrix with criteria text. Summary mode: stats, critical gaps only.

**Decision:** ≥80%: PASS → Stage 5 | 60-79%: PASS with WARNINGS → recommend fixes or proceed | <60%: FAIL → block, require fixes.

Store: validation_results.coverage

**Requirements:** 1.3, 5.1

---

## Stage 5: Dependency Validation (Initial & Final)

**Objective:** Extract dependencies, detect cycles, validate ordering.

**Mode:** Initial and Final only (skip in Progress).

**Extract Dependencies:**

- Feature-level: From feature-implementation/tasks.md, extract order and cross-feature deps. Build graph: `{ featureA: [featureB, featureC] }`
- Task-level: From tasks.md, extract explicit (`Depends on: 1.1`) and implicit (sub-tasks, sequential) deps. Build graph per feature: `{ taskId: [dependencyTaskIds] }`

**Detect Cycles:** Use DFS to detect cycles. If node in recursion_stack visited again → cycle. Trace back to identify all nodes. Report as ordered list: [A → B → C → A]. Suggest breaking points: implicit weaker than explicit, cross-feature candidates.

**Validate Ordering:** Check if feature/task order respects dependencies. If dependency comes later → ordering issue. Report violations with suggested reordering.

**Report:** Use standard template. Summary: cycles count, ordering issues count. Circular Dependencies: list cycles with paths, impact, resolution options. Ordering Validation: list issues with current/suggested order, impact. Dependency Graph Summary: feature and task dependencies (top 3 features). Detailed mode: complete graphs, step-by-step resolution. Summary mode: cycles and critical issues only.

**Decision:** No cycles: PASS → Stage 6 (Final) or complete (Initial) | Cycles: FAIL → block, require fixes | Ordering issues only: PASS with WARNINGS → recommend fixes, allow proceed.

Store: validation_results.dependencies

**Requirements:** 1.4, 6.1, 6.2

---

## Stage 6: Code Analysis (Final Mode Only)

**Objective:** Validate code matches design.

**Mode:** Final only.

**Identify Code Files:** Method 1: Git diff `git diff --name-only [base]` | Method 2: User input (comma-separated paths) | Method 3: File search (feature terms). Filter to feature-relevant, group by type.

**Parse Code Structure:** Extract: functions (name, params, return, exported), classes (name, methods, properties, exported), interfaces (name, fields, exported), endpoints (route, method, handler), models (schema, fields). Build map: `{ filePath, language, elements: [{ type, name, signature, exported, lineNumber }] }`.

**Match Components:** For each design component: Exact name match, Partial match, Type match, No match. Results: Found (file, line), Partial (multiple candidates), Missing (expected path).

**Validate APIs:** Check: endpoint exists, request schema, response schema, status codes. Results: Matches, Partial (schema diffs), Missing, Mismatch.

**Validate Data Models:** Check: model exists, required fields, field types, optional fields. Results: Complete, Missing Fields, Extra Fields (info), Type Mismatch.

**Report:** Use standard template. Summary: files analyzed, components/APIs/models counts. Code Files: list by type. Component Verification: found/partial/missing. API Verification: matching/partial/missing. Data Model Verification: complete/incomplete/missing. Detailed mode: all elements, signatures, field comparisons, examples. Summary mode: counts, critical issues.

Store: validation_results.code_analysis

**Requirements:** 3.2, 3.3, 3.4, 3.5

---

## Stage 7: Pattern Matching (Final Mode Only)

**Objective:** Use MCP Code Search to find similar implementations and compare patterns.

**Mode:** Final only.

**Query MCP:** For each major component: query `[component-name] implementation [language]`, limit 10 results, cache 1 hour. Handle: MCP unavailable → skip, report warning | Timeout (>30s) → use partial | No results → report, continue.

**Extract Patterns:** Analyze results for: Naming (camelCase, PascalCase, snake_case, kebab-case), Architecture (class-based, functional, DI, singleton), Structure (error handling, validation, logging, config). Count frequency.

**Compare Implementation:** For each pattern category: identify user's approach, compare to dominant pattern, calculate deviation. Severity: Critical (opposite), Warning (minority), Info (acceptable).

**Report:** Use standard template. Summary: searches count, patterns analyzed, overall alignment. Naming Conventions: functions/classes/files with user approach, pattern match, score. Architectural Patterns: error handling/validation/async with comparisons. Code Structure: logging/config with comparisons. Pattern Alignment Score: table with categories. Recommendations: critical/warnings/info with code examples. Detailed mode: all search results, code examples, refactoring guidance. Summary mode: deviations and recommendations only.

Store: validation_results.pattern_analysis

**Requirements:** 4.1, 4.2, 4.3, 4.4

---

## Stage 8: Traceability Matrix (Final Mode Only)

**Objective:** Build complete requirement-to-code traceability and identify gaps.

**Mode:** Final only.

**Build Matrix:** For each requirement, trace: Requirement → Design Components → Tasks → Code Files. Structure: `{ requirementId, requirementText, traceability: { design: [{ componentName, found }], tasks: [{ taskId, state, found }], code: [{ filePath, elements, found }] }, status, completeness }`. Status: Complete (has all 3, 100%), Partial (missing 1, 33-66%), Missing (missing 2+, 0-33%).

**Validate Completeness:** Check: design coverage, task coverage, code coverage, state consistency. Completeness: `(elements_present / 3) * 100`.

**Identify Gaps:** Design Gap (not in design.md) → Critical | Planning Gap (no tasks) → Critical | Implementation Gap (completed tasks, no code) → Critical | Traceability Gap (code not linked) → Warning. For each: requirementId, gapType, severity, description, impact, remediation.

**Report:** Use standard template. Summary: overall traceability %, complete/partial/missing counts, gaps counts. Traceability Matrix: per-requirement with status, completeness, design/tasks/code details. Traceability Gaps: critical and warning gaps with remediation. Insights: strong traceability, concerns, recommendations. Detailed mode: full chains, all files, detailed remediation, table format. Summary mode: stats, gaps, high-level guidance.

Store: validation_results.traceability

**Requirements:** 5.1, 5.2, 5.3, 5.4

---

## Final Report Generation

After completing mode-specific stages, generate consolidated report using standard template with:

**Executive Summary:** Overall status, mode-specific metrics, critical/errors/warnings counts.

**Validation Results:** Include completed stages based on mode (Initial: 3A, 4, 5 | Progress: 3B | Final: 3A, 4, 5, 6, 7, 8).

**Consolidated Recommendations:** Critical actions, warnings, quality improvements with specific references.

**Next Steps:** Mode-specific guidance (Initial: fix issues, begin implementation | Progress: unblock, continue, re-run | Final: fix gaps, proceed to release).

**History:** If enabled, note saved location.

**Requirements:** 7.1, 7.2, 7.3, 7.4, 7.5

---

## Quality Gate

**CRITICAL (must fix):**

- Final mode: code files don't exist for completed tasks
- Final mode: acceptance criteria not verifiable in the codebase
- Progress mode: blocked tasks have no documented blocker or owner

**IMPORTANT (should fix):**

- Initial mode: tasks missing acceptance criteria
- Progress mode: velocity indicates timeline risk with no mitigation plan
- Final mode: test coverage gaps for completed features

**SUGGESTION:**

- Could add traceability matrix linking tasks to user stories
- Could flag tasks at risk based on remaining time vs effort

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]" — unless `scope_confirmed` is true, in which case report all the findings and leave fixing to the caller, without asking.
