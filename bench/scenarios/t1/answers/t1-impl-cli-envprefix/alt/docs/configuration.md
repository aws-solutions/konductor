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

All settings support environment variables. Use the `envPrefix` (default `SYNCER_`) followed by the option name in uppercase with hyphens replaced by underscores:

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

### Resolution Order

Values are resolved in order of precedence:
1. Command line arguments (highest priority)
2. Environment variables
3. JSON configuration file
4. Built-in defaults (lowest priority)

### Empty Values

An empty environment variable is treated as unset and allows fallback to the next source.

### Boolean Values

Boolean environment variables (`SYNCER_DRY_RUN`, `SYNCER_VERBOSE`, `SYNCER_SHOW_CONFIG`) accept:
- `true`, `false` (case-insensitive)
- `1`, `0`
- `yes`, `no` (case-insensitive)

Invalid boolean values produce an error that includes the variable name.

### Integer Values

The `SYNCER_CONCURRENCY` environment variable must be a positive integer. Invalid values produce an error that includes the variable name.

### Tag Values

The `SYNCER_TAG` environment variable accepts a comma-separated list. For example, `SYNCER_TAG=team=ops,env=prod` produces the same result as `--tag team=ops --tag env=prod`.

### Configuration Path

When `--config PATH` is not specified on the command line, the `SYNCER_CONFIG` environment variable selects the configuration file.
