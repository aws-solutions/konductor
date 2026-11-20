# Data format

The import format is a JSON object with an `invoices` array. Each item contains `id`, `currency`, `totalMinor`, `paidMinor`, and optionally `status`. Currency codes are uppercase in generated files, although the parser normalizes input codes.
