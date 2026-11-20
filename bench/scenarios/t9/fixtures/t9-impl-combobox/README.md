# Harbor Days registration

This small static site collects registrations for the Harbor Days community event. It is deliberately served as plain files so the page can be previewed from a file server with no build step.

## Local development

Use any static file server and open `index.html`. The maintained checks run with `node --test test/` on Node 24.

Country matching lives in `src/filter.js`. The page integration keeps its data in `src/countries.js`. A local preview may provide `window.__countryPickerRank(query, items)` before the module loads to observe or replace the ordering during manual testing.
