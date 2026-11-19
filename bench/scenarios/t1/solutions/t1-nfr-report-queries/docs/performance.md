# Report performance

The report reads the customer and order data with one ordered join and hands the database cursor directly to the formatter. CSV and JSON writers consume iterators, so report size does not require a second in-memory copy of every row.

The job keeps the existing six output columns, ordering, encoding, and trailing newline. The CLI still accepts `--db`, `--month`, `--format`, and `--output`; month values must use `YYYY-MM` form.
