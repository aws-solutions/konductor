# Delegate

## Overview

This SOP provides a structured template for delegating tasks to specialized subagents with clear requirements and success criteria. Use it when assigning work to `k-researcher`, `k-developer`, `k-media-analyzer`, or other subagents, when orchestrating parallel agent execution, or when any task requires specialized agent capabilities.

## Parameters

- **task_description** (required): The specific task to delegate
- **target_agent** (required): The subagent to delegate to (e.g., `k-researcher`, `k-developer`, `k-media-analyzer`, `k-browser`)
- **context_paths** (optional): Relevant file paths, directories, or URLs for the task
- **language** (optional, default: auto-detect from project): Primary language of the project

**Constraints for parameter acquisition:**

- If all required parameters are already provided, You MUST proceed to the Steps
- If any required parameters are missing, You MUST ask for them before proceeding

### Language Reference

When adapting examples to any project:

1. Identify the project's primary language from file extensions
2. Substitute with language-appropriate values from this table
3. All SOP examples below use TypeScript — always adapt using this table

| Concept         | Go          | Java        | Kotlin           | Python                   | Swift           | TypeScript    |
| --------------- | ----------- | ----------- | ---------------- | ------------------------ | --------------- | ------------- |
| Source files    | .go         | .java       | .kt              | .py                      | .swift          | .ts, .tsx     |
| Test files      | \*\_test.go | \*Test.java | \*Test.kt        | test\_\*.py, \*\_test.py | \*Tests.swift   | \*.test.ts    |
| HTTP client     | net/http    | OkHttp      | OkHttp/Ktor      | requests                 | URLSession      | axios         |
| Dependency dir  | vendor      | .m2         | .gradle          | venv, .venv              | .build, Pods    | node_modules  |
| Package manager | go mod      | mvn/gradle  | gradle           | pip/poetry               | spm/cocoapods   | npm/yarn      |
| Config file     | go.mod      | pom.xml     | build.gradle.kts | pyproject.toml           | Package.swift   | tsconfig.json |
| Build           | go build    | mvn compile | gradle build     | python -m build          | xcodebuild      | npm run build |
| Test            | go test     | mvn test    | gradle test      | pytest                   | xcodebuild test | npm test      |

## Steps

### 1. Define the TASK

Write an atomic, specific goal — one action per delegation.

**Constraints:**

- You MUST define exactly one specific action per delegation
- You MUST NOT combine multiple unrelated actions into a single delegation
- You MUST make the task self-contained so the subagent can execute without further clarification

**Expected Output:** A single TASK statement, e.g.: "Find all source files that import an HTTP client library and list their usage patterns."

### 2. Define the EXPECTED OUTCOME

Specify concrete deliverables with success criteria.

**Constraints:**

- You MUST list specific, measurable deliverables
- You MUST include at least one success criterion that can be verified
- You MUST NOT leave outcomes vague or open-ended

**Expected Output:** A bulleted list of deliverables, e.g.:

- List of file paths where HTTP clients are imported
- For each file: line numbers of imports
- Summary of how the HTTP client is used (GET/POST/etc.)
- Count of total usages

### 3. Define REQUIRED SKILLS and TOOLS

Specify the expertise needed and the explicit tool allowlist.

**Constraints:**

- You MUST list relevant skills the subagent needs
- You MUST provide an explicit tool allowlist — this prevents tool sprawl
- You MUST NOT allow tools that are unnecessary for the task

**Expected Output:** Two lists:

- Required Skills (e.g., codebase navigation, pattern matching)
- Required Tools (e.g., shell, read, web_search)

### 4. Define MUST DO Requirements

Write exhaustive requirements — leave NOTHING implicit.

**Constraints:**

- You MUST enumerate every requirement the subagent must follow
- You MUST include scope boundaries (e.g., "search recursively from project root")
- You MUST include output format requirements (e.g., "include line numbers")
- You MUST NOT assume the subagent will infer unstated requirements

**Expected Output:** A bulleted list of explicit requirements, e.g.:

- Search recursively from project root
- Include line numbers in output
- Check all source files matching the project's language
- Include test files in search
- Report total count of matches

### 5. Define MUST NOT DO Prohibitions

Specify forbidden actions — anticipate and block rogue behavior.

**Constraints:**

- You MUST include prohibitions against modifying files (unless the task requires it)
- You MUST include prohibitions against executing application code (unless the task requires it)
- You MUST include a response size limit (e.g., "Do not return responses exceeding ~100 lines")
- You MUST NOT leave any dangerous action unblocked

**Expected Output:** A bulleted list of prohibitions, e.g.:

- Do not modify any files
- Do not execute any application code
- Do not make assumptions about file locations
- Do not return raw file contents or complete source code — summarize with file paths and key snippets
- Do not return responses exceeding ~100 lines

### 6. Provide CONTEXT

Include file paths, existing patterns, and constraints.

**Constraints:**

- You MUST include the project root path
- You MUST include relevant source directories and file locations
- You MUST include directories to ignore (build artifacts, dependency directories)
- You MUST include any existing patterns the subagent should follow

**Expected Output:** A bulleted list of context items, e.g.:

- Project root: /workspace/my-project
- Primary source code: src/ directory
- Ignore: build artifacts, dependency directories (node_modules/, vendor/, target/, venv/, .m2/)
- Existing pattern: HTTP client instance in src/lib/api.\*

### 7. Assemble and Send Delegation

Combine all sections into the 7-section delegation prompt and send to the target agent.

**Constraints:**

- You MUST use this exact structure:

```markdown
## Delegation to [TARGET_AGENT]

### 1. TASK

[From Step 1]

### 2. EXPECTED OUTCOME

[From Step 2]

### 3. REQUIRED SKILLS

[From Step 3 - skills]

### 4. REQUIRED TOOLS

[From Step 3 - tools]

### 5. MUST DO

[From Step 4]

### 6. MUST NOT DO

[From Step 5]

### 7. CONTEXT

[From Step 6]
```

- You MUST replace `[TARGET_AGENT]` with the actual `target_agent` parameter value
- You MUST NOT omit any of the 7 sections

**Expected Output:** A complete 7-section delegation prompt ready to send to the subagent

### 8. Verify Delegation Results

After receiving subagent results, verify completeness.

**Constraints:**

- You MUST check every item in this verification checklist:
  - Did agent complete the TASK?
  - Did agent provide EXPECTED OUTCOME?
  - Did agent use only REQUIRED TOOLS?
  - Did agent follow MUST DO requirements?
  - Did agent avoid MUST NOT DO prohibitions?
  - Are results usable for next steps?
- You MUST re-delegate if any check fails (max 2 fix cycles)

**Expected Output:** Completed verification checklist with pass/fail per item, and either confirmation of success or a re-delegation prompt

### Agent-Specific Examples

**k-researcher (codebase search):**

- TASK: Find all implementations of the UserService interface
- TOOLS: shell (rg, ast-grep), read
- MUST DO: Search all source files, find class implementations and object literals, include abstract/base classes
- MUST NOT DO: Do not modify files, do not execute code

**k-researcher (documentation search):**

- TASK: Find official documentation for the project's HTTP client library
- TOOLS: web_search, web_fetch, read
- MUST DO: Prioritize official documentation, include type/signature information, find error handling patterns
- MUST NOT DO: Do not use outdated documentation, do not cite unofficial sources as primary

**k-developer (implementation):**

- TASK: Implement the notification service using the patterns found in analysis
- TOOLS: read, write, shell
- MUST DO: Follow existing patterns, include error handling, add unit tests
- MUST NOT DO: Do not change existing interfaces, do not add new dependencies without justification
