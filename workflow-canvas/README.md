# Workflow canvas

A browser UI for designing and running Konductor workflows. This folder is an
independent npm project (Vite, React, TypeScript, Cloudscape) and is not part
of the agent package or the CLI.

Currently an empty page with Designer and Execution tabs. Features land in
follow-up changes.

## Layout

- `src/`: the UI.
- `api/`: the HTTP API contract (`openapi.yaml`) and its test.
- `e2e/`: Playwright tests (`tests/`), the screenshot capture (`capture/`),
  shared page objects and helpers (`support/`) and the committed PNGs
  (`screenshots/`).

Directories added in later PRs:

- `stub-api/`: a TypeScript stub server for local development and end-to-end
  tests, started by the same Playwright `webServer` config.

A single `package.json` serves all of the above.

## Commands

From the repo root, `make canvas` runs install, lint, typecheck, unit and
end-to-end tests in order (`make help` lists the individual `canvas-*` targets).

Run from this folder with Node 24.15 or later (`.nvmrc` selects 24):

```bash
npm ci
npm run dev        # Vite dev server on http://127.0.0.1:5173
npm run lint       # ESLint and Prettier check
npm run typecheck
npm test           # Vitest, including the API contract test
npm run api:lint   # Only the API contract test
npm run build
npm run test:e2e    # Playwright, headless Chromium
npm run screenshots # regenerate e2e/screenshots/*.png
```

## API contract

`api/openapi.yaml` is the OpenAPI 3.1 description of the HTTP API that the
canvas calls. It covers six operations:

| Method and path      | `operationId`   | What it does                            |
| -------------------- | --------------- | --------------------------------------- |
| `POST /api/session`  | `createSession` | Exchange the launch code for a token    |
| `GET /api/workflow`  | `getWorkflow`   | Load a workflow                         |
| `PUT /api/workflow`  | `saveWorkflow`  | Save a workflow                         |
| `POST /api/validate` | `checkWorkflow` | Check workflow text and report problems |
| `POST /api/run`      | `startRun`      | Start a run                             |
| `GET /api/runs/{id}` | `getRun`        | Get the status of a run                 |

A workflow in this version has a `name`, an `intent` and `stages`, and each
stage is a `name` and an `agent`. The only harness is `kiro-cli`. The file also
holds what a backend needs to implement the calls: the accepted workflow text,
the checks that make a text invalid, the list of diagnostic codes, how a file
that is not a plain file is handled, and what a run does stage by stage. A
client follows a run by polling `GET /api/runs/{id}`.

The contract is the one source of truth for the API. Every server of the API
follows it, so a change to the API starts as a change to this file. Responses
may gain fields without a new version, so clients ignore fields they do not
know, and requests with a field the contract does not name are refused.

`npm run api:lint` checks the file. The test in `api/openapi.test.ts`:

- parses the file and validates it against the OpenAPI 3.1 specification,
  including that every `$ref` resolves;
- checks that the operations are exactly the six above, that each has an
  `operationId` and a `summary`, that every request and response body has an
  example, and that every response declares the `X-Konductor-Api` header;
- checks that every error response uses the one `Error` schema, that each error
  example has a code that fits its status, and that the diagnostic codes in the
  schema and in the description are the same;
- checks that request schemas refuse unknown fields and response schemas do not;
- validates every example, including the ones inside schemas, against its schema;
- checks that the examples agree with the rules in the contract: a hash is the
  SHA-256 of its text, a view lists what its own text says, a diagnostic points at
  the name in its message, the counts of a check add up, and a run's stages
  follow its status.

CI runs it on each pull request, and `npm test` includes it.

## End-to-end tests

The tests in `e2e/tests/` drive the production build in headless Chromium.
`playwright.config.ts` builds the app and serves it with `vite preview` on
http://127.0.0.1:4173, so no server needs to be running first. Its `webServer`
list is where a backing service starts when the app needs one.

Port 4173 must be free. The config never reuses a server, so a `vite preview`
you left running there makes the run fail at startup; stop it first.

Install the browser once (on Linux add `--with-deps` to also install system
libraries):

```bash
npx playwright install chromium
```

Then `npm run test:e2e`. The HTML report is written to `playwright-report/`;
open it with `npx playwright show-report`. Accessibility is checked with
axe-core on each tab.

Shared page objects and helpers live in `e2e/support/`. New tests should
extend them rather than repeat selectors: import `test` and `expect` from
`e2e/support/fixtures.ts` to get a `canvas` fixture that has already opened
the app.

## Screenshots

`npm run screenshots` saves a full-page PNG of each tab to
`e2e/screenshots/`, in the light theme at 1280x800 with animations frozen.
Pull request descriptions embed these files, so regenerate and commit them
when the UI changes.

Only that script writes the PNGs. It uses its own config,
`playwright.screenshots.config.ts`, so `npm run test:e2e`, a bare
`npx playwright test` and editor integrations never touch committed files.

The capture loads the Open Sans font from the `@fontsource-variable/open-sans`
dev dependency (Cloudscape names Open Sans first but does not ship it) and
turns off text hinting and LCD smoothing, so the PNGs come out byte-identical
on different machines and in CI. CI regenerates them, uploads that set as the
`screenshots` artifact, and fails when it differs from the committed files.

The comparison is byte-exact, so CI fails if a committed screenshot differs by
even one byte. After a toolchain bump (Playwright, Chromium, fonts or Node), run
`npm run screenshots` and commit the new images.
