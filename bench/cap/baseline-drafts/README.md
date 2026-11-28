# Draft skill baselines (not frozen)

These are the five pilot baselines of the skill keep-or-prune restart (2026-11-28, DEBT K-1): `adversarial-design-review`, `design-quality-check`, `doc-accuracy-analyzer`, `threat-modeling` and `verification`. Each folder has the same files as a frozen baseline in `../baselines/`: `rules.json` (rules quoted from today's `SKILL.md`, with `source`), two batches of 8 tasks with their `.buckets.json`, and `selection.json` (5 requests that should load the skill and 5 near misses that should not, taken from `bench/skill-evals/skills/<name>/queries.json`).

No run reads this folder. `cap keep-prune` and `cap select` read `../baselines/` only. A draft moves there when a person who did not write it signs it off (workspace `reports/skill-baselines-pilot-2026-11-28.md`) and a second model family has checked its tasks.

Who wrote them: one Claude worker, by hand, with no model call. That makes them single-family drafts, so the second-family check is still owed (`cap skill-author --from-source FILE --review-only`, 2 paid calls a skill).

How they are made: never edit these files. Edit the skill's source in `../skill-sources/<skill>.json`, then run `node bench/runner/bench.js cap skill-author --skill NAME --from-source bench/cap/skill-sources/NAME.json`, which writes the folder and this `MANIFEST.json` and runs the verifier. The paid author writes the same files from its own source (design: `bench/docs/history/skill-author-design-2026-11-28.md`).

The check: `node --test bench/runner/test/kp-pilot-drafts.test.js` runs the frozen-baseline verifier (`cap/baselineverify.js`) on this folder and checks each draft matches its source.
