# Frozen baselines for the quick check

33 baselines are copied from Michael Lin's `bench/baselines/` (pull requests #268 to #271, commit `33b385f9`), same repository, Apache-2.0. The skill folders are byte-identical to his. His other two, `asana-sprint-planning` and `adr-generator`, were retired on 2026-11-24 (owner decision, DEBT K-7): both skills were folded into others (`sprint-planning`, `decision-writing`), so their old tasks no longer test a skill; the merged skills get fresh baselines in the next approved baseline run. `MANIFEST.json` holds his hashes for them, plus one cap field, `identities`.

Each skill folder has `rules.json` (the skill's rules and the hash of the SKILL.md they came from) and two batches of 8 tasks (`tasks-<batch>.json`, with `.buckets.json` sidecars). A folder may also have `selection.json`, the requests for the selection test (`cap select`): at least 3 that should load the skill and 3 that should not, none naming it. None of the 35 has one yet; each is drafted and checked as the baseline rule in design 20.10 says.

## The check before every run

`cap/baselineverify.js` is his baseline verifier, ported. `cap keep-prune` runs it on the whole folder before it reads any baseline, and one problem anywhere refuses every run. It checks:

- only skill folders, `MANIFEST.json` and this README are here, and each file is `rules.json`, `tasks-<batch>.json` or `tasks-<batch>.buckets.json`;
- every file (`selection.json` included) is listed in the manifest with its hash, and every listed file exists;
- every file passes its format (`cap/baselineformats.js`) and agrees with the others: skill and batch names, rule ids, buckets, and the quotes of a current `rules.json` against `SKILL.md`;
- no file holds credential-shaped text, a home-directory path or a real-looking account number;
- a JSON file never repeats a key (`cap/checkedjson.js`);
- every baseline's skill exists in the tree, or `identities` maps it.

A task file whose `rules_sha256` differs from `rules.json` is stale, not broken: its reading B waits.

(`cap/baseline.js` is something else: the audit-lint ratchet.)

## Fresh or stale

A baseline is fresh only when the whole loaded unit is unchanged (`cap/subjectunit.js`). The unit is `SKILL.md`, every other file in the skill folder except `evals/`, and every file of another skill that `SKILL.md` names. A stale or unmapped baseline gives NO DATA, with the reason named.

His baselines hashed `SKILL.md` only (legacy). A legacy baseline is fresh only when `SKILL.md` is byte-identical and the unit is still `SKILL.md` alone. On the head that merged main on 2026-11-18 (`e5fa114c`, 80 skills), 1 of 35 is fresh (`frontend-review`) and 32 are stale, because main edited their skills. `asana-sprint-planning` was folded into `sprint-planning`, and `dynamodb-validation` was removed in #219. 47 skills have no baseline. Do not refresh stale baselines in place: a person writes and reviews new ones.

## Provenance fields for new baselines

- `rules.json` `source`: `commit` and `tree` (the Git commit and the skill folder's tree the rules were written from), and `subject` (the unit's `sha256`, `paths` and `unresolved` names).
- `MANIFEST.json` `sources.<skill>`: the same `commit`, `tree` and `subject_sha256`. The two must agree.
- `MANIFEST.json` `identities.<old name>`: `replaced_by`, `how` (`renamed` or `folded`), a `note`, and `migration` (`approved_by`, `date`, `note`). Until a person fills `approved_by` and `date`, the old name is NO DATA. Even after that, the old rules do not match the new unit, so the record stays stale until new rules and tasks are frozen. A skill removed with no successor in the tree has `how` `removed`, `replaced_by` null and a `note` saying where its job went; `cap keep-prune` and `cap select` refuse that name with the note, and every other baseline still runs.
