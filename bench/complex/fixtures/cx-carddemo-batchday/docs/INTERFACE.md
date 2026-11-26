# Interface: command line, files and layouts

This file fixes what a user can see. `REQUIREMENTS.md` says what the jobs must do.
Where `REQUIREMENTS.md` points to the layouts (M2), they are the ones below.
Standard library only. Run from the repository root.

## Commands

```
python3 -m carddemo_port post     --in DIR --out DIR
python3 -m carddemo_port interest --in DIR --out DIR [--run-date YYYY-MM-DD]
python3 -m carddemo_port report   --in DIR --out DIR --start YYYY-MM-DD --end YYYY-MM-DD
python3 -m carddemo_port statements --in DIR --out DIR
```

The four jobs run in a chain: `post` makes `transact.txt` and `acctdata.txt`; `report` reads a `transact.txt` (the one
`post` wrote, or any other), and `statements` reads a `transact.txt` and an `acctdata.txt`. The caller copies files
between directories; no job reads another job's output directory.

`--start` and `--end` are dates in the same form and are required for `report`; a value that is not a real date, or a
`--start` after `--end`, is a usage error. The other three commands take no `--start` or `--end`; giving one is a usage
error.

`--run-date` is the date used in the interest transaction ids. If it is left out, it is today's date
(local time). A value that is not a real date in that form is a usage error.

| Exit code | Meaning |
|---|---|
| 0 | The run finished. |
| 4 | `post` only: the run finished and at least one transaction was rejected. |
| 2 | Bad input, a missing rate, a usage error, or an output directory that cannot be used. |

Standard output has one line `name: value` for each count in the summary (below).
Standard error has one line starting `error:` for a failed run. A failed run for a bad record names
the file and the line as `<file> line <n>`. Neither stream ever shows a card number, an amount or a customer name.

## Input files

All files are in `--in DIR` with these fixed names. Other files in DIR are ignored.
A missing file is bad input, and the error names the missing file.

| Job | Files |
|---|---|
| `post` | `dailytran.txt`, `cardxref.txt`, `acctdata.txt`, `tcatbal.txt` |
| `interest` | `tcatbal.txt`, `discgrp.txt`, `acctdata.txt`, `cardxref.txt` |
| `report` | `transact.txt`, `cardxref.txt`, `trantype.txt`, `trancatg.txt` |
| `statements` | `transact.txt`, `cardxref.txt`, `custdata.txt`, `acctdata.txt` |

Each line is one record, with no separator. Lines end with `\n`.
A line shorter than the record is padded on the right with blanks before it is read, so trailing
blanks may be missing. A longer line is bad input. A bad number (see below) is bad input.
A key that appears twice in `acctdata.txt` (account id), `cardxref.txt` (card number),
`tcatbal.txt` (account, type, category) or `discgrp.txt` (group, type, category) is bad input.
Duplicate transaction ids in `dailytran.txt` are not bad input: P7 handles them. A key that appears twice in
`trantype.txt` (type), `trancatg.txt` (type, category) or `custdata.txt` (customer id) is bad input.

## Layouts

Widths are in characters. `n` is digits only. `x` is text: blanks on the right are dropped when
read and added when written. `s` is a signed number with 2 implied decimals (the zoned form, M2).
A digit field that holds anything but digits is bad input, and so is a blank one.

| File | Record | Fields |
|---|---|---|
| `acctdata.txt` | 300 | id 11 n, status 1 x, balance 12 s, credit limit 12 s, cash limit 12 s, open date 10 x, expiry date 10 x, reissue date 10 x, cycle credit 12 s, cycle debit 12 s, zip 10 x, group 10 x, filler 178 |
| `cardxref.txt` | 50 | card 16 x, customer 9 n, account 11 n, filler 14 |
| `tcatbal.txt` | 50 | account 11 n, type 2 x, category 4 n, balance 11 s, filler 22 |
| `discgrp.txt` | 50 | group 10 x, type 2 x, category 4 n, rate 6 s, filler 28 |
| `dailytran.txt` | 350 | id 16 x, type 2 x, category 4 n, source 10 x, description 100 x, amount 11 s, merchant id 9 n, merchant name 50 x, merchant city 50 x, merchant zip 10 x, card 16 x, original timestamp 26 x, processed timestamp 26 x, filler 20 |

The new files are laid out by the COBOL copybooks in `cobol/cpy/`, one record per line, read as the notes above say
(a short line is padded, a longer one is bad input):

| File | Record | Copybook |
|---|---|---|
| `transact.txt` | 350 | `CVTRA05Y` (the same layout as `dailytran.txt`) |
| `trantype.txt` | 60 | `CVTRA03Y` |
| `trancatg.txt` | 60 | `CVTRA04Y` |
| `custdata.txt` | 500 | `CUSTREC` |

Dates are `YYYY-MM-DD`. Timestamps are `YYYY-MM-DD HH:MM:SS.ffffff` (26 characters).
The rate is a yearly percent with 2 implied decimals (`001800` is 18.00 percent).
A control character in a text field is bad input.

## Output

`--out DIR` must not exist or must be an empty directory. Anything else is a failed run and DIR is
left as it was. The parent of DIR must exist. A failed run writes nothing: DIR is not created, and
no temporary file or directory is left next to it.

Output records are full width, padded with blanks, one per line, each line ending in `\n`.
A file with no records is an empty file. Every file below is always written.

`post` writes:

| File | Content |
|---|---|
| `transact.txt` | The posted transactions, in input order (P11). |
| `dalyrejs.txt` | The rejected transactions, in input order (P12): the 350 characters of the daily record, a 4-digit code, then the description padded to 76 characters. |
| `acctdata.txt` | Every input account, updated, in order of account id. |
| `tcatbal.txt` | Every input category balance row and every row created by posting, in order of (account, type, category). |
| `summary.json` | One JSON object: `processed`, `posted`, `rejected`, all integers (P13). |

`interest` writes:

| File | Content |
|---|---|
| `transact.txt` | The interest transactions in id order (I5, I6). |
| `acctdata.txt` | Every input account, updated, in order of account id. |
| `summary.json` | One JSON object: `interest_transactions` (the number written) and `accounts` (the number of account records written), both integers. |

An interest transaction has these fields: id (I6), type `01`, category `0005`, source `System`,
description `Int. for a/c <account>`, the amount, merchant id `000000000`, merchant name, city and
zip blank, the card, and the run clock in both timestamps. The run clock is the local time when the
job starts. A posted transaction has the run clock in its processed timestamp.

`report` writes:

| File | Content |
|---|---|
| `report.txt` | The report of `CBTRN03C`, one 133-character line per record (`CVTRA07Y` gives the line layouts). |
| `summary.json` | One JSON object: `detail_lines`, the number of transaction lines in the report (an integer). |

`statements` writes:

| File | Content |
|---|---|
| `statement.txt` | The statements of `CBSTM03A`, one 80-character line per record. |
| `statement.html` | The HTML of `CBSTM03A`, one 100-character line per record. |
| `summary.json` | One JSON object: `statements` (statements written), `transactions` (transaction lines in them) and `skipped` (cards given no statement), all integers. |
