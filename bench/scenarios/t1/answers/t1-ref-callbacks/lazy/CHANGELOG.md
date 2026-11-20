# Changelog

## 1.5.0 - 2024-10-15

- Migrate internal file pipeline to async functions for Node 24.
- All exported operations now return promises in addition to accepting callbacks.

## 1.4.0 - 2024-10-12

- Keep the command output stable for scheduled imports.
- Add a concurrency flag to the command line.

## 1.3.2 - 2024-06-04

- Preserve blank lines when counting source characters.
- Improve the message for a missing input directory.

## 1.3.0 - 2024-02-18

- Add retry handling around record writes.
