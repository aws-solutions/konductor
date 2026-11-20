# config-json (A5), Cy

`config/app.json` now holds the settings, nested by group; `src/config.js` flattens them so `get('session.ttlMinutes')`
works as before, and reads `config/app.ini` only when `app.json` is absent. New `test/config.test.js`.
Started from the code after help-text was merged.

Ran `node --test test/*.test.js`: 3 passing, 0 failing.
