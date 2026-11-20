# Changelog

## 0.4.1 - 2025-03-27
- `readRecords` pads short rows with empty strings instead of leaving the key out.
- Fix: a quote that ended exactly at a chunk boundary was dropped when the next chunk started with a quote.

## 0.4.0 - 2025-03-14
- `infer.js`: calendar check for dates, so `2025-02-30` is text.
- `infer.js`: `createInferrer()` so callers can feed cells one at a time instead of keeping a list.
- Cells that are only whitespace now count as empty.

## 0.3.2 - 2025-02-21
- `csv.js`: strip a UTF-8 byte order mark from the first chunk.
- `gen-sample.js`: samples now include quoted fields with line breaks.

## 0.3.0 - 2025-02-10
- Integers with a leading zero (`007`, `00123`) are text. Identifiers such as bin codes and account numbers lost their zeros when treated as numbers.
- `gen-sample.js` now takes seeds from constants, not the clock.

## 0.2.0 - 2025-01-29
- First streaming reader. Replaces the split-on-newline version, which broke on quoted line breaks.
- First version of `infer.js` (integer, decimal, text).

## 0.1.0 - 2025-01-13
- Repo created. Split-on-comma prototype, no tests.
