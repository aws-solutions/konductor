# Key: e2e-test-strategy fixture
Change impact for security + patch: (10 x 0.6) + (3 x 0.4) = 7.2 -> High.
Password reset journey (US-3.2) should be P0: BI 10, TR 10, CTW 10 -> 10.0. Login (US-3.1) P0.
Simple CRUD / UI-only items (US-1.2 task detail, US-4.1 theme) should be excluded from E2E or at most P3.
Framework: Playwright (team experience, 3 of 5). Cypress has no team experience.
v2 notes:
- Exclusion before scoring: by the raw formula the theme switch would score 1*0.4 + 3*0.3 + 10*0.3 = 4.3 (P2) under a security
  release; the skill's exclusion criteria (UI-only -> component tests) remove it from the E2E suite before scoring. Same for
  the task detail view (simple read).
- Minor release, enhancement: change impact 4*0.6 + 6*0.4 = 4.8 (Medium) or 7*0.6 + 6*0.4 = 6.6 (High) if task sharing is
  treated as a critical feature; either is fine if stated. Task sharing: BI 7, TR 6 (SES), CTW 5 -> 6.1 (P1); invite via
  EventBridge -> Lambda -> SES is async with a user-visible outcome (60 s AC), so it stays in E2E.
- Top-4 for the security patch: password reset (incl. token reuse + UTC expiry), login (incl. lockout), then two of task
  creation / task sharing; the theme switch and detail view are out.
