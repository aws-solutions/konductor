# Workflow canvas

A browser UI for designing and running Konductor workflows. This folder is an
independent npm project (Vite, React, TypeScript, Cloudscape) and is not part
of the agent package or the CLI.

The top bar has Library and Canvas places. Canvas has Design and Run views,
picked with a switch in the page header. The Design view loads the workflow
from the API and draws it: the intent and each stage in list order. A stage
card shows its name, agent and harness, plus its outcome or first prompt line.
Run-order edges join the cards, and a mark under the last stage says where the
run ends. Beside the drawing it shows the text of the file and
the keys of the stage that is picked. You can pick the agent of
a stage, rename it, edit its prompt, add a stage, delete one and save the file.
A save changes only the values it edits and keeps every other key of the file. It shows a
loading message, an error message or an empty message when there is nothing to
draw. The Run view starts a run and follows it: a Goal box and a Run button,
then how far the run has got, its stages with the detail and console of the
one picked, and the past runs of the workflow. A blocked
stage shows its reason, and a Run of a workflow that is not trusted opens a
dialog with the command that trusts it. The Library view lists shipped
workflows, opens ready entries read-only and copies one into the workflow
folder. The contract, the stub that serves it and the tests around both are in
this folder.

## Layout

- `src/`: the UI. `graph/` turns a workflow into nodes and edges and does no
  IO; `api/` is the typed client of the API; `launch/` and `workflow/` open the
  session and load the workflow; `design-view/` edits it and `canvas/` draws it;
  `run-view/` runs it and shows the run; `library-view/` lists, previews and
  copies shipped workflows; `execution/core/` and `run-client/` do
  no IO and follow a run through its events, a long poll the server may hold
  open for 20 seconds. A call that fails is tried again after a second,
  doubling to 16, until eight in a row have failed; a 401 ends the following
  at once. A start
  that finds a run already active follows that run. Every run call takes a
  signal, and every call ends on its own, after 15
  seconds, 30 for one long poll, or 120 seconds for the launch code trade (see
  **The launch code
  trade** below), so a server that never answers cannot hold the tab. A failure counts only for the run it belongs to.
- `api/`: the HTTP API contract (`openapi.yaml`) and its test.
- `stub-api/`: a TypeScript stub server for the contract, for local
  development and tests.
- `e2e/`: Playwright tests (`tests/`, and `editing/`, which saves to the
  stub), the screenshot capture (`capture/`), shared page objects and helpers
  (`support/`) and the committed PNGs (`screenshots/`).

A single `package.json` serves all of the above.

## Commands

From the repo root, `make canvas` runs install, lint, typecheck, unit tests,
build and end-to-end tests in order (`make help` lists the individual
`canvas-*` targets). It skips two CI checks: the Node 26 leg and the
committed-screenshots check (`npm run screenshots`, which is OS and font
sensitive). The e2e server uses port 4173, so only one run fits on a host at a
time.

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
canvas calls. It covers these operations:

| Method and path                 | `operationId`         | What it does                            |
| ------------------------------- | --------------------- | --------------------------------------- |
| `POST /api/session`             | `createSession`       | Exchange the launch code for a token    |
| `GET /api/workflow`             | `getWorkflow`         | Load a workflow                         |
| `PUT /api/workflow`             | `saveWorkflow`        | Save a workflow                         |
| `GET /api/library`              | `listLibrary`         | List shipped workflows                  |
| `GET /api/library/{name}`       | `getLibraryWorkflow`  | Open a shipped workflow read-only       |
| `POST /api/library/{name}/copy` | `copyLibraryWorkflow` | Copy a shipped workflow                 |
| `GET /api/agents`               | `listAgents`          | List the agents a stage may name        |
| `POST /api/validate`            | `checkWorkflow`       | Check workflow text and report problems |
| `POST /api/run`                 | `startRun`            | Start a run                             |
| `GET /api/runs`                 | `listRuns`            | List the past runs, newest first        |
| `GET /api/runs/{id}`            | `getRun`              | Get the status of a run                 |
| `GET /api/runs/{id}/events`     | `getRunEvents`        | Follow the events of a run              |

A workflow in this version has a `format`, a `version`, an `intent` with an
`outcome` and optional `accept` checks, optional `params`, and `stages`.
`params.goal` declares the goal and the other params declare named run inputs.
A stage has a `name`, an `agent`, optional `outcome`, optional `prompt` or
`prompt_file`, optional `outputs`, and optional `done_when` check ids. A stage
outcome is one line of 1 to 300 characters saying what the stage should
produce. A prompt can refer to a run param or to an output of an earlier stage.
Each stage of a parsed view also has a
`kind` (`agent`, the one kind in this version) and a `range`, the lines of the
text it takes up, so a client can draw a stage and mark its lines without
reading YAML. `GET /api/workflow` also returns `stage_fields`: for each kind of
stage, the keys a person may edit, with their type, whether they are required
and their limits, so a form can be built from data. The file also holds what a
backend needs to implement the calls: the accepted workflow text, the checks
that make a text invalid, the list of diagnostic codes, how a file that is not
a plain file is handled, and what a run does stage by stage. A client follows a
run by polling `GET /api/runs/{id}`, or with the long poll of
`GET /api/runs/{id}/events`: numbered events for stage changes, the end of the
run and console lines. A client resumes from the last number it read. Console
lines are live only: the server keeps at most the last 1000 of a run, while the
run is active and for 60 seconds after `run_finished`, and never stores them.
`GET /api/runs` lists the runs of the workflow, newest first, with each run's
start time, status and goal (cut to the goal limit, with `goal_truncated`
saying so). The session response also says which
server it is: `konductor_version`, the `capabilities` it supports (the
`operationId` of each operation, which is not renamed within an API major
version) and its `limits` (text bytes, stages, outcome, prompt and goal
lengths). The page does not read these yet. The format itself is described in
[`docs/design/workflows-spec.md`](../docs/design/workflows-spec.md).

A run uses the `kiro-cli` or `claude` harness, or `fake` in tests. A stage
passes on evidence, not on the exit status of its session, and a blocked stage
carries a `reason`. Each run reports the state of every declared check by id.
Only one run is active per workspace, whichever process started it.
`POST /api/run` answers `trust_required` for a workflow that is not trusted,
with the command that the user runs in a terminal. The contract has no call
that grants trust, and a save that changes the workflow's bytes ends its trust.

The contract is the one source of truth for the API. Every server of the API
follows it, so a change to the API starts as a change to this file. Responses
may gain fields without a new version, so clients ignore fields they do not
know, and requests with a field the contract does not name are refused.

`npm run api:lint` checks the file. The test in `api/openapi.test.ts`:

- parses the file and validates it against the OpenAPI 3.1 specification,
  including that every `$ref` resolves;
- checks that the operations are exactly the ones above, that each has an
  `operationId` and a `summary`, that every request and response body has an
  example, and that every response declares the `X-Konductor-Api` header;
- checks that every error response uses the one `Error` schema, that each error
  example has a code that fits its status, and that the diagnostic codes in the
  schema and in the description are the same;
- checks that request schemas refuse unknown fields and response schemas do not;
- validates every example, including the ones inside schemas, against its schema;
- checks that the examples agree with the rules in the contract: a hash is the
  SHA-256 of its text, a view is its text read as YAML (with each stage's kind
  and lines worked out by a second reader), a diagnostic that names
  a key points at that key, the counts of a check add up, and a run's stages
  follow its status;
- checks that the session example lists every `operationId` as a capability
  and reports the limits that the rest of the file states, and that each pinned
  `operationId` is still there, so a rename fails;
- checks the format rules that a schema can hold: a version is `X.Y.Z`, a path
  follows the specification's path rule (no empty, `.` or `..` segment, no `\`,
  no drive letter, no control character), and a check has exactly one of `file`
  and `run`.

CI runs it on each pull request, and `npm test` includes it.

## The Library

The **Library** view lists workflows shipped by the server. Ready entries open
read-only with the same Design drawing and YAML pane as a workflow file. **Start
from** asks for a workflow name, copies the entry into the workflow folder, and
opens the copy in Design so it can be edited, saved and run. Planned entries
show what they are waiting for and cannot be opened or copied. A ready shipped
source omits the top-level `name` key. The lookup id supplies its name, and the
copy gets the name entered in **Start from** without rewriting the YAML. A valid
empty response says that no shipped workflows are available. The contract
allows at most 100 entries, 120 characters per title, and 240 characters per
summary or planned reason.

If a copy gets no reply, a 408, 429 or 5xx, or an unreadable 200 response,
the page reads both `GET /api/workflow` and the selected Library source. It
opens the requested copy only when the root has the requested name and its text
matches the source byte for byte. An unedited copy of the same entry made by
another tab is harmless because it has those same bytes. An edited or unrelated
root, or either failed read, blocks editing and running until the page is
reloaded. A non-retryable 4xx refusal is shown without a reconciliation read.

**Start from** stays focusable but unavailable while a run is active. Its reason
says that the workspace already has an active run. The server also refuses a
copy in that state with 409 `already_running` and the active `run_id`; it creates
no file and does not move the session root.

The page calls `GET /api/library`, `GET /api/library/{name}` and
`POST /api/library/{name}/copy`. The local stub serves the first ready entry,
`library/k-adversarial-pull-request-review`, plus planned examples. A successful
copy moves the session root to the new project workflow, which starts untrusted.
Save, check, and run requests name the workflow the page shows; a stale page
gets 403 `read_only_workflow`, changes nothing, and must reload. The Library
runs against the stub until the workflow server implements those routes.

## Stub API

`stub-api/` serves the calls of `api/openapi.yaml` from memory, so the UI
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
moment the stub starts listening. A used address is dead: start `flow view`
again and open the address it prints (the stub stands in for `flow view` and
prints one each time it starts).
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

The data covers the first release: a workflow of the keys that slice 1 of the
format reads, and the `kiro-cli` harness. It is a `hello` workflow with a
`draft` stage (`k-developer`) and a `review` stage (`k-quality-assurance`). A
saved change lasts until the stub stops. `GET /api/agents` lists the same
eight agents that the Design view offers. The stub reads no files, so for a
`prompt_file` it checks only the path rules: it accepts a path to a file that
does not exist. A run is faked and calls no agent: its stages run for 3 seconds
each, one after the other, each prints two scripted console lines, and all of
them pass. `GET /api/runs` lists the runs it played since it started. It runs
one run at a time and
never fails a stage.

`STUB_WORKFLOW` picks the workflow of the session, to show the other answers of
`POST /api/run`. `untrusted` refuses a run with `trust_required`. `blocked`
ends a run with a blocked stage and its `reason`, and the stage after it stays
`pending`. `busy` has a run that another program started, so a run answers
`already_running` with its id. `hello`, the default, passes. The stub has no
real trust record: `untrusted` stays untrusted, because the canvas cannot grant
trust. The other workflows begin trusted, and a save that changes a workflow's
bytes makes the next run answer `trust_required`, until a save puts the bytes
back. A name that is not one of these stops the command with a one-line
error.

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

The `editing` project (`e2e/editing`) saves over the root workflow, so it runs
only against the stub. With `WC_API_TARGET` set it is left out of the project
list, `--project=editing` fails with "not found", and the `functional` project
runs alone, read-only. The fixture that puts the sample back between tests does
nothing there, and `npm run screenshots` refuses to start. To run the write
specs, unset `WC_API_TARGET`.

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
compares the error codes, diagnostic codes, limits, patterns and the table of
keys with their slices in the stub with the contract, so a change to one
without the other fails. Another (`http/routes.test.ts`) checks that each
method and path of the contract has exactly one route in `buildRoutes`, which
asks for the token when the contract does, and that the stub serves no route
the contract leaves out.

Playwright starts the stub beside the app (`stub-api/web-servers.ts` holds its
launch code and the server list), so an end-to-end test can call it. Its launch
code works once, as the contract has it. With `WC_API_TARGET` set Playwright
does not start it, and the same tests call that server instead.

## The canvas

`src/graph/` is the core of the canvas. `buildGraph(workflow, harness)` turns
the workflow view into nodes (the intent and one per stage) and edges
(one from each node to the next, from the bottom edge of a node to the top
edge of the next), placed in one column, and marks each stage that no other
stage follows with the mark that says the run ends there (`withStopMarks`). It imports
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
  session, load, save and check the workflow, start a run, read a run);
  `createHttpApi` is its
  adapter over `fetch`. It ignores fields it does not know, refuses a reply
  that breaks the contract, and turns a failed call into an `ApiError` with a
  message fit to show.
  The harness of a session and of a run is a string that is not empty. The
  contract names `kiro-cli`, `claude` and `fake` (tests only) and lets a
  response enum gain values, so the page reads any other name too; an empty or
  missing harness is a bad reply. The page shows it on each stage as it is and
  has no control to pick one.
  `messageOf` (`api/message-of.ts`) is how every alert words a failure, and it
  adds what to do next: for no answer, or a 5xx that is not the API's (the
  answer of a proxy whose server is down), "If it stopped, start `flow view`
  again and open the address it prints."; for the API's 401 (the session is
  gone, as after the server started again), "Start `flow view` again and open
  the address it prints." An address with no launch code gets the same
  instruction. With the stub, which stands in for `flow view`, start the stub
  again.
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
  (the server was started again), clears it and tells the user to start
  `flow view` again (an address works once). A pasted code replaces the kept session only once
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
  the page run only its own files and allows no `<base>` or form target. That
  `<meta>` policy cannot set `frame-ancestors` and is only a fallback. A server
  that sends the page must send the same policy as an HTTP header, with
  `frame-ancestors 'none'` added (see **The page** in `api/openapi.yaml`). The
  server's token lasts until it stops, with no idle timeout, so a kept token
  does not change how long a session lives.
- The launch code trade (`createSession`) is the one call with no short limit:
  the code works once, so giving up after the server has taken it would leave
  the page with no way in. It is bounded in two ways. After 5 seconds with no
  answer, `launch/LaunchWait.tsx` shows "Still waiting for the server" above
  the views, with **Stop waiting**, which aborts the trade of the first load
  (`WorkflowSource.cancel`). After 120 seconds (twice the validity of the
  code) the trade ends on its own. Stopping, the limit, and a dropped
  connection all end in the same error state, which says that the server may
  have used the code and to get a new launch code from the terminal that
  printed the launch address. A reload does not retry the trade, since the
  code is removed from the address. A late answer after the
  notice appeared still opens the workflow. A pasted code is not cancellable:
  the workflow or error already on the page stays, and the 120 seconds end the
  trade.
- `workflow/WorkflowGate.tsx` shows the result before there is a workflow to
  draw: loading, error, or empty (no file yet, or a file with errors, with
  their messages). Once there is one, the Design and Run views draw it (next section).
- `canvas/` draws the graph with [React Flow](https://reactflow.dev)
  (`@xyflow/react`). Nodes cannot be moved or connected; the view can be
  panned, and zoomed with the controls. A stage can be selected, with a click
  or with Enter or Space on the node; only the Design view draws the graph.
  Each node can be reached with the Tab key and has a name for
  screen readers, which ends with "selected" for the selected stage. The view
  fits the graph again when a stage is added or deleted. The view starts zoomed out
  far enough to show the longest workflow the API allows (40 stages), where the
  text is small; use the zoom controls to read it. A node cuts a long name or
  outcome short and keeps the whole text in its `title`. A mark under the last
  stage says where the run ends.

## The Design view

The view has three columns. The left column keeps Add stage, Undo and Redo
above a Components tray. The tray lists the agents from the server and can be
filtered. Press Enter on an agent to add it at the end, or drag it onto the
drawing to insert a stage between cards or at the end. The drawing in the
middle shows the intent and each stage. The intent's `params` chip opens the
parameter declarations in the side panel, where you can edit their names,
descriptions, defaults and required state. The `goal` parameter stays present.
The side column has two panes: **YAML**, the text of
the workflow to type over, and **Properties**. The page header holds Save, the
saved or unsaved state, and the flow-check state. Properties groups the
editable stage fields (`name`, `agent` and `prompt`) above the other
server-listed fields, which stay read-only. `outcome` is included there when
the stage declares it. **Delete stage** stays at the bottom. A stage may also
have a `prompt_file`, which the page shows as a read-only path and a save
keeps. The stages run in the order they are listed, and there is no way to
link or reorder them yet.

The **YAML** pane edits the whole file. Typing over it freezes Add and every
stage field until that raw edit is saved or typed back. **Save** writes the
text exactly as shown. Typing and history steps that would replace the raw text
pause while a save is running. Undo and Redo adopt the text they show,
including when the editor already holds a different raw text.

- **Add stage** adds a stage at the end, named `agent-1` (the first free
  `agent-N`) with the agent `k-developer`, selects it and moves focus to its
  name. It is off at 40 stages, the most the API allows.
- Typing in **name** renames the stage, and the node changes at once. The name
  is taken as typed; the API is what says whether it is a good name. The
  **Complete** or **Needs a fix** mark of a stage shows only for a draft that a
  check has answered for, so it never says a draft is complete before it was
  checked.
- **agent** is a list of the agents that Konductor ships, each with a line on
  what it is for. The API does not look an agent up in this version, so the
  list is part of the page (`designer/core/agents.ts`); a file that names an
  agent not on the list keeps it, shown first, and keeps it on offer when
  another agent is chosen. There is no field to type any other id yet.
- **outcome** is shown read-only when present. It says what the stage should produce and is edited in a later step.
- **prompt** is a text area with the count of its characters against 32768, the
  limit that the contract and the specification table give (`MAX_PROMPT_CHARS`,
  which a test compares with both). The text is shown as typed, never as HTML.
  Empty text removes the `prompt` key. A line above the text area says that
  saving a prompt ends trust, so the next Run asks again; the page grants no
  trust. A stage with a `prompt_file` shows the path read-only, and the text
  area is off with the reason "This stage reads its prompt from a file." A stage
  with both keys shows the finding of the check and keeps the text area off, and
  the page picks neither. The text area is also off, with the reason, for a
  prompt that is an alias or has an anchor or a tag, for a stage with two
  `prompt` keys, and for a file that uses a `<<` merge key.
- **Outputs** edits each `stages[].outputs` declaration as a name and path row. Add and remove change only that stage's output mapping. Output names are checked against the contract before the writer runs. The writer changes scalar ranges in place, supports block and flow mappings, and refuses structural edits that could move a comment, anchor, alias, tag or duplicate key.
- **Checks** opens from the intent card and edits `intent.accept` file and run checks. Run arguments use one line each. A stage's **done_when** picker lists the declared check ids. Both writers change only their source ranges and refuse comments or YAML metadata they cannot keep safely.
- **Data links** draw each valid `{stage.output}` reference as a labelled green edge. Dragging between stage data ports or choosing **Link output to...** appends a `Read {stage.output}.` line to a later editable prompt. A source with no output first asks for a valid output name and path; a source with several asks which output to use. Cancel changes nothing. A link to the same or an earlier stage, a `prompt_file`, or a prompt whose bytes cannot be preserved shows its reason. Delete, Backspace or the selected edge's menu removes only a line created by the link action. An authored reference stays in the prompt and opens that stage for editing.
- **Delete stage** removes the stage, selects the one before it (or the next,
  for the first) and moves focus to its name. A workflow keeps at least one
  stage, so it is off for the last.
- Choosing a stage by its node (click, or Enter or Space) selects it and moves
  focus to its name. Enter or Space on the stage that is already selected also
  moves focus to its name; a click on it changes nothing. Escape on a node
  leaves focus on it. A polite live region says what was added, deleted or
  selected.

Nothing is written until **Save**. The line beside it says **No changes**,
**Unsaved changes**, **Saving** or **Saved** in a polite live region. Save
sends the whole text with `PUT /api/workflow` and the `hash` of the file as it
was loaded (`base_hash`), and takes the hash of the answer for the next save.
For form edits, the writer (`stage-text.ts`) changes only the bytes of the
values it edits, in two passes. The first writes `name`, `agent` and whole stages by line. A
stage whose `name` or `agent` changed keeps every other byte of its item: its
other keys, such as `prompt` and `prompt_file`, its comments and its layout. A
deleted stage takes its item and the comments in front of it, and a new stage
is written after the others, with its dashes where theirs are. Every byte
outside the block of stages stays as it was, so `format`, `version`, `params`,
the comments and the line endings are kept. The writer knows which stage of the
file each stage of the draft was, also after a save, so a rename is an edit of
that stage and not a new one.

The second pass writes the prompts. The line writer cannot find where a block
scalar ends, and a prompt is usually one (`>-` in `hello-plan.yml`), so
`prompt-spots.ts` finds the range of each stage's `prompt` value with the
`yaml` parser, and `prompt-text.ts` replaces only those bytes:

- Text on one line is plain when that is safe. With a `: `, a ` #`, a leading
  indicator, a space at either end or a character that YAML reads as syntax, it
  is double-quoted, with `\u` escapes for U+007F to U+009F, U+2028 and U+2029.
- Text with a line break is a literal block scalar, indented two more than the
  key. Its chomping is the text's own: `|-` for no trailing line break, `|` for
  one and `|+` for more. A first line that starts with a space gets an
  indentation indicator. Text that a block cannot hold (a control character,
  U+0085, U+2028, U+2029, a carriage return, or only white space) is
  double-quoted with escapes.
- A prompt that is a block scalar already keeps its style (`|` or `>`), its
  indentation indicator and the comment on its header line, and takes its
  chomping from the new text. Where a folded block would read back differently,
  as it does for text with line breaks, a literal block is written.
- A prompt that is not changed stays byte for byte, a block scalar included.
- Empty text removes the key and its lines. When the key shares a line with the
  dash, the key and its value up to the next key go and the dash stays. A file
  that ends without a line break still ends without one.
- A stage with no `prompt` gets a `prompt:` line after its last key, with the
  indent of its keys, before the blank lines and comments of the next stage.
- A file with CRLF line endings gets the text with CRLF, and a typed CRLF counts
  as one line break. A value written in a flow item is always double-quoted.
- The result is read again with the same parser. A prompt that does not read
  back as typed is written in the next form (a literal block, then
  double quotes), and if none reads back it is refused and never written.

A raw YAML edit saves the whole text. For form edits, the page refuses a
change it cannot write in place, says why, and keeps Save off with the reason
in its tooltip, as plain text:

- When the stages are not a list of items under a top-level `stages:` key, as
  in `stages: [...]`, or the page cannot tell where each stage starts, no
  change can be saved, and a note above the graph says so before any change.
- When a stage that changed is not written with one key to a line under its
  dash, as in `- {name: a, agent: b}`, a warning says that this change cannot
  be saved. A change to another stage of the same file is saved.
- When the `name` or `agent` that changed is not one value on the line of its
  key (a value on the next line, a block scalar, a tag or an anchor, a quoted
  value that goes on to the next line, a double-quoted value with an escape
  that JSON does not read), or does not read as the value the server gave, the
  same warning says so.
- A prompt change that cannot be written in place says why in the same
  warning: the file mixes line endings or does not read as YAML, the stage has
  both `prompt` and `prompt_file`, two `prompt` keys, or a prompt that is an
  alias or has an anchor or a tag, the file uses a `<<` merge key, the stage is
  in the flow form (`- {name: a}`) and its prompt would be added or removed, or
  the prompt is the only key on the line of its dash and would be removed. A
  prompt in the other layouts that stop a `name` or `agent` change (a value on
  the next line, a block scalar, a flow item) is edited, since the parser gives
  the range of its value.

A double-quoted value with a YAML escape that JSON cannot read, such as `\x41`
or `\e`, is refused for an in-place edit, since the page cannot tell its text.
A value that the page writes in double quotes has U+007F, U+0080 to U+009F,
U+2028 and U+2029 as `\u` escapes. YAML does not take U+007F to U+009F raw,
and a YAML 1.1 reader such as libyaml takes U+0085, U+2028 and U+2029 for line
breaks.

- **Checking.** A moment (400 ms) after the last change, the text is checked
  with `POST /api/validate`. What it finds shows under the field it is about,
  and all of it in an alert above the graph, with the name of the stage in
  front. What the last check found stays on show while you type, until the
  check of the new text answers, so the page does not jump at every key. The
  server has the last word: Save is off while the check of the current draft
  has errors, with the reason in a tooltip, and a save that goes out in the
  pause is checked again by the server. A check that cannot reach the server
  says nothing; the save checks again and reports it. Only an error stops a
  save: a warning or a note is shown as a note (a warning or info alert, and
  the text under the field in the warning style) and Save stays on.
- **A refused save** (422) shows its findings in the Design view's warning
  list. Those findings stay until the text changes; checking the unchanged text
  does not clear them. The list is about the text in the YAML box, so while
  Undo shows an earlier text it leaves them out, and Redo brings them back.
  A refusal with no error among its findings shows the
  sentence of the server as a failure, so it is never silent.
- **A conflict** (409) means the file changed after the page loaded. Nothing
  is written, and an alert says so. If the file already holds the text that was
  sent (the 409 names its hash, and the page reads the file), the earlier write
  landed and the save counts as done. Otherwise the alert offers **Copy my
  version**, which puts the draft text on the clipboard (or shows it in a box,
  if the page may not), and **Load the file again**, which loads the file from
  the server and replaces the draft. The stages cannot be changed while the file
  loads. After the load, a note keeps **Copy my version** for the text that was
  replaced. It stays while the person goes on to edit, until the file is loaded
  again or a save works, so a draft the page can write is never lost without a
  way back to it. A draft with a change the page cannot write in place has no
  text to copy: the alert offers no **Copy my version** for it, and the load
  replaces it with nothing kept. Note such a change down before loading the
  file again.
- **A read-only workflow** (the server says `read_only`) can be looked at, and
  a stage can be selected. Its name and agent cannot be changed. Prompt fields
  and YAML stay readable and copyable but cannot be changed. **Add stage**,
  **Delete stage**, **Save**, **Undo**, **Redo**, and their shortcuts are off.
  A note says why, and each disabled button stays focusable and gives the same
  reason in a tooltip.
- **A save whose answer is lost** (no answer, a server error, or a 200 that the
  page cannot read) may still have written the file. The page reads the file
  again: if it holds the text that was sent, the save counts as done. If it
  does not, the failure is shown in an alert, and Save can be tried again. If
  the file cannot be read either, the alert says "The save did not finish" and
  that it is not known whether the file was written.
- **Any other failure** of a save shows its sentence in an alert, and Save can
  be tried again. When the session is gone (the API's 401, or a 401 from a
  proxy), the sentence adds that the changes on the page are lost when the
  launch address is opened again. A check that meets a lost session says so at
  once, under "The session is lost", as no save can work then.
- **Focus and keys.** Everything above works with the keyboard: Tab to **Add
  stage** and press Enter; the new stage's name has focus. A button that is off
  (Save, Add stage, Delete stage) stays focusable and gives the reason in a
  tooltip, so focus stays on the button that was pressed, for instance Save
  while it saves.
- **Switching views.** The draft lives in `App`, so it is kept when you switch
  views. A run uses the saved file, not the draft.

While the draft differs from the saved file, closing or reloading the page
makes the browser ask whether to leave (`useLeaveGuard`, a `beforeunload`
handler that is on only then), because the draft lives in the page. A change
that is put back, so the draft equals the file again, does not ask, and nor
does a draft that has been saved.

The code follows the split of the Run view:

- `src/designer/core/` is the core and does no IO: the draft of the stages, the
  text that a save writes (`stage-text.ts`, `prompt-text.ts`), the findings put on the stage and
  field they are about (`problems.ts`), the state of the editor and its
  reducer, and the two loops that check (after a pause) and save. Its ports
  are `EditPort` (save, check and reload) and the `Scheduler` of the run core,
  so a test moves time by hand and nothing sleeps.
  `test-support/designer-purity.test.ts` fails if the core imports anything
  but its own modules, the wire types, `messageOf` and the scheduler port, or
  reads a clock, randomness, the environment or the network. The one package it
  may import is `yaml`, and only in `prompt-spots.ts`.
- `createHttpApi` has `saveWorkflow` and `checkWorkflow`; `loadWorkflow` ties
  them to the session token as the `EditPort`, and turns a 409 `conflict` and
  a 422 `invalid_workflow` (with its `diagnostics`) into the core's own errors.
- `useEditor` keeps the state in `App`; `DesignView`, with `SaveControls` and
  `EditAlerts`, draws it. `useLeaveGuard` asks the browser to
  confirm leaving while the draft has changes. A stage keeps an id of its own
  while it is renamed, and the node is named from that id, so two stages with
  one name for a moment still have two nodes.
- The API contract is unchanged. `test-support/editing-contract.test.ts`
  checks the limits and calls that the Design view assumes against it.

## The Run view

The view has a **Goal** box, one box for every other param the workflow
declares, and a **Run** button. It then shows the declared checks and the run as
it is followed: how far it has got, its stages with the detail and console of
the one picked, and the past runs of the workflow. It draws no graph; the
drawing is the Design view's. The goal and other inputs start with their
declared defaults. Run stays off until the goal and every required input have
values that fit the contract.

- **Run** calls `POST /api/run` with the goal and the other input values, then
  follows the run through `GET /api/runs/{id}/events`, a long poll the server
  may hold open for `LONG_POLL_WAIT_S` seconds. Run is off from the click until
  the run ends. The input boxes stay editable, so the inputs of the next run
  can be typed while one goes on. Enter in the Goal box starts a run, like the
  button; Enter in another input adds a line.
- If the server answers 409 `already_running`, as it does when a run from
  another tab is going, the page follows the run named in that answer instead
  of starting one, and the inputs typed are not used for it. The API does not
  give that run's inputs, so while it goes the input boxes are read-only and
  say "Not known"; they come back with the typed values or defaults once the
  run has ended.
- Resume works after a reload, though the launch code works once: the page
  resumes from the session it kept (see above). The page keeps the id of the
  latest run in the storage of the browser tab (`sessionStorage`; the id is no
  secret) and drops it once the run has ended or turns out to be gone. When
  the page opens again with a session it reads that run's events from the
  start, so the stages and the console lines the server still holds come back.
  A run that has ended, one the server will not give (for instance after it
  started again) or a browser that blocks storage leaves the page ready for a
  new run.
- Pasting another launch address into the open tab lets go of the run: the
  page stops following it, shows no run and forgets its id. The run goes on at
  its server. The Goal box and Run belong to the workflow that is open.
- A failed call is tried again after `RETRY_FIRST_MS`, doubling to
  `RETRY_MAX_MS`, until `MAX_FAILURES_IN_A_ROW` have failed in a row; then the
  follower gives up and the alert offers **Follow again**, which reads on from
  where the reads stopped. A 401 ends the follower with its own alert: the
  server no longer knows the session. A call that brings nothing new waits
  `MIN_POLL_GAP_MS` before the next one.
- A line above the stages says where the run is ("Running draft. 0 of 2 stages
  passed."), with a bar of the stages that passed or stopped it and the
  elapsed time. A screen reader hears each change from a polite live region
  that `App` keeps outside the views, so it is announced while the Design view
  is open too; the line itself is not a live region, or the change would be
  heard twice. For a halted run it ends with the sentence of the blocked
  stage's reason, or the code when the page does not know it.
- **Checks** lists every check from `intent.accept`. Before a run reports a
  state, a check is **Deferred**. The page reads `GET /api/runs/{id}` when a
  run starts and as its stages pass, then shows **Verified**, **Failed** or
  **Deferred** beside each check. A stage also lists the checks named by its
  `done_when`. A failed check-state read leaves the declarations visible and
  shows a warning; it does not poll the whole run.
- While Design has changes that are not saved, a note at the top of the Run
  view says that a run uses the saved workflow, so the draft is not what runs.
- Each stage of the run is a button in the Tab order. Picking one shows its
  detail next in the Tab order: where it is, why it stopped the run when it is
  blocked, and its console lines. The lines are live only, as the server drops
  them a minute after the run ends, and the page keeps at most
  `CONSOLE_LINES_PER_RUN` of them.
- The stage that stopped a run shows the code of its `reason` (such as
  `RESULT_MISSING`) and one sentence for each code the contract lists. A code
  the page does not know is shown as it is, and a blocked stage with a missing
  or empty `reason` shows with its name and no reason, as the contract has a
  client treat a reason it does not know like any other blocked stage.
- The past runs come from `GET /api/runs`, newest first, with the state, id,
  start time and goal of each. A goal the server cut ends in a mark, and an
  empty goal says so; the goal is text, never markup. The list is read again
  once the run has ended. When it cannot be read, a warning says so and the
  rest of the view goes on working.
- A Run that the server answers with 409 `trust_required` opens a dialog. It
  shows the `fix` of the answer and its command, such as
  `konductor flow trust hello`, with **Copy**, which copies the command, and
  **Run again**, which asks for the same run with the goal and other inputs of
  the refused start. The command and **Copy** show only when the command is
  `konductor flow trust` and the name of the workflow on the page, since the
  text comes from the server and is meant for a terminal; for any other `fix`
  the dialog shows the sentence alone, as plain text. The page never grants
  trust: the person runs the command in a terminal. A save that changes the
  file ends its trust, so the next Run asks again. **Close** leaves the error
  under the Run button and the rest of the view as it was, and a Run again
  that meets another error shows it as any error is shown.
- An error from the API, whether the run does not start or the reads fail,
  shows in one alert under the Run button, with the sentence the server gave
  and each name in backticks shown as code. A screen reader hears the same
  sentence, without the backticks, from an alert region that `App` keeps
  outside the views, so it is read when it appears even if the Design view is
  open. A failed stage is a result, not an error, so it has no alert. A start
  that gets no answer, or is accepted in a reply the page cannot read, says
  that it is not known whether the run started and asks for a reload, since a
  second start could run the workflow twice. The goal is one line: line breaks
  in the default become spaces, and Enter that ends an input method
  composition starts no run.
- A workflow can be saved while a run goes on. The run works from the file as
  it was saved when it started, so its stages can differ from the ones the
  Design view now draws; the stages of the run are the ones listed here.
- A run goes on while the Design view is open, because the page follows it,
  not the view that draws it. Coming back shows it as it is, with the Goal box
  as it was. Closing the page stops the reading, not the run.

The code follows the ports-and-adapters split of the graph:

- `src/execution/core/` and `src/run-client/` are the core and do no IO: the
  run as the events build it (`run-follow.ts`), how far it has got
  (`run-progress.ts`), the detail and console of a stage, the past runs, the
  sentences of the reasons of a blocked stage, the goal rules and the command
  of a `trust_required` answer. Their ports are `RunPort` (start a run),
  `ReadEvents` (read its events) and `Scheduler` (wait for some
  milliseconds), so a test moves time by hand and nothing sleeps. Two tests
  (`test-support/execution-purity.test.ts` and `run-client-purity.test.ts`)
  fail if they import anything but their own modules, the graph core and the
  wire types, or read a clock, randomness, the environment or the network.
- The adapters are `createNextPorts` (`startRun`, `readEvents`, `readChecks`
  and `listRuns`), `timerScheduler`, and `sessionRunMemory`, which keeps the id
  of the latest run for the resume after a reload. The token is held only by
  those calls. `createNextPorts` ends ordinary calls after 15 seconds, leaves
  the long poll to the follower's timeout, turns a 409 `already_running` with
  a `run_id` into `RunAlreadyActive`, and turns a 409 `trust_required` into
  `RunNeedsTrust`.
- `useRunController` keeps the run in `App`, so a change of view cannot stop
  the only follower of a run, and `RunView` draws what it holds. The Design
  and Run views share `WorkflowGate` (loading, error and empty states).

## Theme

The page uses a warm paper palette in light mode and deep violet surfaces in
dark mode. Both use Outfit for text, JetBrains Mono for code and small labels,
and a violet accent.

- `src/theme/tokens.ts` holds every colour, font and radius of the theme, as
  two palettes and the Cloudscape token map built from them. Nothing else
  names a colour of Cloudscape. The colours of the canvas itself are in
  `src/canvas/canvas.css`, with their dark values under
  `:root[data-theme='dark']`. A test checks that they match the palettes.
- `src/theme/install.ts` applies the token map with `applyTheme` from
  `@cloudscape-design/components/theming` (colours, fonts and radii only,
  with a value for each mode), publishes the active palette as `--wf-*` CSS
  variables, and switches the mode with `applyMode` from
  `@cloudscape-design/global-styles`. The root element gets `data-theme` (`light` or `dark`) and `color-scheme`; a
  small script in `index.html` sets both before the first paint, so a dark page
  does not flash white.
- `src/theme/fonts.ts` loads Outfit and JetBrains Mono from the pinned
  `@fontsource/outfit` and `@fontsource/jetbrains-mono` packages (SIL Open
  Font License 1.1). The Latin files are bundled, so the page makes no request
  to a font site.
- The top bar (`src/chrome/TopBar.tsx`) has the product mark and name, Library
  and Canvas places, and the **Theme: light** / **Theme: dark** button. The
  first visit follows the
  system setting (`prefers-color-scheme`). Pressing the button saves the mode
  in local storage (`src/theme/mode.ts`), and the saved mode wins from then
  on. A page that was never switched keeps following the system, but only as it
  was at load: a later change of the system setting, or of the choice in
  another tab, shows after a reload.
- The page header has the uppercase breadcrumb `Workflows > <workflow>` (the
  page has no separate workflow index, so no crumb is a link), the workflow
  name as the title ("Workflow canvas" until one has loaded), and the Design
  and Run switch. Beside it are the saved, unsaved or running state, the flow
  check, and Save on Design. The switch is a tab list drawn as segments: Tab
  reaches the selected one, and the arrow keys, Home and End select another.
- The intent is a wider purple card. Each stage is a card with a deterministic
  two-letter agent tile, its name, `agent · harness`, and one line for the stage
  outcome or the first prompt line. A stage with `prompt_file` and no outcome
  shows no prompt text. The card's `title` keeps the full source text.
- Run-order ports are green dots, 10 pixels across, in the middle of the top
  edge (in) and the bottom edge (out). A link runs from the bottom edge of one
  card to the top edge of the next. The selected stage has a purple ring, and
  the last stage keeps the mark that says where the run ends.
  `src/canvas/card-shape.ts` holds the
  card outline, the focus ring sizes and the dot size. The keyboard focus ring
  follows the rounded outline of the card.

Text meets WCAG 2 AA (4.5:1) in both modes, and the edges of controls, nodes,
ports and the selected segment of the switch reach 3:1. `src/theme/tokens.test.ts`
and `test-support/canvas-contrast.test.ts` check each of these colour pairs
for the palettes, the band and the canvas in both modes, and the end-to-end
tests run axe (which checks text contrast) in both modes and read the colours
of the switch.

## End-to-end tests

The tests in `e2e/tests/` drive the production build in headless Chromium.
`playwright.config.ts` builds the app and serves it with `vite preview` on
http://127.0.0.1:4173, so no server needs to be running first. Its `webServer`
list is where a backing service starts when the app needs one.

A launch code works once, so `e2e/global-setup.ts` trades the code of the
config for a session once per run, and the `canvas` fixture of
`e2e/support/fixtures.ts` answers the page's own `POST /api/session` with that
session. Every other call, such as `GET /api/workflow`, reaches the API. A
test that needs the error state opens the page with a wrong code or none.
A test that answers the session call with a token of its own sends the calls
the views make with it (`GET /api/agents`, `GET /api/runs`) on with the token
the server knows, or their 401 drops the session under the test.

Port 4173 must be free, or set `WC_APP_PORT` to another port (`WC_APP_PORT=4300
npm run test:e2e`). The config never reuses a server, so a `vite preview` you
left running on that port makes the run fail at startup; stop it first.

Install the browser once (on Linux add `--with-deps` to also install system
libraries):

```bash
npx playwright install chromium
```

Then `npm run test:e2e`. It has two Playwright projects. `functional`
(`e2e/tests/`) does not save to the stub. `editing` (`e2e/editing/`) does, so it
runs after `functional` has finished; one red functional test makes the editing
tests report "did not run". The editing project runs on one worker
(`workers: 1`), so all its files run one after the other, and
`fullyParallel: false` keeps the tests of each file in order. The `sample`
fixture of `e2e/support/editing-fixtures.ts` still fails a test that finds
itself in another worker, because the stub keeps one workflow for all of them.
To run only the
editing tests, add `--no-deps`, or `functional` runs first as its dependency.
The stub keeps what is saved until it stops, so the fixture puts the sample
workflow back before and after each test, and a test that needs the file changed
by someone else writes it itself (`e2e/support/stub-workflow.ts`, which fails on
a refused call). The editing test saves the prompt of a stage and finds it
again after a reload; the saves that go wrong are covered in the unit tests of
the Design view and its editing core.
A test that says a save "writes nothing" counts the `PUT` requests that the page
sent; the file is checked only where a request reaches the stub. The HTML report
is written to `playwright-report/`; open it with `npx playwright show-report`.
Accessibility is checked with axe-core on each view, on the error state, on the
Run view with a stage running, a stage that stopped the run, a passed run, the
error of the API, a goal that cannot be run and the trust dialog, and in both
theme modes.

The stub runs one run at a time and never fails a stage. So a test that starts
a real run on it waits for the end of the run, and the tests of a stage that
stopped the run, a refused run and a run that is still going answer the run
calls themselves (`e2e/support/run-routes.ts`).
A test that starts another run on the stub must also wait for its end, or the
next test gets a 409. For the same reason, if that one test fails and Playwright
retries it, the retry gets a 409 and follows the run still going.

Shared page objects and helpers live in `e2e/support/`. New tests should
extend them rather than repeat selectors: import `test` and `expect` from
`e2e/support/fixtures.ts` to get a `canvas` fixture that has already opened
the app.

## Screenshots

`npm run screenshots` saves full-page PNGs to `e2e/screenshots/`, drawn from
the stub, at 1280x800 with animations frozen. The runs in the Run view
captures answer with fixed replies, so no capture depends on the clock of the
stub. The Design view is saved as it opens (`next-design.png`), in the dark
theme (`next-design-dark.png`, after the theme button is pressed), with the
keys of a stage (`next-design-properties.png`), with the prompt of a
`hello-plan` stage being edited (`next-design-prompt.png`) and with a stage
that reads its prompt from a file (`next-design-prompt-file.png`). It is also
saved with unsaved edits (`next-design-editing.png`, and
`next-design-editing-dark.png` in the dark theme), after a save
(`next-design-saved.png`), with a problem the server found
(`next-design-problems.png`), when the file changed on disk
(`next-design-conflict.png`) and with a change it cannot write in place
(`next-design-not-in-place.png`). The Run view is saved before a run
(`next-run-idle.png`), while the first stage runs (`next-run-running.png`),
after the run passed (`next-run-passed.png`, and
`next-run-passed-dark.png` in the dark theme), after a stage stopped the run
(`next-run-halted.png`) and with the trust dialog open
(`next-run-trust-required.png`). Pull request descriptions embed these files,
so regenerate and commit them when the UI changes.

Only that script writes the PNGs. It uses its own config,
`playwright.screenshots.config.ts`, so `npm run test:e2e`, a bare
`npx playwright test` and editor integrations never touch committed files.

The capture waits until the bundled Outfit and JetBrains Mono faces are loaded
and turns off text hinting and LCD smoothing, so the PNGs come out
byte-identical on different machines and in CI. CI regenerates them, uploads
that set as the `screenshots` artifact, and fails when it differs from the
committed files.

`next-run-trust-required.png` is the one exception. With the dialog open, an
arm64 host draws the dimmed page in the tiles next to the dialog one level of
colour off from CI, which runs on x86-64. The committed file is the one CI
draws, so on an arm64 host take it from the `screenshots` artifact of a CI run
instead of committing your own.

The comparison is byte-exact, so CI fails if a committed screenshot differs by
even one byte. After a toolchain bump (Playwright, Chromium, fonts or Node), run
`npm run screenshots` and commit the new images.
