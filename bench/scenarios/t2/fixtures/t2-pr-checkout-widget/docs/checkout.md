# Checkout contract

The checkout page supports `en-US`, `fr-FR`, and `de-DE`. Pass the active locale to `formatMoney` with integer cents and the configured currency. Currency symbols, decimal separators, and grouping are locale data rather than string decoration.

Promotion replies come from a service and are display text, not markup. The browser must put them into the page as text.

An order request is one user action. The action control stays unavailable until the request settles, including an error response. The server remains the final authority for totals and promotion eligibility.
