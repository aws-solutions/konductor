# Paired fill: no silent budget skips

A comparison needs both sides of a pair: the same task and replicate, run on the konductor arm and on the vanilla
arm. A budget can stop a run before it starts. bench then writes a `budget_skipped` result and moves on. Before this
page, the pilot table dropped those results without a word, so a batch could look finished with half a pair
missing. The 2026-11-21 LITE run lost 5 of 68 runs in its first replicate that way.

Paired fill fixes that in three parts.

## 1. Konductor first inside a pair

`bench run --pair-order konductor-first` is the default. Tasks run in a seeded random order. Inside each task,
every konductor arm runs before the vanilla arm, and several konductor arms take turns in a seeded order. When a
budget runs out partway through a task, the skip lands on the vanilla side. The arm under test is not the one left
out.

`--pair-order shuffle` keeps the order bench used before: one seeded order over every (task, arm) cell. Use it when a
study needs time drift spread evenly over the arms. `run-config.json` records the order a run used as `pairOrder`.

## 2. Fill skipped runs before the command ends

`bench run --budget-credits B --fill-skipped X` runs the batch under budget `B` as before. Then, before the command
ends, every cell left `budget_skipped` runs once more while this command's spend stays under `X`. The same budget rules
apply: the 90% guard, and no launch that the largest run so far could push past `X`. `X` must not be under `B`.

- Pass as `X` what the study's total cap still leaves. For example, with a 1,300-credit study cap, 452 already spent and
  a 25-credit margin, `X` is 823.
- A login or launch stop is never filled, because the next run would fail the same way.
- The skipped cell's folder is kept beside it as `<replicate>.resumed-N`, and its result becomes
  `attempt-result.json`, just as `--resume` does.
- `summary.json` gets a `fill` record: `{ budget, tried, filled, left }`. The log prints how many cells were filled
  and how many are still skipped.

`--resume` on the same `--out` still runs only the cells with no result or a `budget_skipped` one, so a fill can
always be finished later.

## 3. Skipped runs stay visible

`bench scenarios pilot-table` shows each `budget_skipped` run as a row, with no score and the skip reason in the
flags column. The batch summary has a `budget_skipped (runs)` column. The line under the table counts them apart from
the runs that ran.

A pair with one side run and the other skipped is **unpaired**. The table lists every unpaired pair. `pairedRows(rows)`
in `bench/scenarios/pilot-table.js` returns the rows of complete pairs only. A paired comparison reads those rows and
leaves an unpaired pair out until its skipped side is filled. `unpaired(rows)` gives the list itself.

The report and judge paths already count a `budget_skipped` run as a gap and leave it out of judging
(`exclusionClass` in the rubric policy).

## Example

```
node bench/runner/bench.js run --suite pilot --tasks t1-a,t1-b --arms vanilla,konductor=main \
  --budget-credits 45 --fill-skipped 823 --out runs/r1/t1
node bench/runner/bench.js scenarios pilot-table runs/r1/t1
```

## Tests

`bench/runner/test/paired-fill.test.js` covers the pair order, the raised budget, the flag checks, a fill pass that
fills a skipped cell, one too small to fill it, and the table rows, count and unpaired list. It needs no credits.
