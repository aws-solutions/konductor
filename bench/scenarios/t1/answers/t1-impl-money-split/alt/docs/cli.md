# Command line utility

The executable is available as `node bin/billing.js`. `list --file path` prints the identifiers and balances in a JSON data file. `format --amount 1234 --currency USD` formats a minor-unit amount for the current locale.

The command exits nonzero for malformed arguments or unreadable files. Output intended for scripts is JSON, while `format` prints one human-readable line.

## Allocation commands

`split --amount MINOR --currency CODE --weights id=weight,...` splits an amount by weights and prints JSON rows `{id, minor, currency}`.

`allocate --amount MINOR --currency CODE --invoices id=due,...` allocates a payment across invoices and prints JSON rows `{id, minor, currency}`.

Both commands use largest remainder placement and sort results by id. When remainders tie, the lexicographically smallest id receives the extra minor unit.

