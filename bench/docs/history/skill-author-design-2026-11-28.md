# Skill baseline author (`cap skill-author`): design note, 2026-11-28

BACKLOG B-027. No tool wrote skill baselines: 33 frozen baselines, 0 fresh, none with a `selection.json` (workspace `reports/physical-ai-gap-audit-2026-11-28.md`). This note says what the author takes in, what it writes, and how the result is checked for free.

## What it writes

One draft baseline folder per skill, in `bench/cap/baseline-drafts/<skill>/`, in the frozen format (`bench/cap/baselines/README.md`): `rules.json` with `source`, `tasks-<batch>.json` and `.buckets.json` for two batches of 8, and `selection.json`. The drafts folder has its own `MANIFEST.json` (hashes and `sources`). No run reads drafts; a person signs one off and it moves to `bench/cap/baselines/` (the move is DEBT D-306).

## One source format, two ways to fill it

Everything goes through a **source** file, one JSON per skill (`cap/skillsource.js`):

```json
{ "skill": "NAME", "request_context": "...", "writtenBy": "who wrote it",
  "selection": { "load": [0, 1], "none": [10, 11] },
  "rules": [{ "c": "useful|style|generic", "q": "verbatim SKILL.md quote", "o": "outcome", "w": "why", "h": "scenario hint" }],
  "batches": { "pilot-a": [{ "title": "...", "section": "...", "prompt": "...", "rubric": [[2, "check text"]], "why": "..." }] } }
```

A rubric item is `[rule number, text]`: the number is the rule's place in `rules` (1 is the first), so the bucket sidecar is derived, never written by hand. `selection` picks indexes from `bench/skill-evals/skills/<skill>/queries.json` (the `should_trigger` true ones as `load`, false as `none`); with no `selection`, the first 5 of each kind that do not name the skill are taken.

1. **By hand, free**: `cap skill-author --skill NAME --from-source FILE`. The 5 pilot drafts of 2026-11-28 were written this way.
2. **By two model families, paid**: `cap skill-author --skill NAME --work DIR --ledger FILE --cap N`. The writer (glm-5) and reviewer (deepseek-3.2) are two families, neither Claude. Steps, each one paid call through `cap/paidcall.js` (15 counted credits reserved before each, resumable from saved replies):
   - `rules`: the writer reads SKILL.md and returns 8 to 16 rules with verbatim quotes;
   - per batch, `write`, `review`, then `fix` and `recheck` only when a task failed. The one-fix rule of `cap unit-author` holds: a task that fails its recheck is dropped and recorded, never fixed by hand.
   
   At most 9 calls a skill (1 + 2 x 4), 135 counted credits. `--dry-run` prints the steps and the worst case and calls nothing. The writer's reply becomes a source file in the work dir, then step 1 runs on it.
3. **Second-family check of a hand draft, paid**: `--review-only`: the reviewer reads each batch of an existing source (2 calls a skill); a failed task is dropped and recorded, with no fix, since its writer is not on the panel. This is step A of the pilot plan (BACKLOG B-029).

## Free checks, before any person reads it

- Each rule's quote must appear in today's SKILL.md; the paid path drops a rule that fails and records it (free, no call).
- Each task passes the frozen format: at least 45 words, 5 to 8 checks, no skill name, rule id or rule quote in the prompt, checks only on kept rules (not `style`). In the paid path a task that fails this is sent to the fix step with the format messages as its note, so it costs no extra call.
- The whole drafts folder passes `cap/baselineverify.js`, the same check every frozen baseline passes (hashes, cross-file ids, secrets, provenance). A source that fails writes nothing.

Tested on a fake kiro-cli (`bench/runner/test/fake-kp-kiro.js`) in `cap-skill-author.test.js`.

## Not in this step

The move from drafts to frozen with a sign-off name, and `--baselines DIR` on `cap select` and `cap keep-prune` (DEBT D-306).
