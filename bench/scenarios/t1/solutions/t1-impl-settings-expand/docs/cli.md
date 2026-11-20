# Command line use

Pass one or more files with repeated `--file` options:

```sh
node bin/settings.js --file config/default.env --file config/local.env
```

The command writes one JSON object to standard output and diagnostics to standard error. Expansion is on by default. Use `--no-expand` to print the file values without resolving references. `--help` prints usage.
