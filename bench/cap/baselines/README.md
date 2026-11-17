# Frozen baselines for the quick check

Copied from Michael Lin's `bench/baselines/` (pull requests #268 to #271, commit `33b385f9`), same repository, Apache-2.0. The files are not edited: `MANIFEST.json` holds his hashes for them, and `cap/frozen.js` refuses any file that differs.

Only `plan-review` is copied so far, as the phase A pilot: its `rules.json` was written from the `skills/plan-review/SKILL.md` now in the repository, so reading B is current. His other 34 baselines are copied in phase D, after a person reviews their model-written tasks.

Each skill folder has `rules.json` (the skill's rules and the hash of the SKILL.md they came from) and two batches of 8 tasks (`tasks-<batch>.json`, with `.buckets.json` sidecars).
