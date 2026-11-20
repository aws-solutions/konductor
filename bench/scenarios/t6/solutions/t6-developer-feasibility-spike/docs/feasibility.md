# Feasibility: can the import preview show column types from the first 500 rows?

Question for the 10 April design review: does the premise in `docs/product-one-pager.md` hold?

> The import preview can show the inferred column types after reading only the first 500 rows,
> because column types are stable across a file.

**Answer: no, not in general.** It held on two of the three sample files and failed on the third. It holds
only for files whose columns keep their type after row 500, and the first 500 rows cannot tell us which
files those are.

## What I did

`spike/measure.js` reads a CSV with the repo's own reader (`lib/csv.js`) and infers each column with
`lib/infer.js` (the cell-by-cell rule, not a fresh one). It records the type after 500 rows, then the first
data row, counting from 1 and not counting the header, where the type from all rows so far differs from that.
Run it as `node spike/measure.js data/sample-c.csv`. I did not change `lib/` or `data/`.

## Results

| File | Rows | Columns that change type after row 500 |
| --- | --- | --- |
| `sample-a.csv` | 30,000 | none |
| `sample-b.csv` | 36,000 | none |
| `sample-c.csv` | 42,000 | `weight_kg` at row 21,535 (integer to decimal), `bay` at row 26,739 (integer to text), `delivered_on` at row 31,296 (date to text) |

Three of the nine columns in sample-c change type, and the earliest change is 21,535 rows after the 500th.
Raising 500 to 1,000 or even 20,000 would still show those three columns with the wrong type. A window that catches all
three would have to reach row 31,296, which is 75% of that file, so a bigger window is not a fix.

## Where a quick reading goes wrong

- Row numbers: sample-c has quoted line breaks inside `service_note`, so its line count (42,043 lines with
  the header) is not its row count. The script counts records, not lines.
- `bay` changes when `007` appears. Read as a number, `007` is 7 and nothing changes. `infer.js` treats a
  leading zero as text (CHANGELOG 0.3.0), so the column becomes text at row 26,739.
- Sample-b has long runs of empty cells in `discount` (rows 2,000 to 9,499, some of them only a space) and
  mixes `5` and `12.7` in `weight_kg`. Counting an empty cell as text, or comparing each cell's own type
  with the first one, reports drift there. By the repo rule empties are ignored and a column that has seen a
  decimal stays decimal, so neither column drifts.
- `bin_code` in sample-b is zero-padded (`007`, `031`) from row 1 and so is text throughout. It does not drift.

## What this does and does not show

All three files are synthetic (made by a seeded generator), so the counts say what can happen, not how often it happens
in customer files. Support notes suggest it does happen: 11 of 61 import tickets in the first quarter were
"rejected for the wrong type partway through", and Ines Okafor thinks about one file in ten has pasted-together
sections. Neither number says where in the file the change sits. Two of three samples is not a rate.

## Recommendation

Do not build the preview as drawn, with types shown as final after 500 rows. Build it so the types are provisional:
show the first 500 rows with the types read from them, keep reading the rest of the file in the background with
the same rule, and raise a warning on the column (and the first row where it changes) as soon as a later row
breaks the type, before the user confirms. Let the user override a type, including a text/identifier choice.
Do not change the 500; it is not what decides whether the premise holds.

Needs from design (Priya): a state for "the type changed after the preview".

## Conditions

The premise holds only when no column changes type after row 500. That is true of sample-a and sample-b and
cannot be known from the first 500 rows of an unseen file. The conditions for showing types as settled are
in the block below.

```json
{
  "premise": "The import preview can show the inferred column types after reading only the first 500 rows, because column types are stable across a file.",
  "verdict": "rejected",
  "evidence": [
    { "file": "data/sample-a.csv", "rows": 30000, "first_drift_rows": { "order_id": null, "customer_ref": null, "qty": null, "unit_price": null, "ordered_on": null, "status": null, "coupon": null } },
    { "file": "data/sample-b.csv", "rows": 36000, "first_drift_rows": { "sku": null, "bin_code": null, "on_hand": null, "reorder_level": null, "unit_cost": null, "weight_kg": null, "discount": null, "counted_on": null, "supplier_note": null } },
    { "file": "data/sample-c.csv", "rows": 42000, "first_drift_rows": { "parcel_id": null, "depot": null, "weight_kg": 21535, "bay": 26739, "declared_value": null, "cod_amount": null, "scanned_on": null, "delivered_on": 31296, "service_note": null } }
  ],
  "recommendation": "A preview built from the first 500 rows cannot be shown as final. Show the preview types as provisional: read the whole file in the background with the same inference rule and warn on a column, with the first row where it changes, before the user confirms. Do not rely on a larger first-rows window; in sample-c the first change is at row 21,535 and the last at row 31,296.",
  "conditions": [
    "Holds only for files in which no column changes type after row 500 (true of sample-a and sample-b, false for sample-c).",
    "Whether a file qualifies cannot be known from its first 500 rows, so the types are shown as final only after a full pass over the file has found no change.",
    "Until that pass finishes the preview labels the types provisional and shows a warning, with the first row, if a later value breaks the type.",
    "Inference uses the repo rule in lib/infer.js: empty cells are ignored and a leading zero such as 007 makes a column text."
  ]
}
```
