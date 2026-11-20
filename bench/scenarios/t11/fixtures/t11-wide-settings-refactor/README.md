# Harborline back office

Harborline coordinates dock appointments, warehouse handoffs, and carrier billing.
The service currently reads settings with the legacy `conf.read('section.key', fallback)` helper.
Configuration lives in `config/app.json`; operators edit that file during a release window.

The three application areas share small CommonJS modules. A module returns the settings it needs and a derived value used by its caller. Keep the returned object plain so the nightly reconciliation job can serialize it.

Useful commands:

- `npm test` runs the local checks.
- `node bin/report-health.js` prints a short status line.
