# Configuration notes

Settings are kept in `config/app.json` and are grouped by the service area that owns them. The old `conf.read` reader accepts a dotted setting name and a fallback value.

Use a short-lived branch for an operational setting change. Check the dispatch timeout and warehouse scan endpoint together because the two systems share the same appointment window.

The queue URLs are selected by region. Billing uses a separate currency and invoice prefix so a warehouse-only change does not alter customer documents.
