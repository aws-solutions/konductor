# Operations notes

The report command reads a completed access-log export and writes a JSON file. The scheduler supplies a local path, and the command exits nonzero when the input cannot be opened. Keep raw exports outside version control and retain reports for the same period as the source logs.

A report can be inspected with `python3 scripts/inspect_sample.py reports/sample.json`. The output is intended for a person, not as a stable machine API beyond the documented field names.
