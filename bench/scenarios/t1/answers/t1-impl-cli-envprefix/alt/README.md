# Folder Syncer

Folder Syncer copies a local folder into the storage service used by the nightly archive job. The service is a local stub in this repository, so the command is safe to use while developing a deployment script.

## Quick start

```sh
node bin/syncer.js sync --source ./data --bucket demo --dry-run
node bin/syncer.js list --bucket demo
```

The command reads `.syncerrc.json` in the current directory when it exists. Use `--config PATH` to select another JSON file. Command-line options currently include `--source`, `--bucket`, `--prefix`, `--region`, `--dry-run`, `--no-dry-run`, `--verbose`, repeated `--tag`, `--concurrency`, and `--show-config`.

Run the checks with `npm test`.

## Environment Variables

All settings can be configured via environment variables with the `SYNCER_` prefix (configurable via `envPrefix`):

```sh
SYNCER_BUCKET=archive SYNCER_DRY_RUN=true node bin/syncer.js sync
```

Use `--show-config` to see resolved values and their sources.
