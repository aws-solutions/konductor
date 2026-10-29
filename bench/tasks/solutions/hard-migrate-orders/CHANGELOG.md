# Changelog

## Unreleased

- Add `down`, `--dry-run` and `--force`.
- `up` is idempotent and never overwrites an existing backup; it records `.migration-state.json`.
- All writes are atomic.
- Fix cents conversion (19.99 was 1998; now rounded half up on the decimal value).
- Fix date conversion: real calendar dates only, no time zone shifts.
- Fix address parsing for streets with commas and ZIP+4 codes.
- Rejects now carry the reasons listed in docs/SCHEMA.md; blank lines are dropped and CRLF input is handled.

## 0.3.0

- `up` writes `rejects.jsonl`.

## 0.2.0

- `up` keeps a backup of the original file.
