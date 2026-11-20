# Folder Syncer

Folder Syncer copies a local folder into the storage service used by the nightly archive job. The service is a local stub in this repository, so the command is safe to use while developing a deployment script.

## Quick start

```sh
node bin/syncer.js sync --source ./data --bucket demo --dry-run
node bin/syncer.js list --bucket demo
```

The command reads `.syncerrc.json` in the current directory when it exists. Use `--config PATH` to select another JSON file. Command-line options currently include `--source`, `--bucket`, `--prefix`, `--region`, `--dry-run`, `--verbose`, repeated `--tag`, and `--concurrency`.

Run the checks with `npm test`.
