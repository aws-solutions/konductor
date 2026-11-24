# Nightly reporting job

The job starts at 01:00 UTC and runs five stages in order:

1. `extract` reads the warehouse snapshot.
2. `dedupe` removes duplicate records.
3. `enrich` adds lookup attributes.
4. `aggregate` builds reporting totals.
5. `publish` makes the report available to consumers.

The stage records in the nightly logs include the UTC start and end, row count, and worker messages. The input row history is in `data/volumes.csv`; service-level measurements are in `metrics/nightly.csv`.
