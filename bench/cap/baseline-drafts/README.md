# Draft skill baselines (not frozen)

These are the five pilot baselines of the skill keep-or-prune restart (2026-11-28, DEBT K-1): `adversarial-design-review`, `design-quality-check`, `doc-accuracy-analyzer`, `threat-modeling` and `verification`. Each folder has the same files as a frozen baseline in `../baselines/`: `rules.json` (rules quoted from today's `SKILL.md`, with `source`), two batches of 8 tasks with their `.buckets.json`, and `selection.json` (5 requests that should load the skill and 5 near misses that should not, taken from `bench/skill-evals/skills/<name>/queries.json`).

No run reads this folder. `cap keep-prune` and `cap select` read `../baselines/` only. A draft moves there when a person who did not write it signs it off (workspace `reports/skill-baselines-pilot-2026-11-28.md`) and a second model family has checked its tasks.

Who wrote them: one Claude worker, by hand, with no model call. That makes them single-family drafts, so the second-family check is still owed.

The check: `node --test bench/runner/test/kp-pilot-drafts.test.js` runs the frozen-baseline verifier (`cap/baselineverify.js`) on this folder, with `MANIFEST.json` here holding the hashes and sources. Edit a file and the test fails until the manifest is updated.
