# Notes

The expiry test failed because the cache never expired anything.

Cause chain: `config/app.json` stores the ttl as the text `"90s"` -> `loadConfig` read it with `Number("90s")`, which is `NaN` -> the cache compared the entry age with `NaN`, which is always false -> entries never expired -> the test saw the old value where it expected `undefined`.

Changed: `src/config.js` now reads the ttl with `parseDuration`, the same helper the retry delay already used, so `ttlMs` is 90000. `src/cache.js` and the tests are unchanged.
