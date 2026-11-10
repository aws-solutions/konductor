# Edits made to the bundle data

The bundle files were copied as-is and then changed only as listed here.

## Typography

Dashes and curly quotes were rewritten in every `.json` and `.md` file, except the paths in
`DASH-FIXTURES.txt`.

- Em dash (`U+2014`) became a hyphen; a spaced em dash became ` - `.
- Curly single quotes (`U+2018`, `U+2019`) became `'`.
- Scripted checks that matched a range with `[-<en dash>]` now use the escaped form `[-\\u2013]` in the JSON
  text (`\u2013` once decoded), so the check still matches an en dash in a model's answer. Files:
  `adversarial-code-review/scenario.json` and `adversarial-code-review-pass-schema/scenario.json`.
- 14 files changed. Fixture inputs where the dash is the test are exempt (see `DASH-FIXTURES.txt`).

## Output-format header in rubrics and prompts

Five strings quoted the header `[SEVERITY] Data Integrity — file:line` or `[SEVERITY] Security — file:line`
with an em dash. They now use a hyphen: `[SEVERITY] Data Integrity - file:line`.

- `adversarial-code-review-pass-integrity/scenario.json`: 4 strings.
- `adversarial-code-review-pass-security/scenario.json`: 1 string.

The skill text itself still writes the header with an em dash, so a judge should accept either form.

## Left as is

- `AKIAIOSFODNN7EXAMPLE` (the AWS documentation example key) and `AKIAEXAMPLEFAKE00000` are clearly fake and
  were kept.
- Account IDs `111122223333`, `444455556666`, `777788889999` and `123456789012` are placeholders.

## Stale expectations updated

These follow the bundle author's STALE list, checked against the current skill text.

- `kiro-design-generation`: the skill returns 404 for ids that do not exist and for ids the caller does not own.
  `evals.json` eval 0 (`network-monitoring-default-dir`) `expectations[3]`, and `scenario.json` p1 rubric r3 now read
  "ownership check returns 404 for not-owned ids" instead of "ownership check -> 403". Eval 1 `expectations[3]` and
  p2 r3 (`AuditReader -> 403`) are a role check, so they keep 403.
- `adversarial-design-review`: the lowest tier is SUGGESTION, so MINOR became SUGGESTION in `evals.json`
  (eval 0 `expectations[3]`; eval 1 `expected_output`, `expectations[3]` and `expectations[4]`) and in
  `scenario.json` (p1 r2 criterion; p2 `why_discriminating`, r2 partial and r3 pass; p3 r2 criterion and fail, and
  p3 r3 pass). p3 r2 now says "SUGGESTION, not MINOR/low", since the old text required MINOR.
- `design-quality-check`: the count line is `Issues: N IMPORTANT, N SUGGESTION`. `evals.json` (eval 0
  `expectations[2]`; eval 1 `expected_output` and `expectations[1]`) and `scenario.json` (p1 r2 pass, p2 r1 pass,
  p3 `why_discriminating`, p3 r1 pass) no longer accept MINOR.
- Left alone: `adversarial-design-review/queries.json` (a user prompt that says "CRITICAL / IMPORTANT / MINOR"),
  the two `.KEY.md` fixture keys (they accept either name), and lowercase prose such as "a minor note".

## Eval cases dropped (fixture missing)

Each case listed a directory in `files` that is not in the bundle, so it could not run as written. All nine were
checked against `skills/<skill>/fixtures/` and none resolves. The cases were removed from `evals.json`; the ids of
the remaining cases are unchanged. The matching scenario prompts and trigger queries stay.

| Skill | Dropped eval id, name | Missing fixture |
| --- | --- | --- |
| claude-teams-behavior | 2, direct-work-mode-own-edit-plus-dispatch | `fixtures/claude-teams-behavior-p4/` |
| code-review | 0, review-source-tree-no-git | `fixtures/code-review-tree/` |
| code-review | 2, post-implementation-self-review | `fixtures/code-review-selfreview/` |
| design-doc-guidelines | 2, companion-doc-sync-after-parent-rename | `fixtures/design-doc-guidelines-multidoc/` |
| design-evaluation | 2, sop-scoring-missing-threat-model | `fixtures/design-evaluation-no-threat-model/` |
| historical-issues-registry | 2, filter-refetched-threads-dedup | `fixtures/historical-issues-registry-refetch/` |
| playwright-test-implementation | 1, login-spec-playwright-missing | `fixtures/playwright-test-implementation-nopw/` |
| verification | 2, config-doc-fix-runs-covering-tests | `fixtures/verification-docs/` |
| workspace-skills | 2, patch-overlapping-agent-created-skill | `fixtures/workspace-skills-dedup/` |

Totals moved from 154 to 145 eval cases, 995 to 935 expectations and 263 to 245 scripted checks.
Eval-only cases (no matching scenario prompt) moved from 35 to 27.

## Unverified, kept

Listed by the bundle author as suspected. Not checked against the skill text and not edited.

- `aws-service-validator/scenario.json` p1 r2 quotes the summary line as
  `N claims checked - N CONFIRMED, N UNVERIFIED, N INCORRECT`. The skill writes `N claims checked: ...` with a
  colon, so a strict judge may fail the dash form.
- `sprint-planning` evals use the `fixtures/asana-sprint-planning/` fixture from the skill that was merged into
  it. The tracker-export expectations may not match the merged text.
- Limited scenarios (`limited: true`): `aws-service-validator`, `cmux-dispatch`, `external-research`,
  `find-aws-skills`, `mux-dispatch`. They test only the offline path.
- `policy-validation/evals.json` is a two-eval subset (ids 0 and 2), kept as the bundle author chose it.
