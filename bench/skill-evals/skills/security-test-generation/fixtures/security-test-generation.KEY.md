# security-test-generation fixture key
Two copies of the same Express app:
- express-api/          no .kiro dir -> non-Kiro branch: output_dir defaults to security-test-plans/ with per-category [domain]-[layer].md, security-test-overview.md, best-practices-reference.md
- kiro-express-api/     has .kiro/ -> Kiro branch: single task list at .kiro/specs/security-testing/tasks.md, Task 1 = foundation review, categories ordered Auth -> Input Validation -> API -> Data Protection -> Session -> Error Handling -> Infrastructure.
Planted issues the plan should target:
- src/routes/users.js GET /:id has no ownership check (IDOR / horizontal privilege escalation, T3)
- src/routes/search.js builds SQL by string concatenation (SQL injection, T2)
- src/routes/admin.js trusts client header x-role (vertical privilege escalation, T4)
- src/app.js error handler returns err.stack (information disclosure, T5)
- src/middleware/auth.js default JWT secret 'dev-secret' (T1); login compares plaintext passwords
- src/routes/uploads.js stores originalname under public/ (T6)
