# adversarial-code-review-pass-security fixture key (judge-only)

changes.diff (p1, p2). New-file line numbers are in src/routes/reset.js:
- reset.js:10 hardcoded mailer API key (CRITICAL)
- reset.js:13 logs req.headers (authorization) and req.body at info (IMPORTANT)
- reset.js:15 email interpolated into SQL (CRITICAL injection)
- reset.js:16 404 echoes email and reveals account existence (user enumeration) (IMPORTANT/SUGGESTION)
- reset.js:24 err.message and err.stack returned to caller (CRITICAL)
- infra/policy.json:6-7 widened to s3:* on Resource "*" (CRITICAL)
- NOT a finding: test/fixtures/accounts.json synthetic account id 123456789012 and AWS doc example key AKIAIOSFODNN7EXAMPLE.
- Out of lane (integrity, should not appear as Security finding): reset.js:19-20 UPDATE + INSERT without transaction.

export.diff (p3):
- export.js:9 opaque cursor base64-decoded inline, bypassing src/util/cursor.js decodeCursor (HMAC + integer validation) (IMPORTANT)
- export.js:10 decoded offset interpolated into SQL (CRITICAL injection)
- server.js:11 (diff +app.use('/', exportRouter)) admin route mounted without requireAuth from src/middleware/auth.js (CRITICAL/IMPORTANT)
- test/export.test.js:11 TEST_HOST env interpolated into execSync shell command (command injection in a test file, still in scope)
- NOT a finding: FAKE_SESSION 'test-session-0000' synthetic value.

v2 note: in changes.diff, resetRouter is mounted on /api without requireAuth. That is expected for a password-reset endpoint (callers are logged out); flagging "missing auth" there is a false positive. Rate limiting the endpoint is a reasonable SUGGESTION but not seeded.
