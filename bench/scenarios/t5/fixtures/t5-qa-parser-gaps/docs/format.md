# Format

A file contains assignments and section headers. Keys use letters, digits,
underscore, and hyphen. A section such as `[cache.disk]` creates nested
objects. A section can be empty.

Strings use double quotes. The escapes `\\`, `\"`, `\n`, `\r`, `\t`, and
`\uXXXX` are accepted. A quoted string may contain a literal line break.

Arrays use brackets and comma-separated values. Values can be strings,
booleans, plain numbers, or quantities with `ms`, `s`, `B`, `KB`, or `MB`.
Quantity magnitudes range from 0 through 1,000,000, with nonzero values below
0.001 rejected. A quantity converts to another unit with two decimal places.
Sections may be nested eight names deep.
