# Operations

The service is intended for a single host. Put the storage directory on a volume with routine snapshots. Keep the process account limited to that volume and review the application log after a restore.

A normal backup includes the configured folder, `config/default.json`, and the package metadata. The `var` directory is ignored by version control.
