---
name: verification
description: 'Use whenever a task producing a testable outcome (code, build artifacts, generated documents, or infrastructure changes) is about to be declared complete. MUST USE before presenting any such result: run the TDD workflow and show evidence it works, integrated with the maker-checker pattern.'
version: 1.0.0
tags: [skill, behavioral, verification, tdd, evidence, quality]
---

# Verification

## Overview

Evidence collection protocol that ensures no task is declared complete without proof it works. Applies to code changes, artifact generation, and manual testing.

## Usage

This skill is always active. It applies whenever an agent completes a task that produces a testable outcome: code, build artifacts, generated documents, or infrastructure changes. No explicit activation needed.

## TDD Workflow

Follow these phases in order. Do not skip phases.

1. **SPEC**: Define success criteria before implementation. What must be true when done?
2. **RED**: Write a failing test. Run it. Confirm it FAILS. Show the output.
3. **GREEN**: Write minimal code to make the test pass. Run it. Confirm it PASSES. Show the output.
4. **REFACTOR**: Clean up code. Run tests again. Confirm they stay GREEN. Show the output.
5. **VERIFY**: Run the full test suite. Confirm all tests pass. Show the output.

   ```bash
   # Node.js / TypeScript
   npm run build && npm test

   # Rust
   cargo build && cargo test

   # Python
   pytest

   # Java / Kotlin
   ./gradlew build test
   ```

6. **EVIDENCE**: Present the output proving it works.

## Evidence Requirements

| Phase    | Action             | Required Evidence                       |
| -------- | ------------------ | --------------------------------------- |
| Build    | Run build command  | Exit code 0, no errors in output        |
| Test     | Execute test suite | All tests pass (full output shown)      |
| Artifact | Generate document  | Corresponding checker skill passes      |
| Manual   | Test the feature   | Describe exactly what was observed      |

### Evidence Format

```
## Evidence
- **Command:** `npm test`
- **Exit code:** 0
- **Output:** [paste relevant output]
- **Result:** PASS / FAIL
```

## Maker-Checker Integration

After generating any artifact (design doc, implementation guide, specification):

1. Run the corresponding checker skill automatically
2. Checker must pass (see the pass condition below) before presenting to user
3. If checker finds CRITICAL issues, fix them, re-run checker, then present
4. Include the checker's result (its score, or its finding counts per severity) in evidence

### Checker for each artifact

Use the checker that matches what you produced. Load its skill and apply its criteria.

| You produced                              | Checker                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Backend code change                       | `backend-review`                                                                                        |
| Frontend code change                      | `frontend-review`                                                                                       |
| Infrastructure as code change             | `infra-validation`                                                                                      |
| System design or architecture document    | `design-doc-guidelines`                                                                                 |
| Threat model                              | `threat-modeling` quality criteria                                                                      |
| Technical research or decision evidence   | `decision-research`, to verify claims and surface prior art                                             |
| User stories                              | `user-story-writing` criteria (INVEST, complete acceptance criteria), then `decision-research` on claims |
| Any other document produced by a skill    | That skill's own quality criteria                                                                       |

A change to a design-bearing artifact needs `design-impact-review` before you make it, not after.
Design-bearing means a requirement or user story, a system design decision, an API contract, a data
model or schema, or a user experience flow: anything other artifacts depend on. The same applies to
a change that deviates from an existing design document. Surface every BREAKING impact the review
finds before proceeding.

Present checker findings in the order CRITICAL, IMPORTANT, SUGGESTION. Most checkers report
severity-ranked findings rather than a score: for those, the artifact passes when no CRITICAL
finding remains, and the evidence is the finding counts per severity. A checker that defines its
own pass condition or score uses that instead. Then ask the user "Fix these issues? [y/n]", unless
the checker's own instructions say the user already confirmed scope or the run is unattended (for
example `backend-review` with `scope_confirmed`); in that case report the findings without asking
and leave fixing to the caller, as the checker says.

## Anti-Patterns

These are NOT verification:

- "I believe this works" is not evidence. Run it.
- "The code looks correct" is not evidence. Compile it.
- "Tests should pass" is not evidence. Execute them and show output.
- Skipping verification because "it's a small change". All changes need evidence.
- Deleting failing tests instead of fixing code. Fix the code, never delete the test.
- Presenting an artifact without running the checker. Always run maker-checker first.

## Self-Validation Checklist

Before reporting any finding or declaring a task done, verify:

- [ ] I searched the codebase to confirm this issue exists
- [ ] I have exact file paths and line numbers
- [ ] I verified this isn't already handled elsewhere
- [ ] I read the actual implementation, not assumed patterns
- [ ] I traced types through the code path (not assumed)

If you cannot check all boxes: do more investigation before reporting.

## False Positive Patterns

These patterns produce wrong conclusions:

| Pattern                       | Problem                               | Fix                                          |
| ----------------------------- | ------------------------------------- | -------------------------------------------- |
| "This looks like standard X"  | Assumed behavior without reading code | Read the actual implementation               |
| "Builders typically return Y" | Assumed types without tracing         | Check the factory method                     |
| "This will fail at runtime"   | Assumed without type tracing          | Trace the actual types                       |
| "This assertion is weak"      | Assumed without checking test data    | Verify test data would cause false positives |

**Key principle:** Read implementations, don't assume patterns. Every codebase has variations.

## Quality Gate

**CRITICAL (immediate stop):**

- Task declared complete with no evidence provided
- Test output not shown when tests were claimed to pass
- Failing tests deleted or skipped instead of code being fixed
- Artifact presented to user without checker validation

**IMPORTANT (must fix before proceeding):**

- Evidence provided but incomplete (e.g., exit code shown but output omitted)
- TDD phase skipped (e.g., jumped from SPEC to GREEN without RED)
- Manual test described vaguely ("it works") instead of specific observations

**SUGGESTION:**

- Could include before/after comparison in evidence
- Could add timing information for performance-sensitive changes
- Could capture screenshots for UI changes
