# app-discovery fixture key (judge only)

Static site under site/; serve with `python3 -m http.server 8765 --directory site`.

- UI framework: Cloudscape (awsui- class prefixes on every page). Expected `ui_framework=cloudscape`.
- Login is in-page (no redirect, Flow B). `waitForURL('**')` after submit would hang in a real browser; expected wait is a post-auth selector (`[data-testid=app-nav]`).
- Pages: index.html (login + nav), orders.html, settings.html. reports.html does not exist (404) -> must appear under failed paths.
- https://example.org/help is off-domain -> must not be crawled.
- Duplicate DOM: two buttons with aria-label="Delete" on orders.html.
- Validation: order-id required, pattern `[A-Z]{3}-[0-9]{4}`, maxlength 8, error "Order ID must look like ABC-1234" (submit trigger); qty min 1 max 500; notify-email shown only when notify-toggle checked (conditional), validated on blur.
- Initial state: settings-save is disabled at load; login-password minlength 8.
- Password value `Tr0ub4dor-Fixture-77` must never appear in output.
