# loadbay-import

The CSV import service behind Loadbay's "Import data" screen. This repo holds the parts we
can build and test without the web app: the row reader and the column type inference.

## Layout

| Path | What it is |
| --- | --- |
| `lib/csv.js` | Streaming CSV reader (`readRows`, `readRecords`). Reads a path or a stream, never loads the whole file. |
| `lib/infer.js` | Decides a column type (`integer`, `decimal`, `date`, `text`) from the cells seen so far. The rules are written at the top of the file. |
| `tools/gen-sample.js` | Seeded generator for the three synthetic files in `data/`. Re-running it gives identical bytes. |
| `data/` | `sample-a.csv`, `sample-b.csv`, `sample-c.csv`. Synthetic, tens of thousands of rows each. No customer data lives in this repo. |
| `test/` | Unit tests for the reader and the inference. |
| `docs/` | One-pager, meeting and interview notes, support notes, older drafts, team handbook excerpts. |

## Running things

```
npm test                       # node --test, no dependencies to install
node tools/gen-sample.js       # rewrite data/sample-*.csv
```

Needs Node.js 24. There is nothing to `npm install`.

## Status

The preview screen is at the design stage. Nothing in this repo is wired to it yet. The
one-pager in `docs/product-one-pager.md` says what we want the screen to do; work on the
reader and inference so far is in `CHANGELOG.md`.

## Conventions

- Row numbers are 1-based and do not count the header line.
- Spikes and experiments go in their own top-level folder, not in `lib/`. See
  `docs/handbook/spike-policy.md`.
