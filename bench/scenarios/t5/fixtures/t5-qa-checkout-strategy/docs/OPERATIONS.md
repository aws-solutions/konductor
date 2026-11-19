# Operations notes

The settlement command runs once after the daily sales window. Its output is consumed by the finance import. Payment provider credentials and mail settings are supplied by the runtime environment.

If a checkout request fails, inspect the order id and provider charge id before retrying a request. Admin reconciliation reads two CSV exports and reports missing rows, amount differences, and matches.

The tax export is refreshed monthly. The application is restarted after configuration changes.
