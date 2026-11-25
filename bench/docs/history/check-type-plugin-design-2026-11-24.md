# Design: check types as plugins

Date: 2026-11-24. Status: built, all four steps (2026-11-25; see BACKLOG B-004). Rows: DEBT D-269, BACKLOG B-004.

## The problem

A task check is a small rule run on the agent's folder: a file exists, a file holds a pattern, a command exits 0, the
hidden tests pass. There are eight types today. Adding a ninth means editing the core in three places:

1. `bench/runner/lib/check-matcher.js`: the `CHECK_TYPES` list and an `if` branch in `evalCheck`.
2. `bench/schema/task.schema.json`: the `type` enum and the new fields in `checks.items.properties`.
3. `bench/tasks/validate-tasks.js`: the shape rules in `validateShape` (for example "`min` must be an integer") and
   the stub rule in `proveStub` (which types count as a real check that a keyword stub must fail).

A missed edit shows up late: the schema refuses a task the matcher could score, or the validator lets through a
check the matcher calls unknown.

## The fix in one line

A check type becomes a registry part of a new plugin kind, `check-type`, the same way judge backends became parts of
kind `judge-backend` (`bench/judge/backends.js`). The eight built-ins are parts too. The matcher, the validator and the
schema all read the one list.

## What a check-type part declares

One frozen descriptor (`meta.js`, no requires) and one module (`entry`):

| field | where | what it does |
| --- | --- | --- |
| `id` | meta | the `type` string a task writes, for example `json_path` |
| `fields` | meta | the JSON Schema of the check's own fields (`{ path: {type: string}, min: {type: integer} }`); `type`, `weight`, `kind`, `id` and `name` stay common and live in the core schema |
| `required` | meta | which of `fields` a check must set |
| `realCheck` | meta | true when a keyword-only stub failing this check counts (today `min_matches`, `cmd`, `labelled_findings`) |
| `evaluate(root, check, opts)` | entry | returns `{ passed, detail }`, like `evalCheck` today; it gets `resolveInside` and `symlinkOnPath` from the core and must use them for every path |
| `shapeErrors(check)` | entry | returns a list of problems for the validator (`min must be an integer >= 1`); empty when the check is fine |

What stays core and is not a plugin: `tests` (hidden suites, timeouts, the hard and autonomy proofs read its counts),
`cmd` (it runs in the sandbox with the env allowlist), and `fixture_unchanged` (it needs the pristine copy). These three
stay in the core table, so the safety rules around commands and hidden files never move into a plugin. A plugin type
reads files only; it gets no way to run a command.

## How each core part reads the list

- `check-matcher.js`: `CHECK_TYPES` becomes `checkTypes().ids()`. `evalCheck` keeps its three core branches, then
  looks the type up and calls `evaluate`. An unknown type still fails the check with `unknown check type X`.
- `task.schema.json`: the file keeps the eight built-in types. The schema loader (`bench/runner/lib/schema.js`) adds
  each plugin's id to the enum and its `fields` to `checks.items.properties` when it loads the task schema. A plugin
  field that clashes with a core field, or with another type's field of another JSON type, refuses the plugin.
- `validate-tasks.js`: `validateShape` calls `shapeErrors` for the type; `proveStub` asks `realCheck` instead of
  naming three types.
- `cap/criteria.js` `CONTENT_FIELDS`: it reads the loaded schema, so a plugin's fields join the content id. A task
  without the plugin's fields hashes the same as before, so no saved content id changes.

## How we know it works

The done-when of D-269: one test adds a check type with no core edit. It writes a plugin folder under a scratch
plugin root (`json_path`: a JSON file's value at a dotted path equals a value), then checks that:

1. the task schema accepts a task with that check and refuses one with a bad field;
2. `evalCheck` passes it on a folder with the right value and fails it on one without;
3. `validate-tasks.js --only-extra` accepts a task using it, and refuses a check whose `shapeErrors` is not empty;
4. a plugin that names `cmd` or `tests` as its id is refused (core names are taken);
5. the eight built-in types score every shipped task's reference the same as before (the validator's full run, OK).

## Order of work

1. Move the five read-only built-ins (`file_exists`, `contains`, `not_contains`, `min_matches`,
   `labelled_findings`) into one table of parts in the core, with the same results; the validator's full run and
   `checks-solutions.test.js` must not change. No new behaviour.
2. Add the `check-type` kind to `core/registry.js` and the plugin lookup, with the test above.
3. Point the schema loader, the validator and `CONTENT_FIELDS` at the list.
4. Update `docs/write-a-plugin.md` with a third kind and `docs/tasks.md` with how to add a check type.

Each step is one commit with its tests. Step 1 changes no score; it is safe to do while a run is live, because a live
run reads its own frozen checkout.

## What this does not do

It does not make unit kinds or report sections plugins (B-004's other parts; unit kinds already read one table,
`cap/unitkinds.js`), and it does not touch the `bench.js` command chain. It does not let a plugin change how `tests`
checks are scored.
