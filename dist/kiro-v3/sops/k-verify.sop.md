# Verify

## Overview

This SOP runs comprehensive verification to ensure task completion with collected evidence. Use it after completing implementation, before declaring any task done, when the user requests verification, or after bug fixes to confirm resolution.

> **Execution context:** Steps below run shell commands. An agent without those tools delegates them to specialist agents per its routing rules.
> **Command selection:** Prefer the project's wrapper or lockfile-indicated tool for every step below — `./gradlew` over `gradle` when `gradlew` exists, `pnpm`/`yarn` over `npm` when `pnpm-lock.yaml`/`yarn.lock` exists.

## Parameters

- **source_dir** (required): Path to the source directory to verify
- **success_criteria** (optional): Specific criteria to verify against (from the plan SOP)
- **build_system** (optional, default: auto-detect): Build system to use — `npm`, `cargo`, `go`, `python`, `gradle`, `maven`

**Constraints for parameter acquisition:**

- If all required parameters are already provided, You MUST proceed to the Steps
- If any required parameters are missing, You MUST ask for them before proceeding

## Steps

### 1. Pre-Check

Verify prerequisites are met before running verification.

**Constraints:**

- You MUST confirm all of the following:
  - Success criteria are defined (either from the `success_criteria` parameter or from this task's success criteria in a prior plan, e.g. `k-plan.sop.md` Step 1)
  - All `// TODO` / `# TODO` (or language-equivalent) comments introduced during this implementation are resolved or explicitly deferred with a tracked follow-up
- If success criteria are not defined, You MUST ask the user to define them or extract them from the task context
- You MUST NOT proceed to build if prerequisites are not met

**Expected Output:** A pre-check checklist:

- [ ] Success criteria defined?
- [ ] All TODOs resolved or explicitly deferred with a tracked follow-up?

### 2. Run Build

Execute the project build to verify compilation succeeds.

**Constraints:**

- You MUST auto-detect the build system from project files if `build_system` is not provided:
  - `package.json` → `npm run build`
  - `Cargo.toml` → `cargo build`
  - `go.mod` → `go build ./...`
  - `pyproject.toml` or `setup.py` → `python -m build`
  - `build.gradle.kts` or `build.gradle` → `gradle build`
  - `pom.xml` → `mvn compile`
- You MUST capture the exit code and relevant output
- If `source_dir` contains multiple packages (multiple manifest files, e.g. several `package.json`/`Cargo.toml`/`build.gradle`), You MUST run the build command for each package and capture exit code/status per package
- You MUST NOT proceed to tests if the build fails; fix build errors first. For multiple packages, this applies if ANY package's build fails

**Expected Output:** Build result with command, exit code, and status (✓ or ✗) per package (if multiple) plus an aggregate status

### 3. Run Tests

Execute the project test suite.

**Constraints:**

- You MUST use the appropriate test command:
  - npm: `npm test`
  - Cargo: `cargo test`
  - Go: `go test ./...`
  - Python: `pytest`
  - Gradle: `gradle test`
  - Maven: `mvn test`
- You MUST capture pass/fail counts
- You MUST NOT proceed if tests fail — fix test failures first
- If a separate integration test command or CI job exists, You MUST run those too
- If `source_dir` contains multiple packages (multiple manifest files, e.g. several `package.json`/`Cargo.toml`/`build.gradle`) or a single package defines multiple distinct test suites, You MUST run the test command for each package/suite and report pass/fail counts per package/suite, then an aggregate total

**Expected Output:** Test result with command, pass count, fail count, and status (✓ or ✗) per package/suite (if multiple) plus an aggregate total

### 4. Run Lint

Execute linting/style checks if available.

**Constraints:**

- If linting is available for the project (a lint config or tool is present), You MUST use the appropriate lint command:
  - npm: `npm run lint`
  - Cargo: `cargo clippy`
  - Go: `golangci-lint run`
  - Python: `ruff check .`
  - Gradle: `gradle checkstyleMain` (or project-configured lint plugin, e.g. Spotless, Detekt)
  - Maven: `mvn checkstyle:check` (or project-configured lint plugin)
- You MUST capture error and warning counts
- Lint warnings are acceptable; lint errors MUST be fixed before proceeding
- For Gradle/Maven, You MUST inspect the build configuration for a configured lint plugin before choosing the command — Java/Kotlin linting is project-specific

**Expected Output:** Lint result with command, error count, warning count, and status (✓ or ✗)

### 5. CDK Verification (if applicable)

For CDK/infrastructure packages, run additional CDK-specific checks.

**Constraints:**

- You MUST only run this step if the project contains CDK infrastructure code
- You MUST run these commands in order:
  1. `cdk ls` — list all stacks
  2. `cdk diff` — diff infrastructure changes
  3. `cdk synth` — synthesize CloudFormation templates
- You MUST capture output from each command
- You MUST flag any unexpected stack changes

**Expected Output:** CDK verification results with command outputs and status per check

### 6. Manual Verification

Test the actual task's change (feature slice or fix) to confirm it works as intended.

**Constraints:**

- You MUST describe what was tested, the steps taken, and what was observed
- You MUST verify against the success criteria from Step 1
- You MUST NOT skip this step — automated tests alone are insufficient
- You MUST NOT declare success if observed behavior does not match expected behavior

**Expected Output:** Manual verification report:

```markdown
## Manual Verification

### What I Tested

[Feature/flow description]

### Steps Taken

1. [Step 1]
2. [Step 2]

### What I Observed

[Actual behavior]

### Status

[✓ Working as expected / ✗ Issue found: description]
```

### 7. Collect Evidence

Document all verification results into a single evidence report.

**Constraints:**

- You MUST include results from every prior step: Build, Tests, Lint, CDK (if applicable), Manual Verification
- Each section MUST include: command run, exit code or result, relevant output, and status (✓ or ✗)
- You MUST include a final verification checklist:
  - All success criteria met?
  - Build passes?
  - Tests pass?
  - Lint passes? (report as Skipped, not Failed, when no lint config or tool is present for the project, per Step 4)
  - Manual verification complete?
  - No regressions?
  - Documentation updated (if applicable)?
- You MUST NOT declare the task complete if any checklist item fails; a Skipped item does not count as a failure

**Expected Output:** A complete verification evidence report:

```markdown
## Verification Evidence

### Build

- Command: `[command]`
- Exit code: [0 or error]
- Status: [✓ or ✗]

### Tests

- Command: `[command]`
- Passed: [count]
- Failed: [count]
- Status: [✓ or ✗]

### Lint

- Command: `[command, or "N/A" if no linter is configured]`
- Errors: [count]
- Warnings: [count]
- Status: [✓ / ✗ / Skipped]

### Manual Verification

- Tested: [what]
- Observed: [behavior]
- Status: [✓ or ✗]

### Final Checklist

- [ ] All success criteria met
- [ ] Build passes
- [ ] Tests pass
- [ ] Lint passes
- [ ] Manual verification complete
- [ ] No regressions
- [ ] Documentation updated

### Final Status

[All criteria met. Task complete. / Failures found — see above.]
```
