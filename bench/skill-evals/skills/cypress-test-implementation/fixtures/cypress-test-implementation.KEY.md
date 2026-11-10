# cypress-test-implementation fixture key
planning/: strategy at testing-quality-assurance/outputs/e2e-test-strategy.md (the skill's default path), no Cypress installed, frontend uses id/class selectors (no data-cy).
Expected initial-mode plan: CYPRESS-NNN task IDs with Type/Related Test/Dependencies/Effort/Acceptance Criteria, phases Foundation -> P0 (E2E-001, E2E-002) -> P1 (E2E-003) -> P2 (E2E-004), recommend data-cy attributes, no code in the task breakdown (code goes to appendix).
implemented/: final-mode verification target.
- cypress/e2e/login-create-task.cy.js: cy.wait(5000) line 9, cy.wait(3000) line 18 (hard-coded waits, CRITICAL per skill gate); shared state across its via `let createdTitle` (line 2) and test 2 depending on test 1's login (no isolation, CRITICAL); conditional testing on body.find('.modal') lines 23-27 (anti-pattern); fragile selectors (#email, .btn-primary); vague assertions should('exist').
- P0 E2E-002 has no spec at all (CRITICAL: P0 not implemented). E2E-004 (P2) also missing.
- No page objects, no custom commands (login repeated), no fixtures.

v2: planning/testing-quality-assurance/outputs/cypress-implementation-plan.md is a stray file of unknown origin (looks like an earlier model output); v2 prompts use planning-clean/ (same strategy and frontend, no pre-existing plan). Additional p1 discrimination: the plan should note BoardPage/LoginPage lack edit/complete/search/filter/bulk-select UI and that strategy omits credentials and a cleanup endpoint, as dependencies/risks rather than inventing them.
