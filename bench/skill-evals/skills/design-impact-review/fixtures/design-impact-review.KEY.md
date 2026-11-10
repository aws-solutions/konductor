# design-impact-review fixture key (judge-only)

p1 change: split `fullName` into `givenName` + `familyName` and add `phoneNumber` to Member.
Origin layer: data model.
Expected: API schema BREAKING (required fullName removed), UX/FE ProfileCard.tsx BREAKING (reads u.fullName),
contract tests BREAKING or STALE (pinned keys), threat model STALE or BREAKING (phoneNumber is new PII, not classified),
requirements AC-3.2 STALE (says full name), NFRs UNAFFECTED, HLD STALE or UNAFFECTED.
Recommendation: BREAKING impacts surfaced before proceeding.

p2 change: requirement to make profiles publicly viewable (no sign-in). Origin: requirement.
Expected: threat model BREAKING (T1 mitigation and trust boundary invalid), HLD BREAKING (owner check, Cognito authorizer),
AC-3.1 conflict, API BREAKING (403 semantics, email exposure), tests STALE/BREAKING (403 auth tests).

p3 change: rename local variable `u` to `member` in ProfileCard.tsx. Cosmetic; skill says skip or CONTAINED. No BREAKING.

v2 p3 (replaces the variable-rename prompt, which any competent answer passed):
change: 5-minute in-memory cache in the Profile Lambda for GET /members/{id}, keyed by id. Origin: implementation.
Expected: API, data model, UX UNAFFECTED. Threat model STALE: cache must be consulted only after the owner check or T1 (read another member's email) is defeated. HLD STALE (read path now cached). Test strategy STALE: add tests that non-owner still gets 403 on a cached id and that PATCH invalidates. US-4 edits (PATCH) must invalidate or users see a stale name up to 5 min (AC-3.2 display).
Recommendation: conditional go (STALE only / CONTAINED with conditions). Not BREAKING.
