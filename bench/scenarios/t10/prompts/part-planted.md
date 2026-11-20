## PLANTED.md (step A only)

Also write `PLANTED.md` outside `fixture/`. Another person writes the hidden tests, the keys and the reference solution from this file and the fixture alone, so it must be exact. It has these parts:
1. `## Interface`: every interface the request promises (paths, signatures, error shapes, routes, config keys), as the hidden tests will call them.
2. `## Traps`: one short paragraph per planted trap: where it is (file and lines), what a careless answer does wrong, what a careful one does, and which behaviour test or document statement would catch it. Plant {{NTRAP}} traps. At least two are about behaviour (a boundary, a race, a time or unit rule, old data), at least two are about facts the design note and the rollout plan must state correctly (an existing helper to reuse, a partner that depends on old behaviour, a metric name that exists or does not, a ring order, a naming rule).
3. `## Decisions`: the 3 to 5 real design questions the feature raises, the answer you consider best, and the best rejected alternative with its reason.
4. `## Reference`: which files the reference solution changes or adds (names only), so the other person can write them.
