# skill-evals

Eval data for the 81 Konductor skills: trigger queries, behavior cases with graded expectations, and
scenario prompts with rubrics. It is data only. It holds no skill sources; the skills live in `skills/` at the
repository root.

Layout: `skills/<name>/` holds `evals.json`, `queries.json`, `scenario.json` and, for 70 skills, `fixtures/`.

## What is in the bundle

| Item | Count |
| --- | --- |
| Skills (`ALLOWLIST.txt`) | 81 |
| Skills with `evals.json` | 66 (15 have none) |
| Eval cases | 154 |
| Graded expectations | 995 |
| Scripted checks (`scripted_checks` in `evals.json`) | 263 |
| Trigger queries (`queries.json`, about half near-miss negatives) | 1,618 |
| Scenario prompts (`scenario.json`) | 246 |
| Rubric items | 1,041 |
| Floor checks | 370 |
| Fixture directories | 70 |
| Files in the bundle (`MANIFEST.sha256`) | 672 |

Five scenarios are marked `limited`: they test only the offline path of the skill (`aws-service-validator`,
`cmux-dispatch`, `external-research`, `find-aws-skills`, `mux-dispatch`).

35 eval cases carry a `scenario_prompt_id` with no matching scenario prompt. They are eval-only cases.

## Listing budget

The 30,000-character Claude Code skill listing budget is verified. Claude Code logged
`Skill listing over budget: 96 skills, 31237 chars > 30000`.

## Provenance and edits

- `ALLOWLIST.txt` and `ALLOWLIST.sha`: the 81 skill names and the commit they were read from.
- `EXCLUDED-SKILLS.md`: what the bundle author left out.
- `STALE-FIXED.md`: the edits made after copying.
- `DASH-FIXTURES.txt`: fixture inputs where a dash or curly quote is the test. They keep it, and the data test
  skips exactly these paths.
- `MANIFEST.sha256`: path and SHA-256 of every file under `skills/`, computed after the edits.

## Test

    node --test tests/scripts/bench-skill-evals-data.test.js
