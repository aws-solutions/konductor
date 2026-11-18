# Spike: keyed contact dedupe

Throwaway spike. The code in `spike/` is not for production and changes nothing in `src/`.

## Question

Can another approach dedupe 50,000 contacts in under 300 ms on one core, with exactly the same output as `dedupe`
(same contacts kept, same order)? If yes, we change the import next sprint. If no, we split files.

## What was measured

Command: `node spike/run.js` (one JSON line per measurement). Data: `makeContacts(n, 1)`, where about one contact
in five repeats an earlier email with other case or spaces around it.

| approach | contacts | time | same output as `dedupe` |
|---|---|---|---|
| current `dedupe` | 5,000 | 503 ms | (reference) |
| keyed (Set of normalized email) | 5,000 | 1.4 ms | yes |
| keyed (Set of normalized email) | 50,000 | 14 ms | yes, checked against the first-email rule |

The current version is quadratic: 141 ms at 2,500 and 503 ms at 5,000, so 50,000 would take about 50 s. It was
not run at 50,000. The keyed version uses the same `normalizeEmail` (trim, lower case). A Set of the raw email
keeps the wrong contacts, because the data repeats emails with other case and spaces.

## Recommendation

Use the keyed version: 14 ms at 50,000 contacts is well under the 300 ms budget, with the same output.

Limits of this measurement:

- One laptop, warm runs (best of 5); a cold first call is slower.
- Synthetic data; real files may have longer emails or more duplicates.
- Only time was measured, not memory (the Set holds one key per unique contact).

Next step: run the keyed version on last month's largest real upload before the change ships.

## Assumptions

- "Same output" means the same contacts in the same order, so the first contact of each email is kept.
