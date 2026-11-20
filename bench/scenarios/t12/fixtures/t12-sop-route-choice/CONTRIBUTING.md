# Contributing to booking-desk

- A bug fix comes with a regression test under `test/` that fails without the fix.
- Every change a guest or the front desk can see gets one line in `CHANGELOG.md`, under `## Unreleased`, naming its
  ticket when it has one.
- A new feature that product has not signed off yet starts as a spec, never as code: `docs/specs/<feature>/` holds
  `requirements.md`, `design.md` and `tasks.md`. Open questions go at the end of `requirements.md`, each with the
  person who decides it. Code starts after sign-off.
- Patch reviews go in `docs/reviews/<patch file name without .patch>.md` and end with a fenced json block:
  `{ "verdict": "approve" | "request-changes", "findings": [{ "file": "...", "line": 0, "problem": "..." }] }`.
  The author applies the patch, not the reviewer.
- Commit each finished piece of work on its own, with a message that says what it is.
