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

The `envPrefix` setting is retained in configuration for integrations that label a run. The default is `SYNCER_`.

## Environment Variables

All settings can be configured via environment variables. Use the `envPrefix` (default `SYNCER_`) followed by the option name in uppercase with hyphens replaced by underscores:

- `SYNCER_SOURCE`
- `SYNCER_BUCKET`
- `SYNCER_PREFIX`
- `SYNCER_REGION`
- `SYNCER_DRY_RUN`
- `SYNCER_VERBOSE`
- `SYNCER_TAG`
- `SYNCER_CONCURRENCY`
- `SYNCER_SHOW_CONFIG`
- `SYNCER_CONFIG`

Values are resolved in order: command line first, then environment variables, then JSON file, then defaults.
