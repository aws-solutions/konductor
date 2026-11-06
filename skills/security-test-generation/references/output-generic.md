# Stage 8 output: other tools (`tool_type == "other"`)

Read this at Stage 8 when `tool_type == "other"`.

**Selection Note:** Tool type selected by user (Q CLI or Cline).

**Generate:**

1. Directory: `{output_dir}`, optional and defaulting to `security-test-plans/`. This default applies to this non-Kiro branch (`tool_type == "other"`). The Kiro branch (`references/output-kiro.md`) defaults `output_dir` to `.kiro/specs/security-testing/` instead.
2. Per category: `{output_dir}/[domain]-[layer].md` with description, test cases, best practices, references
3. `{output_dir}/security-test-overview.md`: master view, all categories, testing framework, best practices
4. `{output_dir}/best-practices-reference.md`: AWS, OWASP guidelines

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
