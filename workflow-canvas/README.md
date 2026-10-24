# Workflow canvas

A browser UI for designing and running Konductor workflows. This folder is an
independent npm project (Vite, React, TypeScript, Cloudscape) and is not part
of the agent package or the CLI.

Currently an empty page with Designer and Execution tabs. Features land in
follow-up changes.

## Layout

- `src/`: the UI.

Directories added in later PRs:

- `stub-api/`: a TypeScript stub server for local development and end-to-end
  tests.
- `api/`: the API contract shared with the backend.

A single `package.json` serves all of the above.

## Commands

Run from this folder with Node 24.15 or later (`.nvmrc` selects 24):

```bash
npm ci
npm run dev        # Vite dev server on http://127.0.0.1:5173
npm run lint       # ESLint and Prettier check
npm run typecheck
npm test           # Vitest
npm run build
```
