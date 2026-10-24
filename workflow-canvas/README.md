# Workflow canvas

A browser UI for designing and running Konductor workflows. This folder is an
independent npm project (Vite, React, TypeScript, Cloudscape) and is not part
of the agent package or the CLI.

Currently an empty page with Designer and Execution tabs. Features land in
follow-up changes.

## Layout

- `src/`: the UI.
- `e2e/`: Playwright tests (`tests/`), the screenshot capture (`capture/`),
  shared page objects and helpers (`support/`) and the committed PNGs
  (`screenshots/`).

Directories added in later PRs:

- `stub-api/`: a TypeScript stub server for local development and end-to-end
  tests, started by the same Playwright `webServer` config.
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
npm run test:e2e     # Playwright, headless Chromium
npm run screenshots  # regenerate e2e/screenshots/*.png
```

## End-to-end tests

The tests in `e2e/tests/` drive the production build in headless Chromium.
`playwright.config.ts` builds the app and serves it with `vite preview` on
http://127.0.0.1:4173, so no server needs to be running first. Its `webServer`
list is where a backing service starts when the app needs one.

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
when the UI changes. The capture asserts nothing and is separate from
`test:e2e`, so a normal test run never rewrites committed files. Text
rendering depends on the fonts installed on the machine, so small differences
between machines are expected; CI uploads its own set as the `screenshots`
artifact.
