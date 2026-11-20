# P2: A4 login limit (Cy)

- `src/auth/login.js` keeps the failed logins of each account for one minute and refuses any attempt once there are
  `login.maxFailedPerMinute` of them (reason `too_many_attempts`).
- `config/app.json` (as merged by P3) gains `"login.maxFailedPerMinute": 5`.
- `test/login.test.js` covers the sixth attempt, four failures, and failures expiring after a minute.

Built on the code after P4, P3 and P1 were merged.

Check: `node --test test/*.test.js` printed pass 7, fail 0.
