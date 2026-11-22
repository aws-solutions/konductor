# Review threads from revisions 1 and 2

Approved with nits. The implementation is headed in the right direction. The
threads below record what was already discussed so the next pass can focus on
new code rather than reopening settled points.

## Thread 1: redemption policy

**config/points-policy.json:2**

The configured per-request redemption ceiling still is not enforced by every
caller. This is a real policy gap, but it is outside this revision's scope.

**Author, revision 2:** Won't fix in this pull request. The checkout gateway
currently applies the ceiling before calling this service, and we will handle
service-side policy validation in a separate change.

**Status:** open.

## Thread 2: existing staff route authorization

**src/routes-admin.js:1**

Please keep the role check in the shared auth helper instead of duplicating a
role comparison in the existing inspection handler.

**Author, revision 2:** Fixed. The inspection handler now calls `requireRole`.

**Status:** fixed.

## Thread 3: ledger debit promise style

**src/points-ledger.js:18**

The chained promise in the older debit helper is harder to scan than the
async style used nearby. Please use one style consistently when this file is
next touched.

**Reviewer, revision 2:** Rejected as a style-only change because the helper is
not part of this endpoint update.

**Status:** rejected.

## Thread 4: maintenance audit note

**docs/operations.md:12**

The runbook says each job emits an audit record, but the job module does not
call the logger. An operator could look in the wrong place when tracing a run.

**Author, revision 2:** Rejected because the production adapter supplies the
audit hook around this example job.

**Status:** rejected.

## Thread 5: new test helpers

**tests/revision3.test.js:28**

The test data could use named constants instead of several customer IDs. This
is a small readability preference, not a blocker.

**Reviewer, revision 2:** Rejected for now; the IDs make each test's setup
obvious and the file is limited to the new cases.

**Status:** rejected.

## Thread 6: release note heading

**CHANGELOG.md:4**

The unreleased heading does not have a date. Add one before cutting a release.

**Author, revision 2:** Won't fix until the release date is known.

**Status:** won't fix.
