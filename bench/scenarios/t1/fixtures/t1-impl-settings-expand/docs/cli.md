# Command line use

Pass one or more files with repeated `--file` options:

```sh
node bin/settings.js --file config/default.env --file config/local.env
```

The command writes one JSON object to standard output and diagnostics to standard error. `--help` prints usage.
