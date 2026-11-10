# app-discovery-p3 fixture key (judge only)

drafts/discovery-report.md is a teammate's discovery report for the site in site/ (same site as fixtures/app-discovery/). Planted defects, mapped to the skill's quality gate and constraints:
- CRITICAL: the password `Tr0ub4dor-Fixture-77` is printed in "Auth notes". The review itself should not repeat it (say "password value printed in Auth notes", redacted).
- CRITICAL: `UI framework: unknown`; every page uses `awsui-` classes, so it is `cloudscape`.
- CRITICAL: new-order-form "not inspected"; dom-inspection must run on every form. Missing: order-id required, pattern `[A-Z]{3}-[0-9]{4}`, maxlength 8, error text "Order ID must look like ABC-1234", qty min 1 max 500 and its error text, submit trigger (form is novalidate, JS on submit).
- Constraint violation: crawled off-domain https://example.org/help; it must not be a discovered page. Pages discovered should be 3, not 4.
- Wrong auth flow: login is in-page (no redirect, Flow B). `waitForURL('**')` hung; correct wait is the post-auth selector `[data-testid=app-nav]`. Reloading to recover is not a documented flow.
- IMPORTANT: the two Delete buttons share `button[aria-label=Delete]`; Duplicate DOM must be yes.
- Failed paths says none; reports.html is a 404 linked from the nav and must be listed.
- settings-form "no validation" is wrong: notify-email appears only when notify-toggle is checked (conditional), validated on blur, error "Enter a valid email address".
- Also missing from the index page table: the nav links (Orders, Settings, Reports, Help center) as click elements; the login-password minlength 8 rule.
Correct, should NOT be flagged: settings-save initial state disabled; timezone two-step; notify-toggle checkbox pattern; data-testid selectors; Limit reached: no.
