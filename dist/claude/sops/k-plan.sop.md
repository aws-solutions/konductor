# Plan

## Overview

This SOP creates detailed work breakdowns with success criteria, task dependencies, agent assignments, and timeline estimates. Use it for multi-step tasks requiring coordination, complex features needing a structured approach, before starting any non-trivial implementation, or when scope needs clarification.

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
- You MUST make every criterion specific and testable — no vague statements like "works well"
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

- Every task MUST be specific and actionable — no vague tasks like "set up stuff"
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

### 4. Assign to Agents

Match each task to the most appropriate specialized agent.

**Constraints:**

- You MUST use this agent assignment guide:

| Task Type               | Agent                                   | Reason                                           |
| ----------------------- | --------------------------------------- | ------------------------------------------------ |
| Search codebase         | k-researcher                            | Codebase navigation                              |
| Find documentation      | k-researcher                            | External research                                |
| Implement feature       | k-developer                             | Code implementation                              |
| Write tests             | k-developer                             | Test development                                 |
| Update docs             | k-developer                             | Documentation                                    |
| Review architecture     | k-architect                             | Complex design decisions                         |
| Browser automation      | k-browser                               | E2E testing, screenshots                         |
| Operational tasks       | k-developer                             | Deployment, infra validation                     |
| Pre-planning analysis   | konductor (pre-planning-analysis skill) | Ambiguity detection, intent classification       |
| Plan/approach review    | k-tpm                                   | Plan review via plan-review skill                |
| Agentic effort estimate | k-tpm                                   | Estimation via legacy-to-agentic-estimate skill  |
| Architecture decisions  | k-architect                             | Trade-off analysis via trade-off-evaluator skill |
| Media file analysis     | k-media-analyzer                        | PDF/image/diagram interpretation                 |

- You MUST NOT assign tasks to agents outside their specialization
- You MUST group related tasks for the same agent where possible to reduce context switching

**Expected Output:** A task-to-agent assignment table:

| Task                         | Agent        | Reason              |
| ---------------------------- | ------------ | ------------------- |
| Search codebase for patterns | k-researcher | Codebase navigation |
| Implement feature            | k-developer  | Code implementation |
| Write documentation          | k-developer  | Documentation       |

### 5. Estimate Timeline

Calculate effort per phase into an authoritative baseline, then project an informational agentic band alongside it.

**Constraints:**

- You MUST group tasks into phases (Research, Implementation, Testing, Documentation)
- You MUST account for parallel execution where dependencies allow when deriving the calendar timeline — this nets out overlapping wait time across parallel tracks; it does not change the effort sum computed below
- You MUST sum per-phase effort into a serial total
- You MUST apply buffer: 20% for well-understood work (the floor, applied to all work — there is no zero-buffer tier), 40% for novel, complex, unfamiliar, or otherwise uncertain work; this buffer hedges the uncertainty of the estimate itself; it is a different risk than the `legacy-to-agentic-estimate` skill's verification tax (`τ`, the cost of reviewing AI output), so the buffer applies independently of that skill and is never replaced by it
- You MUST report the buffered total as **Total Estimated Effort (baseline)** — this is the authoritative estimate
- You SHOULD then delegate the Agentic Projection to `k-tpm`, which owns the `legacy-to-agentic-estimate` skill and can run its bundled `convert_estimates.py` through a shell across the full prepare → classify → finalize seam. This is the preferred path — it keeps a stateful, script-verified seam inside the agent that owns it
- Your delegation MUST pass each task individually with its own description (not the aggregate serial total) — one lumped total collapses every task onto a single leverage tier and hides per-task variation. The skill infers each task's tier from its description, so the descriptions are the input that matters
- If you cannot delegate — `k-tpm` is not reachable, not present in this agent package, or reports it has no shell to run the script — you MAY compute the projection yourself rather than skipping outright: apply the `legacy-to-agentic-estimate` skill's documented method directly (its SKILL.md, not the script). Infer each task's tier from its description with the same keyword-then-judgment approach the skill uses, apply the matching tier preset (`v`/`L`/`τ`/`C`), and compute `E_agentic = E_legacy × [(1 − v) + v × (1 − L_eff)] × (1 + τ)` where `L_eff = L × C`, per task. Follow the documented tiers and formula exactly, per task — this is the skill's own method run without the script, not an ad hoc substitute — and state that the run was not script-verified
- If even that isn't possible — you cannot infer a defensible tier for a task, or have no way to apply the formula — skip the Agentic Projection for that item, state in one line that it was skipped and why, and report the baseline alone. The baseline above is authoritative and complete without the projection either way, and a skip is not a failure of this SOP
- You MUST present whatever you produce — delegated, self-computed, or a per-item skip — as an **Agentic Projection**, including tier, tier source (kw/llm/self-computed), confidence, low/mid/high, and Δ per item, plus roll-up totals
- You MUST present the full low–high band as returned or computed, not just the mid point, and MUST NOT narrow or collapse it — when the script produces the figures, they resolve to a six-minute (0.1h) precision only as an artifact of internal rounding; either way, treat differences finer than about 15 minutes as noise from the uncalibrated presets, not signal
- You MUST carry the caveat that the tier presets are uncalibrated defaults pending team telemetry
- You MUST NOT present the Agentic Projection as the authoritative or committed estimate

**Expected Output:** A timeline table, the buffered baseline, and the agentic projection:

```markdown
## Timeline Estimate

| Phase          | Tasks   | Effort | Agent(s)     |
| -------------- | ------- | ------ | ------------ |
| Research       | 1, 2    | 2h     | k-researcher |
| Implementation | 3, 4, 5 | 4h     | k-developer  |
| Testing        | 6, 7    | 1h     | k-developer  |
| Documentation  | 8       | 30m    | k-developer  |

**Serial Effort Sum**: 7.5h

**Estimation-Uncertainty Buffer** (complex/unfamiliar work, 40%): +3.0h

**Total Estimated Effort (baseline)**: 10.5h

### Agentic Projection (uncalibrated presets — recalibrate from actuals)

| Item                                              | Legacy   | Tier      | Tier source        | Low     | Mid     | High    | Δ (mid)  |
| ------------------------------------------------- | -------- | --------- | ------------------ | ------- | ------- | ------- | -------- |
| 1. Search codebase for existing patterns          | 1h       | 🟢 high   | inferred·llm (60%) | 0.4     | 0.6     | 0.7     | -40%     |
| 2. Find relevant documentation                    | 1h       | 🟢 high   | inferred·llm (65%) | 0.4     | 0.6     | 0.7     | -40%     |
| 3. Implement CRUD endpoints for settings API      | 2h       | 🟢 high   | inferred·kw (82%)  | 0.9     | 1.2     | 1.4     | -40%     |
| 4. Wire up integration with upstream service      | 1h       | 🟡 medium | inferred·kw (100%) | 0.9     | 0.9     | 1.0     | -10%     |
| 5. Add input validation and error handling        | 1h       | 🟡 medium | inferred·llm (60%) | 0.8     | 0.9     | 1.0     | -10%     |
| 6. Write unit tests for new endpoints             | 0.5h     | 🟢 high   | inferred·kw (88%)  | 0.2     | 0.3     | 0.3     | -40%     |
| 7. Run verification protocol and collect evidence | 0.5h     | 🔴 low    | inferred·llm (55%) | 0.5     | 0.6     | 0.6     | +20%     |
| 8. Update README and add code comments            | 0.5h     | 🟢 high   | inferred·llm (70%) | 0.2     | 0.3     | 0.4     | -40%     |
| **Total**                                         | **7.5h** |           |                    | **4.3** | **5.4** | **6.1** | **-28%** |

Tier presets (`v`/`L`/`τ`/`C`) are uncalibrated defaults pending team telemetry, and the figures above are shown at the skill's native 0.1h resolution — sub-15-minute differences are rounding artifacts, not meaningful precision. This projection is informational context, not the committed estimate. Use the baseline above for commitments.
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

- [ ] k-researcher: Search codebase for patterns
- [ ] k-researcher: Find relevant documentation

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
