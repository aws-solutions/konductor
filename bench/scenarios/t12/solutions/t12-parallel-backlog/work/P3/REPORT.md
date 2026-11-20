# P3: A5 configuration move (Cy)

- `config/app.json` holds the same keys as `config/app.ini` (`session.ttlMinutes`, `export.delimiter`).
- `src/config.js` reads `config/app.json`, and reads `config/app.ini` when the JSON file is missing (one release).
  `config/app.ini` stays for that release.
- `test/config.test.js` covers both files.

Built on the code after P4 was merged.

Check: `node --test test/*.test.js` printed pass 3, fail 0.
