# Codebase Analysis

## Overview

This SOP performs comprehensive codebase analysis covering architecture, design principles, patterns, and technical debt. It produces a structured markdown report with Mermaid diagrams. Use `focus_areas=all` for onboarding a newcomer to an unfamiliar codebase (full breadth); use a narrower `focus_areas` selection (e.g. `architecture,dependencies,debt`) when the goal is a specific architecture review or refactoring-planning pass — see the `focus_areas` parameter below for the full list of selectable sections.

Use this SOP when joining an unfamiliar codebase, before major refactoring, during architecture reviews, or when assessing technical debt.

This SOP differs from the `analyze` SOP, which performs pre-implementation context gathering across multiple research agents. Codebase analysis produces a comprehensive architectural assessment document with SOLID evaluation, design pattern identification, and technical debt scoring — it's a deep-dive reference document, not a pre-task research step.

## Parameters

- **codebase_path** (optional, default: current directory): Path to the codebase to analyze
- **output_file** (optional, default: `codebase-analysis.md`): Where to write the analysis report
- **focus_areas** (optional, default: `all`): Comma-separated list of areas to focus on: `architecture`, `solid`, `patterns`, `dependencies`, `security`, `performance`, `testing`, `debt`, or `all`

| focus_area value | Corresponding Step                  |
| ---------------- | ----------------------------------- |
| architecture     | Step 3: Architecture Analysis       |
| solid            | Step 4: SOLID Principles Evaluation |
| patterns         | Step 5: Design Patterns Analysis    |
| dependencies     | Step 6: Dependencies & Integrations |
| testing          | Step 7: Code Quality Assessment     |
| security         | Step 8: Security & Performance      |
| performance      | Step 8: Security & Performance      |
| debt             | Step 9: Technical Debt Assessment   |
| all              | Steps 2-9 (all sections)            |

**Constraints for parameter acquisition:**

- If all parameters use defaults, You MUST proceed to the Steps immediately
- You MUST NOT prompt for optional parameters — use defaults if not provided
- You MUST validate that `codebase_path` exists before proceeding

## Steps

### 1. Resolve Parameters

Validate paths, set defaults, and determine which analysis sections to run.

**Constraints:**

- You MUST resolve `codebase_path` to an absolute path
- You MUST verify `codebase_path` exists and contains source files
- You MUST parse `focus_areas` into a list and validate each value against the allowed set: `architecture`, `solid`, `patterns`, `dependencies`, `security`, `performance`, `testing`, `debt`
- If `focus_areas` is `all`, You MUST run all analysis sections (Steps 2–9)
- If `focus_areas` is not `all`, You MUST only run the selected analysis sections and skip the rest
- You MUST create the output file immediately with a header to enable incremental writes:

  ```markdown
  # Codebase Analysis: {project_name}

  Date: {current_date}
  Scope: {focus_areas}
  ```

- You MUST NOT proceed if `codebase_path` does not exist or contains no source files

**Expected Output:** Confirmed parameters (resolved path, output file, focus areas list) and initialized output file

### 2. Build Codebase Map

Survey the codebase to understand its structure, languages, frameworks, and entry points.

**Constraints:**

- You MUST scan the directory tree and identify:
  - Top-level directory structure
  - Primary languages (by file extension count)
  - Frameworks and libraries (from dependency manifests: `package.json`, `pom.xml`, `Cargo.toml`, `Config`, `requirements.txt`, etc.)
  - Entry points (main files, handlers, CLI entry points)
  - Build system (`make`, `npm`, `cargo`, `gradle`, `maven`, etc.)
- You MUST generate a Mermaid diagram showing the high-level directory/module structure:

  ```mermaid
  graph TD
    Root --> ModuleA
    Root --> ModuleB
    ModuleA --> SubModule1
  ```

- You MUST save findings to `output_file` under `## Codebase Map`
- You MUST NOT traverse `node_modules`, `.git`, `build`, `dist`, `target`, or other generated directories

**Expected Output:** Codebase map section appended to output file with language breakdown, framework list, entry points, and Mermaid structure diagram

### 3. Architecture Analysis

Analyze the system's architectural layers, component boundaries, and dependency flow.

**Constraints:**

- You MUST identify:
  - Architectural style (layered, hexagonal, microservices, monolith, event-driven, etc.)
  - Layer boundaries (presentation, business logic, data access, infrastructure)
  - Component boundaries and how they communicate
  - Dependency direction (do dependencies flow inward toward domain logic?)
- You MUST generate a Mermaid dependency graph showing component relationships:

  ```mermaid
  graph LR
    API --> Service
    Service --> Repository
    Repository --> Database
    Service --> ExternalAPI
  ```

- You MUST include file path references for each identified layer/component
- You MUST save findings to `output_file` under `## Architecture Overview`
- You MUST NOT modify any source files

**Expected Output:** Architecture analysis section appended to output file with architectural style, layer identification, dependency graph (Mermaid), and file path references

### 4. SOLID Principles Evaluation

Evaluate adherence to each SOLID principle with concrete examples from the code.

**Constraints:**

- You MUST evaluate all five principles:
  - **S** — Single Responsibility: Do classes/modules have one reason to change?
  - **O** — Open/Closed: Can behavior be extended without modifying existing code?
  - **L** — Liskov Substitution: Are subtypes substitutable for their base types?
  - **I** — Interface Segregation: Are interfaces focused and minimal?
  - **D** — Dependency Inversion: Do high-level modules depend on abstractions?
- For each principle, You MUST provide:
  - A rating: ✅ Good, ⚠️ Needs Improvement, or ❌ Violated
  - At least one concrete code example with file path
  - A brief recommendation if not ✅
- You MUST save findings to `output_file` under `## SOLID Principles Evaluation`
- You MUST NOT fabricate examples — only reference actual code found in the codebase

**Expected Output:** SOLID evaluation section appended to output file with per-principle rating, code examples with file paths, and recommendations

### 5. Design Patterns Analysis

Identify Gang of Four and architectural patterns in use across the codebase.

**Constraints:**

- You MUST scan for patterns in three categories:
  - **Creational**: Factory, Builder, Singleton, Abstract Factory
  - **Structural**: Adapter, Decorator, Facade, Proxy, Composite
  - **Behavioral**: Strategy, Observer, Command, Template Method, Chain of Responsibility
- For each identified pattern, You MUST include:
  - Pattern name and category
  - Where it's used (file paths)
  - Whether it's implemented correctly or is a partial/anti-pattern
- You MUST also identify architectural patterns: Repository, Service Layer, MVC/MVVM, Event Sourcing, CQRS, Middleware Pipeline
- You MUST save findings to `output_file` under `## Design Patterns Identified`
- You MUST NOT force-fit patterns — only report patterns that are clearly present

**Expected Output:** Design patterns section appended to output file with categorized patterns, file path references, and correctness assessment

### 6. Dependencies & Integrations

Analyze external dependencies, internal integrations, and API contracts.

**Constraints:**

- You MUST catalog:
  - External dependencies with versions (from dependency manifests)
  - Internal package/module dependencies
  - API contracts (REST endpoints, GraphQL schemas, gRPC definitions, Smithy models)
  - Integration points (databases, queues, caches, external services)
- You MUST flag:
  - Outdated or deprecated dependencies (if version info is available)
  - Circular dependencies between internal modules
  - Missing or undocumented API contracts
- You MUST generate a Mermaid integration diagram:

  ```mermaid
  graph TD
    Service --> DynamoDB
    Service --> SQS
    Service --> ExternalAPI
    Frontend --> Service
  ```

- You MUST save findings to `output_file` under `## Dependencies & Integrations`

**Expected Output:** Dependencies section appended to output file with dependency catalog, integration diagram (Mermaid), and flagged issues

### 7. Code Quality Assessment

Assess error handling, logging, and testing strategy.

**Constraints:**

- You MUST evaluate these areas:
  - **Error Handling**: Are errors caught, logged, and propagated correctly? Are there bare catch blocks?
  - **Logging**: Is logging consistent? Are log levels used appropriately? Is sensitive data excluded?
  - **Testing Strategy**: What types of tests exist (unit, integration, E2E)? What's the test-to-source ratio?
- For each area, You MUST provide a rating: ✅ Good, ⚠️ Needs Improvement, or ❌ Critical Issue
- Each finding MUST include file path references
- You MUST save findings to `output_file` under `## Code Quality Assessment`
- You MUST NOT run any code or execute tests — this is static analysis only

**Expected Output:** Code quality section appended to output file with per-area ratings, specific findings with file paths, and recommendations

### 8. Security & Performance

Assess security mechanisms and performance considerations.

**Constraints:**

- You MUST evaluate these areas:
  - **Security**: Are inputs validated? Is authentication/authorization implemented? Are secrets hardcoded?
  - **Performance**: Are there obvious N+1 queries, unbounded loops, missing pagination, or missing caching?
- For each area, You MUST provide a rating: ✅ Good, ⚠️ Needs Improvement, or ❌ Critical Issue
- Each finding MUST include file path references
- You MUST save findings to `output_file` under `## Security & Performance`
- You MUST NOT run any code or execute tests — this is static analysis only

**Expected Output:** Security and performance section appended to output file with per-area ratings, specific findings with file paths, and recommendations

### 9. Technical Debt Assessment

Identify technical debt indicators and rate their severity.

**Constraints:**

- You MUST scan for these debt indicators:
  - TODO/FIXME/HACK/XXX comments (with file locations)
  - Dead code (unused exports, unreachable branches)
  - Code duplication (similar logic in multiple places)
  - Missing abstractions (repeated patterns that should be extracted)
  - Configuration drift (hardcoded values that should be configurable)
  - Outdated patterns (deprecated APIs, legacy approaches)
- You MUST rate each debt item by severity:
  - **CRITICAL**: Actively causing bugs, blocking features, or creating security risk
  - **IMPORTANT**: Slowing development, increasing maintenance burden
  - **SUGGESTION**: Cosmetic, minor inconsistencies, nice-to-fix
- You MUST save findings to `output_file` under `## Technical Debt`

**Expected Output:** Technical debt section appended to output file with categorized debt items, severity ratings, and file path references

### 10. Generate Report

Compile all findings into the final structured report with an executive summary and prioritized recommendations.

**Constraints:**

- You MUST ensure the final report in `output_file` follows this structure:

  ```
  # Codebase Analysis: {project_name}
  Date: [date]
  Scope: [focus areas analyzed]
  ## Executive Summary
  ## Codebase Map (with Mermaid diagram)
  ## Architecture Overview (with Mermaid diagram)
  ## SOLID Principles Evaluation
  ## Design Patterns Identified
  ## Dependencies & Integrations (with Mermaid diagram)
  ## Code Quality Assessment
  ## Security & Performance
  ## Technical Debt
  ## Recommendations (prioritized)
  ```

- The Executive Summary MUST be 3–5 sentences covering: overall health, biggest strengths, most critical issues
- The Recommendations section MUST be a prioritized list (P0–P2) with:
  - P0: Fix immediately (security issues, critical bugs, blocking debt)
  - P1: Fix this quarter (architectural improvements, medium debt)
  - P2: Fix when convenient (cosmetic, low-severity debt)
- If `focus_areas` was not `all`, You MUST only include sections for the selected areas
- You MUST inform the user of the output file location and the top 3 recommendations
- You MUST NOT print the full report in your response — reference the file

**Expected Output:** Complete report written to `output_file`, with a summary message to the user containing the file path and top 3 prioritized recommendations

## Troubleshooting

### Issue: Codebase is too large and analysis hits context limits

**Solution:** Use `focus_areas` to analyze one area at a time (e.g., `focus_areas=architecture,dependencies`). Run multiple passes and the incremental writes to `output_file` will accumulate findings across runs.

### Issue: No dependency manifest found

**Solution:** The analysis will still proceed but the Dependencies & Integrations section will note that no manifest was found. Check for non-standard dependency files (e.g., `Makefile`, `BUILD`, `WORKSPACE`) and point `codebase_path` to the correct root.

### Issue: Mermaid diagrams are too complex to render

**Solution:** Simplify by grouping related components into subgraphs. Focus on top-level module relationships rather than individual file dependencies. Use `graph TD` for hierarchical layouts and `graph LR` for flow-based layouts.

### Issue: SOLID evaluation seems inaccurate for non-OOP codebases

**Solution:** For functional or procedural codebases, the SOLID evaluation adapts the principles: Single Responsibility applies to modules/functions, Open/Closed applies to extension points, and Dependency Inversion applies to module boundaries. The evaluation will note when principles are less applicable.

### Issue: Analysis misidentifies patterns

**Solution:** Pattern detection is heuristic-based. If a pattern is misidentified, check the file path reference and verify manually. The analysis will note confidence level when patterns are ambiguous.
