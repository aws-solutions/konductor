# Feasibility: can the import preview show column types from the first 500 rows?

Question for the 7 April design review: does the premise in `docs/product-one-pager.md` hold?

> The import preview can show the inferred column types after reading only the first 350 rows,
> because column types are stable across a file.

## What I did

`spike/measure.js` reads a CSV with the repo's own reader (`lib/csv.js`) and infers each column with
`lib/infer.js` (the cell-by-cell rule, not a fresh one). It records the type after 350 rows, then the first
data row, counting from 1 and not counting the header, where the type from all rows so far differs from that.
Run it as `node spike/measure.js data/sample-c.csv`. I did not change `lib/` or `data/`.

## Results

| File | Rows | Columns that change type after row 350 |
| --- | --- | --- |
| `sample-a.csv` | 21000 | none |
| `sample-b.csv` | 25200 | none |
| `sample-c.csv` | 29400 | `weight_kg` at row 15074 (integer to decimal), `bay` at row 18717 (integer to text), `delivered_on` at row 21907 (date to text) |

## Where a quick reading goes wrong

- Row numbers: sample-c has quoted line breaks inside `service_note`, so its line count (29430 lines with
  the header) is not its row count. The script counts records, not lines.
- `bay` changes when `5` appears. Read as a number, `5` is 7 and nothing changes. `infer.js` treats a
  leading zero as text (CHANGELOG 0.3.0), so the column becomes text at row 18717.
- Sample-b has long runs of empty cells in `discount` (rows 2,0 to 9,349, some of them only a space) and
  mixes `5` and `9` in `weight_kg`. Counting an empty cell as text, or comparing each cell's own type
  with the first one, reports drift there. By the repo rule empties are ignored and a column that has seen a
  decimal stays decimal, so neither column drifts.
- `bin_code` in sample-b is zero-padded (`5`, `22`) from row 1 and so is text throughout. It does not drift.

## What this does and does not show

All three files are synthetic (`tools/gen-sample.js`), so the counts say what can happen, not how often it happens
in customer files. Support notes suggest it does happen: 8 of 43 import tickets in the first quarter were
"rejected for the wrong type partway through", and Ines Okafor thinks about one file in ten has pasted-together
sections. Neither number says where in the file the change sits. Two of three samples is not a rate.

## Recommendation

Do not build the preview as drawn, with types shown as final after 350 rows. Build it so the types are provisional:
show the first 350 rows with the types read from them, keep reading the rest of the file in the background with
the same rule, and raise a warning on the column (and the first row where it changes) as soon as a later row
breaks the type, before the user confirms. Let the user override a type, including a text/identifier choice.
Do not change the 350; it is not what decides whether the premise holds.

## Conditions

The premise holds only when no column changes type after row 350. That is true of sample-a and sample-b and
cannot be known from the first 350 rows of an unseen file. The conditions for showing types as settled are
in the block below.

```json
{
 "premise": "The import preview can show the inferred column types after reading only the first 500 rows, because column types are stable across a file.",
 "verdict": "rejected",
 "evidence": [
  {
   "file": "data/sample-a.csv",
   "rows": 21000,
   "first_drift_rows": {
    "order_id": null,
    "customer_ref": null,
    "qty": null,
    "unit_price": null,
    "ordered_on": null,
    "status": null,
    "coupon": null
   }
  },
  {
   "file": "data/sample-b.csv",
   "rows": 25200,
   "first_drift_rows": {
    "sku": null,
    "bin_code": null,
    "on_hand": null,
    "reorder_level": null,
    "unit_cost": null,
    "weight_kg": null,
    "discount": null,
    "counted_on": null,
    "supplier_note": null
   }
  }
 ],
 "recommendation": "A preview built from the first 500 rows cannot be shown as final. Show the preview types as provisional: read the whole file in the background with the same inference rule and warn on a column, with the first row where it changes, before the user confirms. Do not rely on a larger first-rows window; in sample-c the first change is at row 21,535 and the last at row 31,296.",
 "conditions": [
  "Holds only for files in which no column changes type after row 500 (true of sample-a and sample-b, false for sample-c).",
  "Whether a file qualifies cannot be known from its first 500 rows, so the types are shown as final only after a full pass over the file has found no change."
 ]
}
```
