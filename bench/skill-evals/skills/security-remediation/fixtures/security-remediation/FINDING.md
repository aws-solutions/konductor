# Security finding

Ticket: APPSEC-4821
Reporter: jdoe-sec
Review: AppSec Review 2026-Q4 / doc-share-api
Severity: High
Title: Path traversal in file upload and download

Description: The `name` query parameter on `PUT /files` and `GET /files` is joined
onto the upload directory without normalization checks. A request such as
`GET /files?name=../../etc/passwd` reads files outside the upload directory, and
`PUT /files?name=../src/server.js` overwrites application code.

Affected component: doc-share-api (src/upload.js)
