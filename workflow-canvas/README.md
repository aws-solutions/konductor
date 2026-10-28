# Workflow canvas

A browser UI for designing and running Konductor workflows. This folder is an
independent npm project (Vite, React, TypeScript, Cloudscape) and is not part
of the agent package or the CLI.

The page has Designer and Execution tabs. The Designer tab loads the workflow
from the API and draws it, read-only: the intent, each stage in list order
(name, agent and harness) and the end, joined by run-order edges. It shows a
loading message, an error message or an empty message when there is nothing to
draw. The Execution tab draws the same graph and runs it: a Run button starts
a run, and each node shows its live state until the run ends. The contract, the
stub that serves it and the tests around both are in this folder.

## Layout

- `src/`: the UI. `graph/` turns a workflow into nodes and edges and does no
  IO; `api/` is the typed client of the API; `launch/` and `workflow/` open the
  session and load the workflow; `designer/` and `canvas/` draw it;
  `execution/` runs it and shows the run; `execution/core/` does no IO and reads a run
  once a second. A read that fails with no answer or a server error is tried
  again, up to three in a row; any other failure ends the following. A start
  that finds a run already active follows that run. Every run call takes a
  signal, and every call ends on its own after 15 seconds, so a server that
  never answers cannot hold the tab. A failure counts only for the run it belongs to.
- `api/`: the HTTP API contract (`openapi.yaml`) and its test.
- `stub-api/`: a TypeScript stub server for the contract, for local
  development and tests.
- `e2e/`: Playwright tests (`tests/`), the screenshot capture (`capture/`),
  shared page objects and helpers (`support/`) and the committed PNGs
  (`screenshots/`).

A single `package.json` serves all of the above.

## Commands

Run from this folder with Node 24.15 or later (`.nvmrc` selects 24):

```bash
npm ci
npm run dev         # Vite dev server on http://127.0.0.1:5173, /api goes to WC_API_TARGET or the stub
npm run dev:stub    # The stub and the Vite dev server together; Ctrl+C stops both
npm run build       # production build into dist/
npm run lint        # ESLint and Prettier check
npm run typecheck
npm test            # Vitest: UI, API contract and stub API
npm run api:lint    # Only the API contract test
npm run stub        # The stub API on http://127.0.0.1:5174
npm run test:stub   # Only the stub API tests
npm run test:e2e    # Playwright, headless Chromium, against the stub or WC_API_TARGET
npm run screenshots # Regenerate e2e/screenshots/*.png
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

## Stub API

`stub-api/` serves the six calls of `api/openapi.yaml` from memory, so the UI
and the real backend can be built against the same contract. It is a local
development and test stub with no real auth: the launch code and the session
token only exercise the session flow. It listens on `127.0.0.1` only and keeps
nothing on disk, so a restart brings back the sample data.

```bash
npm run stub
# Workflow canvas stub API (local development only, no real auth)
# Listening on http://127.0.0.1:5174
# The stub serves no page. With `npm run dev` running, open:
# http://127.0.0.1:5173/#<launch code>
```

The launch code is new each time and works once, within 60 seconds of the
moment the stub starts listening. A used address is dead: get a fresh launch
address from the server (the stub prints one each time it starts).
`POST /api/session` trades the code for the token that the other calls send as
`Authorization: Bearer <token>`. `STUB_PORT` sets the port (a whole number from 1 to 65535; anything else stops the command
with a one-line error). `STUB_LAUNCH_CODE` sets the code, for tests only: it can be
weaker than the contract asks.

The contract has the code work once, and the page copes: it keeps the session in
the storage of its tab, so a reload resumes without the code (see
[The canvas](#the-canvas)). The stub of `npm run dev:stub` (it gets
`--with-dev-server`) still takes the code again, with no time limit, and gives
the same token, so opening the printed address twice is not a dead end. Set
`STUB_STRICT=1` (for example `STUB_STRICT=1 npm run dev:stub`) to make it follow
the contract: the code works once, within 60 seconds. `npm run stub` on its own
and the stub that Playwright starts always follow the contract.

The data covers the first release: a workflow of an intent and stages, and the
`kiro-cli` harness. It is a `hello` workflow with a `draft` stage
(`k-developer`) and a `review` stage (`k-quality-assurance`). A saved change
lasts until the stub stops. A run is faked and calls no agent: its stages run
for 3 seconds each, one after the other, and all of them pass. It runs one run
at a time and never fails a stage.

### Run the page against the stub

Run `npm run dev:stub`. It starts the stub and `npm run dev` together, and
Ctrl+C stops both. Or start the stub in one terminal and `npm run dev` in
another. Then open the address that the stub prints. The dev server forwards
`/api` to the stub (`vite.config.ts`), so the page and the API share one
origin. The stub sends no CORS headers and accepts only its own `Origin`, so
the proxy swaps the page's `Origin` (`http://127.0.0.1:5173` or
`http://localhost:5173`) for the stub's. Any other `Origin`, or none, goes
through unchanged and the stub refuses a POST or PUT with a 403, so a page on
another origin cannot use the dev server to call the API. The page reads the
launch code from the address (`#<launch code>`), removes it from the address
bar, trades it for a token with `POST /api/session` and loads the workflow with
`GET /api/workflow`. The token is kept in the session storage of the tab, so a
reload resumes; see [The canvas](#the-canvas). To try the calls by hand, send the `Origin` of the page:

```bash
curl -s -X POST http://127.0.0.1:5173/api/session \
  -H 'Origin: http://127.0.0.1:5173' \
  -H 'Content-Type: application/json' -d '{"code":"<launch code>"}'
```

The launcher sends SIGTERM to the other command when one exits, and SIGKILL
to a command that is still running 5 seconds later. If the launcher itself is
killed with SIGKILL, the stub and Vite may keep running; stop them yourself.

## Choose the API backend

The page always calls the relative `/api`. Only the proxy target changes, and
one variable sets it: `WC_API_TARGET`, an origin such as
`http://127.0.0.1:8080`. When it is unset, the target is the stub. A bad value
(not an http or https origin, or one with a path) stops the command that needs
it (`dev`, `preview`, `test:e2e`, `screenshots`) with a one-line error that
hides any user, password or query in the value. `build` and `npm test` never
read it, so a mistyped value in your shell cannot fail them (the tests of the
Playwright config set it themselves). `stub-api/target.ts` is the only place
that reads it.

- Stubbed dev: `npm run dev:stub`
- Real dev: `WC_API_TARGET=http://127.0.0.1:8080 npm run dev`
- Stubbed e2e: `npm run test:e2e`
- Real e2e: `WC_API_TARGET=http://127.0.0.1:8080 npm run test:e2e`

`dev:stub` ignores `WC_API_TARGET`, since it starts the stub. For real e2e,
Playwright does not start the stub, so start the real server first with the
launch code `e2e-launch-code-0123456789`, and run the tests within 60 seconds
of it listening. The launch code works once, so restart the server before each run;
a second run against the same server fails with a 401.

The proxy sends the `Origin` of the target in place of the page's own, and
forwards any other `Origin` unchanged. A real server must pass the same Origin
check as the stub (refuse a POST or PUT from any other `Origin`), and the same
`POST /api/session` step from `api/openapi.yaml`, where the launch code is
traded for the token that the other calls send. The e2e and contract tests then
show whether the real server answers as the stub does.

### Code of the stub

The code is in two parts, so the rules can be tested without a server:

- `core/`: the workflow check, the file store and the run simulator. It does
  no IO and takes its clock as a parameter. A test fails if a core file
  imports anything but its own modules, `yaml` and `createHash`, or reads the
  clock, randomness or the environment.
- `http/`: a thin adapter on `node:http` that checks headers and bodies and
  hands the rest to the core.

`npm run test:stub` runs the tests. Those in `http/` start the stub on a free
port, call it over HTTP and check each reply against the schema of the
contract. They move a fake clock by hand, so none of them waits. A test
compares the error codes, diagnostic codes, limits and patterns of the stub
with the contract, so a change to one without the other fails.

Playwright starts the stub beside the app (`stub-api/web-servers.ts` holds its
launch code and the server list), so an end-to-end test can call it. Its launch
code works once, as the contract has it. With `WC_API_TARGET` set Playwright
does not start it, and the same tests call that server instead.

## The canvas

`src/graph/` is the core of the canvas. `buildGraph(workflow, harness)` turns
the workflow view into nodes (the intent, one per stage, the end) and edges
(one from each node to the next, from the tab under a node to the notch in the
top edge of the next), placed in one column. It imports
only its own modules. A test (`test-support/graph-purity.test.ts`) fails if it
imports anything else, or reads a clock, randomness, the environment or the
network, and the stub core is held to the same rule by the same scan
(`test-support/purity.ts`). The scan parses each file as TypeScript, so it
catches an alias such as `const f = fetch`, `XMLHttpRequest`, `WebSocket`,
`sendBeacon`, storage, `import.meta`, animation frames and dynamic imports,
and it ignores a word in a comment or a string. It guards against accidents;
it is not a sandbox. The run core, `src/execution/core/`, is held to it too,
by `test-support/execution-purity.test.ts`: it may import only its own
modules, the graph core and the wire types.

The rest wraps the core, so the rules can be tested without a browser:

- `api/`: `WorkflowApi` is the port with the calls the page makes (open a
  session, load the workflow, start a run, read a run); `createHttpApi` is its
  adapter over `fetch`. It ignores fields it does not know, refuses a reply
  that breaks the contract, and turns a failed call into an `ApiError` with a
  message fit to show.
- `launch/launch-code.ts` and `workflow/` take the launch code from the
  address and load the workflow. `loadWorkflow` never rejects: it returns
  `{ ok: true, workflow }` or `{ ok: false, message }`. `createWorkflowSource`
  starts the first load once, before React renders, because a launch code
  works once and strict mode runs effects twice. Pasting a launch address into
  the open tab does not reload the page: when the fragment is shaped like a
  launch code (16 to 256 characters, no whitespace; the API sets no alphabet)
  the page opens a session with it and changes to the new workflow only if
  that works, and fits the graph to it. A refused code leaves the workflow on
  the page. A short anchor such as `#top` changes nothing; a longer one is
  offered as a code and refused. When several codes are in flight, the latest
  one that works wins.
- `launch/session-memory.ts` is the port through which the page keeps its
  session (the token and the harness, never the launch code) in the session
  storage of its tab. A load with no code in the address uses it, so a reload
  resumes the open workflow although the code is spent. A code in the address
  that fails (a spent one) falls back to the kept session with a notice that
  says why, and its error is shown as the page's only if that fails too. The
  session of a code in the address is kept as soon as the code opens it, in
  place of a kept one unless a newer one was kept meanwhile, so a first load
  that fails can be retried by a reload. A 401 on the kept token, on any call
  (the server was started again), clears it and asks for a fresh launch address
  (an address works once). A pasted code replaces the kept session only once
  the workflow of that code is on the page. Until then its session waits under
  a second key as the pending one, and a reload tries it before the kept
  session, so a pasted address whose first load failed is not lost. A session
  that answers after a newer one was kept is neither kept nor held. A pending
  session that fails to load stays until the server refuses it (a 401) or a
  newer session replaces it. Showing a workflow keeps its session and clears
  the pending one.
  The token lasts for the life of the tab, including copies made by Duplicate
  tab or `window.open`, and a browser may restore it with the tab. Script on the
  page can read it, so `index.html` carries a Content-Security-Policy that lets
  the page run only its own files and allows no `<base>` or form target; a
  server that sends the page should send the same policy as a header.
- `designer/` shows the result: loading, error, empty (no file yet, or a file
  with errors, with their messages), or the canvas.
- `canvas/` draws the graph with [React Flow](https://reactflow.dev)
  (`@xyflow/react`). Nodes cannot be moved, selected or connected; the view
  can be panned, and zoomed with the controls. Each node can be reached with
  the Tab key and has a name for screen readers. The view starts zoomed out
  far enough to show the longest workflow the API allows (40 stages), where the
  text is small; use the zoom controls to read it. A node cuts a long name or
  outcome short, and keeps the whole text in its `title`; an outcome too long
  for the node is also written out in full under the graph.

## The Execution tab

The tab draws the same graph as the Designer, read-only, with a **Goal** box
and a **Run** button beside it. The goal starts as the outcome of the
intent, because the API needs one (1 to 2048 characters) to start a run.

- **Run** calls `POST /api/run` with the goal, then reads
  `GET /api/runs/{id}` once a second until the run is `passed` or `halted`.
  Run is off and the goal box is read-only from the click until the run ends.
  Read-only, not greyed out, so the box keeps focus and shows the goal of that
  run. Enter in the box starts a run, like the button.
- Each node shows a badge with a word and a colour: **Queued** (with a dashed
  outline), **Running**, **Done** and **Failed**. The word carries the state;
  only Queued and Not run also differ in shape. The intent is Done once the run
  has it. After a halt, the stages behind the failed one say **Not run**. The end
  shows the result: **Passed** or **Halted**.
- A line under the button says where the run is ("Running draft. 0 of 2 stages
  done."). A screen reader hears each change from a polite live region that
  `App` keeps outside the tabs, so it is announced while the Designer tab is
  open too. Each node's name for a screen reader ends with its state.
- An error from the API, whether the run does not start or a read fails, shows
  in one alert under the Run button, with the sentence the server gave. A
  screen reader hears it from an alert region that `App` keeps outside the
  tabs, so it is read when it appears even if the Designer tab is open; the
  status line on the tab says only "See the error below.", which the live status region leaves out. When a read fails, the
  nodes are cleared and the alert adds that the run (with its id) may still be
  going on the server. A failed stage is a result, not an error, so it has no
  alert. The goal is one line: line breaks in the outcome of the intent become
  spaces, and Enter that ends an input method composition starts no run.
- A workflow can be saved while a run goes on, so the run may have other stages
  than the graph. Node states attach by stage name, so a warning above the
  graph names the stages that are not drawn and those that are not in the run.
- A run goes on while the Designer tab is open, and the tab shows it again when
  you come back, with the goal box as it was: what you typed, or the goal of
  the run in flight. Closing the page stops the reading, not the run.
- The colours of the states are in `src/canvas/canvas.css` and match the theme
  module, checked in both modes by the contrast test.

The code follows the ports-and-adapters split of the graph:

- `src/execution/core/` is the core and does no IO: the state of the tab and
  its reducer, the loop that starts a run and reads it (`startAndFollow`), the
  node states and the status sentences. Its ports are `RunPort` (start and
  read a run) and `Scheduler` (wait for some milliseconds), so a test moves
  time by hand and nothing sleeps. A test (`test-support/execution-purity.test.ts`)
  fails if the core imports anything but its own modules, the graph core and the
  wire types, or reads a clock, randomness, the environment or the network.
- The adapters are `createHttpApi` (`startRun`, `getRun`), which `loadWorkflow`
  ties to the session token, and `timerScheduler`. The token is held only by
  those run calls.
- `useExecution` keeps the state in `App`, and `Execution` draws it. The
  Designer and Execution tabs share `WorkflowGate` (loading, error and empty
  states) and `WorkflowGraphCard` (the card with the graph).

## Theme

The page has the look of the Konductor docs theme: its colours, fonts and
corner radii, in a light and a dark mode.

- `src/theme/tokens.ts` holds every colour, font and radius of the theme, as
  two palettes and the Cloudscape token map built from them. Nothing else
  names a colour of Cloudscape. The colours of the canvas itself are in
  `src/canvas/canvas.css`, with their dark values under
  `:root[data-theme='dark']`. A test checks that they match the palettes.
- `src/theme/install.ts` applies the token map with `applyTheme` from
  `@cloudscape-design/components/theming` (colours, fonts and radii only,
  with a value for each mode) and switches the mode with `applyMode` from
  `@cloudscape-design/global-styles`. The header band and the top bar are dark
  in both modes, so their text colours are set for the band in `tokens.ts`.
  The root element gets `data-theme` (`light` or `dark`) and `color-scheme`; a
  small script in `index.html` sets both before the first paint, so a dark page
  does not flash white.
- `src/theme/fonts.ts` loads Outfit and JetBrains Mono from the pinned
  `@fontsource/outfit` and `@fontsource/jetbrains-mono` packages (SIL Open
  Font License 1.1). The Latin files are bundled, so the page makes no request
  to a font site.
- The top bar (`src/chrome/TopBar.tsx`) has the K logo, the page name and the
  **Theme: light** / **Theme: dark** button. The first visit follows the
  system setting (`prefers-color-scheme`). Pressing the button saves the mode
  in local storage (`src/theme/mode.ts`), and the saved mode wins from then
  on. A page that was never switched keeps following the system, but only as it
  was at load: a later change of the system setting, or of the choice in
  another tab, shows after a reload.
- The page header is a dark band with the breadcrumb `Workflows > <workflow>`
  (the page has no list of workflows yet, so no crumb is a link), the title
  and the Designer and Execution tabs. The whole tab strip, with its rule and
  the selected-tab indicator, is part of the band.
- Nodes are cards with the corner radius of the theme. The `S` run-order
  ports are pieces of a jigsaw, 26 by 16 pixels, with a dark rim and a letter
  `S`: the out port is a square tab that hangs from the bottom edge, the in
  port a notch of the same outline in the top edge (white inside, with a ring
  in the colour of the tab), both in the middle of the card, so a tab fits the
  notch of the card under it (`src/canvas/jigsaw.ts` defines the shape once).
  A link runs from the tip of the tab to the top of the notch. The keyboard
  focus ring follows the outline of the card and of the tab.

Text meets WCAG 2 AA (4.5:1) in both modes, and the edges of controls, nodes,
ports and the selected-tab indicator reach 3:1. `src/theme/tokens.test.ts`
and `test-support/canvas-contrast.test.ts` check each of these colour pairs
for the palettes, the band and the canvas in both modes, and the end-to-end
tests run axe (which checks text contrast) in both modes and read the colour
of the tab strip.

## End-to-end tests

The tests in `e2e/tests/` drive the production build in headless Chromium.
`playwright.config.ts` builds the app and serves it with `vite preview` on
http://127.0.0.1:4173, so no server needs to be running first. Its `webServer`
list is where a backing service starts when the app needs one.

A launch code works once, so `e2e/global-setup.ts` trades the code of the
config for a session once per run, and the `canvas` fixture answers the page's
own `POST /api/session` with that session. Every other call, such as
`GET /api/workflow`, reaches the API. A test that needs the error state opens
the page with a wrong code or none.

Port 4173 must be free, or set `WC_APP_PORT` to another port (`WC_APP_PORT=4300
npm run test:e2e`). The config never reuses a server, so a `vite preview` you
left running on that port makes the run fail at startup; stop it first.

Install the browser once (on Linux add `--with-deps` to also install system
libraries):

```bash
npx playwright install chromium
```

Then `npm run test:e2e`. The HTML report is written to `playwright-report/`;
open it with `npx playwright show-report`. Accessibility is checked with
axe-core on each tab, on the error state, on the Execution tab with a stage
running, a failed stage, a passed run, the error of the API and a goal that
cannot be run, and in both theme modes.

The stub runs one run at a time and never fails a stage. So the one test that
starts a real run on it (`execution.spec.ts`, the first run test) waits for the
end of the run, and the tests of a failed stage or a refused run answer the
run calls themselves (`e2e/support/run-routes.ts`). A test that starts another
run on the stub must also wait for its end, or the next test gets a 409.

Shared page objects and helpers live in `e2e/support/`. New tests should
extend them rather than repeat selectors: import `test` and `expect` from
`e2e/support/fixtures.ts` to get a `canvas` fixture that has already opened
the app.

## Screenshots

`npm run screenshots` saves full-page PNGs to `e2e/screenshots/`, drawn from
the stub, at 1280x800 with animations frozen. The runs in the Execution
captures answer with fixed replies, so no capture depends on the clock of the
stub. The Designer tab is in the light
theme (`designer-tab.png`) and in the dark one (`designer-tab-dark.png`, after
the theme button is pressed). The Execution tab is saved before a run
(`execution-tab-idle.png`), while the first stage runs
(`execution-tab-running.png`) and after the run passed
(`execution-tab-finished.png`), all in the light theme, and while the first
stage runs in the dark theme (`execution-tab-dark.png`). Pull request
descriptions embed these files, so regenerate and commit them when the UI
changes.

Only that script writes the PNGs. It uses its own config,
`playwright.screenshots.config.ts`, so `npm run test:e2e`, a bare
`npx playwright test` and editor integrations never touch committed files.

The capture waits until the bundled Outfit and JetBrains Mono faces are loaded
and turns off text hinting and LCD smoothing, so the PNGs come out
byte-identical on different machines and in CI. CI regenerates them, uploads
that set as the `screenshots` artifact, and fails when it differs from the
committed files.

The comparison is byte-exact, so CI fails if a committed screenshot differs by
even one byte. After a toolchain bump (Playwright, Chromium, fonts or Node), run
`npm run screenshots` and commit the new images.
