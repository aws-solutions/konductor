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
