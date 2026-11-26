# carddemo-port

Python port of two CardDemo batch jobs: post daily card transactions, and add monthly interest.
Stub-only. No AWS, no network, no model. Standard library only (Python 3.9+).

The rules are in `docs/REQUIREMENTS.md`. The command line, file names and layouts are in `docs/INTERFACE.md`.

## Run

```
python3 -m unittest discover -s tests -t .
python3 -m carddemo_port post --in data --out /path/to/new-dir
python3 -m carddemo_port interest --in DIR --out /path/to/new-dir --run-date 2026-11-25
```

`post` exits 4 if it rejected any transaction. Bad input exits 2 and writes nothing.

## Provenance and licence

`cobol/` and `data/` come from
[aws-samples/aws-mainframe-modernization-carddemo](https://github.com/aws-samples/aws-mainframe-modernization-carddemo)
(Apache-2.0); see `NOTICE`. The rules in `docs/REQUIREMENTS.md` are ours. The COBOL was read for the file layouts and to find
where it is silent or odd. Those places are the rules marked REVIEW:

| Rule | COBOL | This port |
|---|---|---|
| P5 over-limit | subtracts the (negative) debit, so payments count as charges | nets payments against charges (approved) |
| P7 duplicates | none (a duplicate key would stop the job) | reject 104 |
| I3 rounding | truncates | truncates toward zero (approved, matches COBOL) |
| I4 credit balance | would make negative interest | no interest (approved) |
| I2 no DEFAULT rate | stops the job | stops the run, writes nothing |
| Fees | empty stub | none |

All REVIEW rules are approved as written by the owner (I3 switched to truncation). Results are tagged with the rule version (see INTEREST_RULE).

## Open risks

- Replaying the same input twice posts it twice. The operator must prevent it.
