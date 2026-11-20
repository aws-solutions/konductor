# Commands

`check file` reads a text or JSON file and reports whether it contains content.
`format file` prints the number of lines after applying the local formatter.
`inspect file` identifies the top-level JSON value.
`stats file` reports line and word counts.
`report file` prints a short report headed by `Atlas report`.
`list` prints the commands available in this installation.

Use `--help` for the compact terminal version. Every command returns a non-zero
status when its requested input cannot be read.
