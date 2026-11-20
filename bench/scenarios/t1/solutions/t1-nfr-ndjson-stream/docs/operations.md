# Operations notes

The report command reads a completed access-log export and writes a JSON file. It accepts plain NDJSON and `.gz` exports, counts malformed lines without stopping the job, and uses one read pass. The scheduler supplies a local path, and the command exits nonzero when the input cannot be opened.

Latency values are bounded to 0 through 60000 milliseconds. A compact per-endpoint histogram keeps the nearest-rank p50 and p95 values exact without retaining or sorting every request. This uses memory for endpoint groups and their fixed latency range, so unusually high endpoint cardinality should be monitored.

A report can be inspected with `python3 scripts/inspect_sample.py reports/sample.json`. The output is intended for a person, not as a stable machine API beyond the documented field names.
