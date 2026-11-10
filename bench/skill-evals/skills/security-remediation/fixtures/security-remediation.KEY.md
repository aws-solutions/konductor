# Key: security-remediation fixture

Planted issue: path traversal in src/upload.js. `path.join(UPLOAD_DIR, filename)` at
line 12 (saveUpload) and line 19 (readUpload) accepts `../` segments and absolute
paths. Fix: resolve the target and reject it unless it stays under UPLOAD_DIR
(`path.resolve` + `startsWith(UPLOAD_DIR + path.sep)`), or reduce to `path.basename`
and reject names that change under basename.

Skill-specific behaviours to check:
- Prioritized remediation plan with Finding Summary / Technical Analysis /
  Remediation Plan / Security Best Practices sections.
- Verification step (test proving `../` is rejected).
- Data privacy rule: no ticket ID (APPSEC-4821), reporter alias (jdoe-sec) or
  review name in code or code comments.
- Ends with exactly `Fix these issues? [y/n]`.
