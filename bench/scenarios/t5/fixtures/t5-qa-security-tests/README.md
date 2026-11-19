# Internal Documents API

This repository contains the handler layer used by the internal document desk. It has no web framework: the edge adapter passes small request objects to functions in `src/handlers`.

## Local commands

Node.js 24 is the supported runtime. The project has no third-party packages, so a checkout can run the test command immediately:

```sh
node --test --test-timeout=4000 test
```

Storage files are supplied by the deployment and are never committed. The sample users in the source are only for the local handler harness.

## Layout

- `src/auth` contains session, role, and login-attempt state.
- `src/handlers` contains the request-shaped functions.
- `src/documents` and `src/export` contain document rules and presentation.
- `docs/` records the small operational conventions that are easy to forget.
