# Plan

## Overview

This SOP creates detailed work breakdowns with success criteria, task dependencies, required skills and capabilities, and timeline estimates. Use it for multi-step tasks requiring coordination, complex features needing a structured approach, before starting any non-trivial implementation, or when scope needs clarification.

## Parameters

- **objective** (required): The goal or feature to plan
- **scope** (optional): Boundaries of the work (e.g., specific directories, services, or components)
- **constraints** (optional): Known constraints such as deadlines, technology restrictions, or team availability

**Constraints for parameter acquisition:**

- If all required parameters are already provided, You MUST proceed to the Steps
- If any required parameters are missing, You MUST ask for them before proceeding

## Steps

### 1. Define Success Criteria

Establish measurable criteria that determine when the objective is complete.

**Constraints:**

- You MUST define criteria in three categories: Functional (specific behaviors that must work), Observable (what can be measured or seen), and Pass/Fail (binary yes/no criteria)
- You MUST make every criterion specific and testable. No vague statements like "works well"
- You MUST NOT proceed to task breakdown without defined success criteria

**Expected Output:** A structured success criteria document:

```json
{
  "functional": [
    "Specific behavior that must work",
    "Another required behavior"
  ],
  "observable": ["What can be measured/seen", "Output that confirms success"],
  "pass_fail": ["Binary criterion 1 (yes/no)", "Binary criterion 2 (yes/no)"]
}
```

### 2. Break Down Tasks

Decompose the objective into specific, actionable tasks with effort estimates and priority levels.

**Constraints:**

- Every task MUST be specific and actionable. No vague tasks like "set up stuff"
- Every task MUST include an effort estimate
- Tasks MUST be categorized as High, Medium, or Low priority
- You MUST NOT create tasks that combine multiple unrelated actions

**Expected Output:** A prioritized task list:

```markdown
## TODOs

### High Priority

- [ ] Task 1 (effort: 1h) - [specific action]
- [ ] Task 2 (effort: 2h) - [specific action]

### Medium Priority

- [ ] Task 3 (effort: 30m) - [specific action]

### Low Priority

- [ ] Task 4 (effort: 15m) - [specific action]
```

### 3. Map Dependencies

Identify which tasks depend on others and which can run in parallel.

**Constraints:**

- You MUST identify all blocking dependencies between tasks
- You MUST identify tasks that can run in parallel
- You MUST NOT create circular dependencies
- You MUST flag any external dependencies (e.g., waiting on another team, infrastructure provisioning)

**Expected Output:** A dependency map showing task relationships:

```markdown
## Task Dependencies

Task 1 (independent)
↓
Task 2 (depends on Task 1)
↓
Task 3 (depends on Task 2)

Task 4 (independent, can run parallel with Task 1-3)
```

### 4. Identify Skills and Capabilities

Match each task to the skills and capabilities needed to perform it.

**Constraints:**

- You MUST identify the required skill or capability for every task
- You MUST keep every referenced skill available to the task that needs it
- You MUST group related tasks that use the same skill or capability where possible to reduce context switching

**Expected Output:** A task-to-capability table:

| Task                         | Skill / capability                 | Reason                    |
| ---------------------------- | ---------------------------------- | ------------------------- |
| Search codebase for patterns | Codebase research                  | Codebase navigation       |
| Implement feature            | Code implementation                | Implement and validate    |
| Write documentation          | Documentation authoring             | Explain user-facing change |
| Review plan                  | `plan-review`                       | Independent plan critique |
| Evaluate architecture        | `trade-off-evaluator`               | Structured trade-off analysis |
| Analyze media files          | Media analysis                      | Interpret PDFs and diagrams |

### 5. Estimate Timeline

Calculate effort per phase into an authoritative baseline.

**Constraints:**

- You MUST group tasks into phases (Research, Implementation, Testing, Documentation)
- You MUST include a Review/Rework phase in the serial sum whenever the plan's execution phase (Step 6) includes a review or adversarial loop
- You MUST account for parallel execution where dependencies allow when deriving the calendar timeline. This nets out overlapping wait time across parallel tracks; it does not change the effort sum computed below
- You MUST sum per-phase effort into a serial total
- You MUST apply buffer: 20% for well-understood work (the floor, applied to all work since there is no zero-buffer tier), 40% for novel, complex, unfamiliar, or otherwise uncertain work; this buffer hedges the uncertainty of the estimate itself
- You MUST report the buffered total as **Total Estimated Effort (baseline)**. This is the authoritative estimate

**Expected Output:** A timeline table and the buffered baseline:

```markdown
## Timeline Estimate

| Phase          | Tasks   | Effort | Skill / capability       |
| -------------- | ------- | ------ | ------------------------ |
| Research       | 1, 2    | 2h     | Codebase research        |
| Implementation | 3, 4, 5 | 4h     | Code implementation      |
| Testing        | 6, 7    | 1h     | Test development         |
| Documentation  | 8       | 30m    | Documentation authoring  |
| Review/Rework  | —       | 30m    | Independent review       |

**Serial Effort Sum**: 8h

**Estimation-Uncertainty Buffer** (complex/unfamiliar work, 40%): +3.2h

**Total Estimated Effort (baseline)**: 11.2h

```

### 6. Create Execution Plan

Assemble the final execution plan with phased ordering.

**Constraints:**

- You MUST order phases respecting dependencies from Step 3
- You MUST mark parallel tasks explicitly
- You MUST include a Verification phase using the verify SOP
- You MUST include a Documentation phase if any user-facing changes are made
- You MUST mark tasks complete IMMEDIATELY after finishing them during execution

**Expected Output:** A complete execution plan:

```markdown
## Execution Plan

### Phase 1: Research (Parallel)

- [ ] Search codebase for patterns using codebase research
- [ ] Find relevant documentation using documentation research

### Phase 2: Implementation (Sequential)

- [ ] Task 3: [action]
- [ ] Task 4: [action]
- [ ] Task 5: [action]

### Phase 3: Verification

- [ ] Write tests
- [ ] Run verification protocol (verify SOP)
- [ ] Collect evidence

### Phase 4: Documentation

- [ ] Update README
- [ ] Add code comments
```

### Task Format Rules

- Every task must be specific and actionable
- Include effort estimates
- Mark complete IMMEDIATELY after finishing
- Verify ALL requirements met before declaring done
