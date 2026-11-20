# Usage notes

`sync` walks regular files below the source directory. A dry run prints the files it would send and never writes to the storage stub.

`list` prints the objects currently known by the stub. Both commands accept the bucket, prefix, region, and verbosity options.

A missing source directory is an error. Empty directories are valid and produce a zero-file summary.

## Showing Configuration

Both `sync` and `list` accept `--show-config`, which prints the resolved configuration and exits without performing any operation. Output shows each setting as `name=value [source]`, where source is one of:

- `command line`
- `environment`
- `config`
- `default`

Example:

```
source=./data [command line]
bucket=archive [environment]
prefix=daily/ [config]
region=us-east-1 [default]
dry-run=false [default]
verbose=true [command line]
tag=team=ops,env=prod [environment]
concurrency=4 [default]
```

## Boolean Options

The `--dry-run` and `--verbose` options can be negated on the command line:

- `--dry-run` enables dry run mode
- `--no-dry-run` explicitly disables dry run mode
- `--verbose` enables verbose output
- `--no-verbose` explicitly disables verbose output

This is useful when an environment variable enables an option and you want to override it on the command line.
