# Troubleshooting

Use `node src/cli.js --check path/to/file.conf` to validate without printing.
A missing required `name`, a non-string `name`, and an invalid `timeout` are
reported before output is written.

When a value contains spaces, punctuation, or looks like a number, quote it.
The printer adds quotes when they are required to preserve the value.
