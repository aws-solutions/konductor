# Changelog

## 2.4.0 - 2025-02-14

- Added the report command and a stable report heading.
- Improved messages for missing input files.
- Optimized command-line startup with lazy command loading. Commands are now loaded on-demand, reducing initial module count for --help and --version to meet the loader-hook measurement target of 4 or fewer project modules from bin/ and src/.

## 2.3.0 - 2024-10-02

- Added JSON inspection and line statistics.
- Kept the command output friendly to shell scripts.

