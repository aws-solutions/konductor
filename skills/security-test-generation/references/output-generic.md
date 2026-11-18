# Stage 8 output: other tools (`tool_type == "other"`)

Read this at Stage 8 when `tool_type == "other"`.

**Selection Note:** Tool type selected by user (Q CLI or Cline).

**Generate:**

1. Directory: `{output_dir}`, optional and defaulting to `security-test-plans/`. This default applies to this non-Kiro branch (`tool_type == "other"`). The Kiro branch (`references/output-kiro.md`) defaults `output_dir` to `.kiro/specs/security-testing/` instead.
2. Per category: `{output_dir}/[domain]-[layer].md` with description, test cases, best practices, references. `[domain]` is the full Stage 5 category name in kebab-case and `[layer]` is always present, for example `authentication-authorization-backend.md`, `data-protection-encryption-backend.md`, `infrastructure-security-infrastructure.md`. Consistent names let engineers and scripts find a category's file without opening the overview.
3. `{output_dir}/security-test-overview.md`: master view, all categories in the Stage 7 order (Authentication & Authorization first, Infrastructure last), testing framework, best practices. Include a findings table (ID, file:line, threat ID or "not in threat model", linked test IDs) built from the Stage 4 code analysis, and a map from each threat ID to its test IDs.
4. `{output_dir}/best-practices-reference.md`: AWS, OWASP guidelines

**Test cases in each category file:** group them under Positive, Negative and Edge headings, in that order, as a table an engineer can implement without rereading the code:

| ID | Test (concrete input) | Expected secure result | Expected today |
|----|-----------------------|------------------------|----------------|
| AUTH-07 | JWT signed with `alg: none` on `GET /profile` | 401 | FAIL (verifier accepts any algorithm, `middleware/jwt.js`) |

- Use one ID prefix per category (AUTH, INP, API, DATA, SESS, ERR, INFRA) and number cases sequentially across all three groups, so the overview can map each threat ID to a range of test IDs.
- Fill "Expected today" from the code analysis (PASS, FAIL with the file, or Unknown) so known gaps are separated from regression checks.
- A case that fails today still goes under the heading that matches its intent. A known gap is a Negative case with "FAIL" in the last column, not a Positive one.
- Where an input is missing, such as IaC or deployment docs, mark those checks "N/A, not deployed" or "assumed" and state the assumption, but still list the concrete checks to run once the environment exists. Do not tell the reader to go ask someone; under `scope_confirmed` the plan has to stand on its own.

`output_dir` lets a calling SOP place these files alongside its other artifacts, the same way it places the Kiro branch's `tasks.md`. Callers that pass nothing get the default, so existing behavior is unchanged.

**Output Message:**

```
✅ Security test plans generated: [N] categories in `{output_dir}`

Environment: [Q CLI | Cline] (user-selected)

Category Files: [list]
Overview Files: {output_dir}/security-test-overview.md, {output_dir}/best-practices-reference.md

Testing Framework: [detected_framework]

Using with Q CLI:
q chat --prompt "Implement security tests from {output_dir}/[category-file].md"

Using with Cline:
1. Open {output_dir}/[category-file].md
2. Copy test cases and requirements
3. Paste into Cline

Recommended Execution Order: [list by priority]

Best Practices Applied:
- AWS Security Best Practices
- OWASP Web Security Testing Guide

Refining: Re-run to update based on new artifacts or code changes.
```
