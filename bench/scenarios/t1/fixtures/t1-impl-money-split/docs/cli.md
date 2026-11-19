# Command line utility

The executable is available as `node bin/billing.js`. `list --file path` prints the identifiers and balances in a JSON data file. `format --amount 1234 --currency USD` formats a minor-unit amount for the current locale.

The command exits nonzero for malformed arguments or unreadable files. Output intended for scripts is JSON, while `format` prints one human-readable line.
