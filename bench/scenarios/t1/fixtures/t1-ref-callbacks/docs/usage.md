# Usage notes

The input folder is scanned once. Names ending in `.txt` are selected case-sensitively and sorted before work begins. The output folder is created when necessary.

The `--concurrency` value controls how many files may be active at once. It defaults to two. `--retries` controls additional write attempts and defaults to zero.

A record contains the source basename, its non-empty lines, line count, word count, and character count. The JSON is formatted with two-space indentation so it is friendly to reviews.
