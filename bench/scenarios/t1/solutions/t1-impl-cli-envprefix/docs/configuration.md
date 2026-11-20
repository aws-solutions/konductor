# Configuration

The optional `.syncerrc.json` file uses JSON and accepts the same names as the command-line settings in camel case. For example:

```json
{
  "source": "./data",
  "bucket": "archive",
  "prefix": "daily/",
  "region": "us-west-2",
  "dryRun": true,
  "concurrency": 2,
  "tags": ["team=ops"]
}
```

Every setting also accepts an environment variable. Names use the configured `envPrefix` followed by the upper-case option name with hyphens changed to underscores. The default prefix is `SYNCER_`, so `SYNCER_BUCKET` sets `bucket` and `SYNCER_DRY_RUN` sets `dry-run`. A non-empty `envPrefix` in the JSON file selects another prefix.

Values are resolved in this order: command line, environment, JSON file, then the built-in default. Boolean environment values are `true`, `false`, `1`, `0`, `yes`, or `no`. The repeatable `tag` setting is a comma-separated environment value, such as `SYNCER_TAG=team=ops,retention=short`. An empty environment variable is ignored. `--show-config` prints the resolved settings and their source without running an operation.
