# Changelog

## 1.5.0 - 2024-06-01

- Added environment variable support for all configuration options.
- Added `--show-config` option to `sync` and `list` commands to display resolved configuration.
- Added `--no-dry-run` as the command-line false form for the dry-run option.
- Added `SYNCER_CONFIG` environment variable to select configuration file.
- Added support for `envPrefix` setting to customize environment variable prefix.
- Added validation for boolean and integer environment variables with clear error messages.
- Added support for comma-separated tag values via the `SYNCER_TAG` environment variable.

## 1.4.0 - 2024-05-14

- Made the storage stub report skipped files consistently.
- Added a region field to the run summary.

## 1.3.0 - 2024-02-02

- Added repeated tags to upload records.
- Improved messages for missing source folders.
