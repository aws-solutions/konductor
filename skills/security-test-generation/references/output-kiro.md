# Stage 8 output: Kiro (`tool_type == "kiro"`)

Read this at Stage 8 when `tool_type == "kiro"`.

**Detection Note:** Kiro environment auto-detected via `.kiro` directory presence.

**Generate Primary Task List Only:**

1. **Create Security Testing Task List:**

   File: `{output_dir}/tasks.md`

   **Header:**

   ```markdown
   # Security Testing Implementation Plan

   This file tracks security test generation and execution across all application layers.
   Each task generates detailed requirements, design, and test cases for a specific security domain.

   ## Testing Approach

   - Test Order: Positive tests → Negative tests → Edge cases (optional)
   - Framework: [detected_framework]
   - Best Practices: AWS, OWASP

   ## Discovered Artifacts

   [List of discovered artifacts with paths]

   ## Tasks
   ```

   **Task List:**
   - Include Task 1 (foundation review)
   - Include all category tasks in priority order
   - Each task includes:
     - Security domain and layer
     - Sub-bullets for spec generation
     - Best practice references
     - Artifact references (if applicable)

**Output Message:**

```
✅ Security test plan complete!

Environment: Kiro (auto-detected)

Generated Files:
- `{output_dir}/tasks.md` (primary task list)

Security Test Categories:
The file contains [N] security test categories organized by domain and application layer.

Discovered Artifacts:
[List artifacts that were found and will be used]

Testing Framework: [detected_framework]

Workflow:
1. Open `{output_dir}/tasks.md`
2. **IMPORTANT: Start with Task 1** - Review security testing foundations
   - Familiarize yourself with OWASP Top 10, AWS best practices, and testing framework
3. Click "Start task" on the first security test category to generate its detailed spec
4. The spec generation will create requirements.md, design.md, and tasks.md for that category
5. Implement tests following the order: Positive → Negative → Edge cases
6. After completing the category, return to the primary task list and proceed to the next

Security tests will be created in priority order, ensuring foundational security (authentication) is tested first.

Best Practices Applied:
- AWS Security Best Practices
- OWASP Web Security Testing Guide

Refining: Re-run to update based on new artifacts or code changes.
```
