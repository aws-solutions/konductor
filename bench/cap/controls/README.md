# Keep-or-prune controls

Copied from Michael Lin's work in this repository (Apache-2.0), commit `33b385f9`. The dose ladder is not edited, so its hash still matches his.

The convention control was edited on 23 Nov 2026, after pilot 1 found it no longer neutral (`reports/pilot-diagnosis-2026-11-23.md`):

| Change | Why |
| --- | --- |
| Task dates moved from 2026 to 2037 (same days and months) | The 2026 dates had passed, so the model added `[CONFIRM]` placeholders. A test now fails when any task date is before the run date (`kp-control-dates.test.js`). |
| Every task prompt ends with one line: take the dates and facts as given | Both arms now get the same instruction about placeholders. |
| Guard rule r06 in `SKILL.md` now restates that line | The old r06 ("not placeholders") reached the skill arm only, which suppressed the placeholders in one arm. |
| `rules.json` and the task file carry the new hashes | The hashes follow the edited files. |

These files are bench fixtures only. They are not a Konductor skill.

| File | What it is | His source |
| --- | --- | --- |
| `dose-ladder-v1.json` | Authored answer pairs with 0, 1, 2 and 4 planted defects. The judges must rank them in order. | `scripts/bench/controls/dose-ladder-v1.json`, pull request #251 |
| `convention-control/SKILL.md` | A skill of five harmless, made-up conventions and one guard rule. Its known effect: reading B gains, reading A does not move. | `scripts/bench/skills/convention-control/SKILL.md`, pull request #266 |
| `convention-control/rules.json`, `tasks-convention-control*.json` | Its rules and its 8 tasks. | `scripts/bench/controls/convention-control/`, pull request #266 |

`cap keep-prune` runs both in every check (`cap/keepprune.js`). The pass rules are in `cap/passrules.js`. The SKILL.md still points at his README for the background; that text is part of the hashed file, so it stays.
