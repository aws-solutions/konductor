# Changelog

## 1.4.1 - 2024-11-03

- Move filesystem orchestration and retry work to async functions.
- Keep the callback API during the compatibility release; every public operation also returns a promise.
- Keep callback errors single-shot and prevent ignored callback-mode rejections from becoming unhandled rejections.

## 1.4.0 - 2024-10-12

- Keep the command output stable for scheduled imports.
- Add a concurrency flag to the command line.

## 1.3.2 - 2024-06-04

- Preserve blank lines when counting source characters.
- Improve the message for a missing input directory.

## 1.3.0 - 2024-02-18

- Add retry handling around record writes.
