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
