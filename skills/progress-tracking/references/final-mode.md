# Progress tracking: final mode stages

Read this when mode is final, after Stage 5 passes. Each report uses the Standard Report Template in `SKILL.md`.

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
