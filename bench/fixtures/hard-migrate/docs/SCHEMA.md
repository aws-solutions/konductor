# Orders: schema 1 and schema 2

Files are JSON Lines: one JSON object per line.

## Schema 1

```json
{"id":"o-1001","customer":"Ann Lee","total":19.99,"placed":"03/14/2024","status":"SHIPPED","address":"12 Main St, Springfield, IL 62704"}
```

## Schema 2

```json
{"schema":2,"id":"o-1001","customer":"Ann Lee","totalCents":1999,"placedAt":"2024-03-14","status":"shipped","address":{"street":"12 Main St","city":"Springfield","region":"IL","postalCode":"62704"}}
```

## Field rules for `up`

- `id` and `customer` are required non-empty strings. Any other field not listed here is copied unchanged.
- `total` is a number or a numeric string of major units, not negative. `totalCents` is the amount rounded
  half up to whole cents, computed on the decimal value as written (so 1.005 is 101 cents and 19.99 is 1999).
- `placed` is `MM/DD/YYYY` and must be a real calendar date (February 29 only in leap years).
  `placedAt` is `YYYY-MM-DD`. No time zone is involved.
- `status` is matched ignoring case and written in lower case: NEW to new, PAID to paid, SHIPPED to shipped,
  DONE to delivered, CANCELLED or CANCELED to cancelled. Anything else is rejected.
- `address` is `street, city, ST 12345` or `street, city, ST 12345-6789`: the last comma-separated part is
  the two-letter upper-case region, a space and the postal code. The part before it is the city and
  everything before that, rejoined with `, `, is the street.

## Files

- `orders.jsonl` is rewritten in place. Records come out in the same order, as compact JSON, each line ending
  in `\n`. Blank lines are dropped. A record that is already schema 2 (`"schema":2`) is left as it is.
- A line that cannot be converted stays in `orders.jsonl` unchanged except that its line ending becomes `\n`.
  It is also listed in `rejects.jsonl`, one JSON object per line: `{"line":N,"reason":"...","raw":"..."}`.
  `line` is the 1-based physical line number in the file as it was read, `raw` is the line without its
  line ending. `rejects.jsonl` is rewritten by every `up` and does not exist when nothing was rejected.
- Reasons: `invalid json`, `missing field: id`, `missing field: customer`, `invalid total`, `invalid date`,
  `unknown status`, `invalid address`, `duplicate id`. When several apply, the first in that order is used.
  A second record with an id that appeared earlier is rejected as `duplicate id`.
- `orders.v1.bak` holds the file exactly as it was before the first `up`. It is created once and never
  overwritten while it exists.
- `.migration-state.json` records `{"backupSha256","resultSha256"}`: the hashes of the backup and of
  `orders.jsonl` as `up` last left it.

## Commands

`node bin/migrate.js <up|down> --dir DIR [--dry-run] [--force]`

Exit codes: 0 success, 2 usage error or a missing file, 3 refused.

### up

- Prints `{"migrated":N,"skipped":M,"rejected":K}` on stdout. `skipped` counts records already in schema 2.
- Running `up` again on migrated data changes nothing on disk: same bytes, the backup untouched.
- All writes are atomic: each file is written to a temporary file in the same directory and renamed.
  Nothing but the files named above is left in the directory.
- With `--dry-run` it prints the same summary and writes nothing.

### down

- Restores `orders.jsonl` from `orders.v1.bak` byte for byte, then deletes `orders.v1.bak`,
  `rejects.jsonl` and `.migration-state.json`, and prints `{"restored":true}`.
- If the backup or the state file is missing it exits 2 and changes nothing.
- If `orders.jsonl` no longer matches `resultSha256` (it was edited after `up`) it exits 3 and changes
  nothing, unless `--force` is given.
- With `--dry-run` it only reports what it would do and writes nothing.
