---
status: draft
execution: subagent-driven
---

# <Feature name>: implementation plan

**Goal:** <one sentence on what this builds>

**Architecture:** <two or three sentences on the approach>

**Tech stack:** <key technologies and libraries>

**Spec:** <path to the design spec this plan implements>

## Global constraints

<The spec's project-wide requirements, one per line, with exact values copied verbatim.>

## Review focus

<Up to five inputs or failure modes the spec implies but no test exercises, each with the behavior
a reasonable person would expect, most likely first. Each one has its test in the owning task.>

## File map

- `<path>`: <its one responsibility>

---

### Task 1: <component name>

**Files:**

- Create: `<exact/path/to/file>`
- Modify: `<exact/path/to/existing>:<lines>`
- Test: `<exact/path/to/test>`

**Interfaces:**

- Consumes: <exact signatures from earlier tasks, or "nothing">
- Produces: <exact names, parameters and return types later tasks rely on>

- [ ] **Step 1: Write the failing test** `<test name>`, asserting <the spec's exact values>.
- [ ] **Step 2: Run it and watch it fail.** Run: `<command>`. Expected: FAIL with "<message>".
- [ ] **Step 3: Implement `<signature>` in `<file>`.** <One line on the approach, only when the
  signature and the test leave a choice.>
- [ ] **Step 4: Run it and watch it pass.** Run: `<command>`. Expected: PASS.
- [ ] **Step 5: Commit.** `git add <files> && git commit -m "<message>"`
