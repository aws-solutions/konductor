# login-limit (A4), Cy

`src/auth/login.js` counts failures per account from the first failure of a minute and locks the account once the
count reaches `login.maxFailedPerMinute` (5 by default, set in the `login` group of `config/app.json` that
config-json created). New `test/login.test.js`.
Started from the code after help-text, config-json, currency-model and ci-two-zones were merged.

Ran `node --test test/*.test.js`: 5 passing, 0 failing.
