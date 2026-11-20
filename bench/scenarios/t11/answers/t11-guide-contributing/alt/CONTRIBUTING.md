# Whistleline contributor notes

This page is the short route from a clean checkout to a reviewable change.

## Machine and checkout

1. Select Node.js 24.4.1. Whistleline supports the Node.js 24 line.
2. Work at the repository root.
3. There are no package dependencies to install.
4. Try an example from `examples/` when changing parsing or output.

## A quick verification pass

The unit-only command is:

```text
npm test
```

Integration checks are opt-in because they exercise the command line and filesystem.
Set the environment flag in the same command:

```text
INTEGRATION=1 npm run test:integration
```

`npm run test:all` is convenient when both suites need to run.

For style checks, use:

```text
npm run lint
```

## Commit shape

Use `type(scope): subject` for each commit.
A scope must be present, and it should be a short lowercase area name.
The allowed type names are `release`, `chore`, `test`, `docs`, `fix`, `change`, and `add`.
A subject may contain at most 72 characters.
For example, `docs(guide): clarify the integration command` has a useful scope.

## Change routing

Make a branch for the change and open the pull request against `trunk`.
The required CI jobs are `unit`, `integration`, and `lint`; all three must pass.
Describe the user-visible result, test commands, and any migration detail in the request.
Keep review conversations in the pull request so later readers can follow the decision.

## Files produced by the generator

`src/generated/` is checked in for consumers that load the command table.
Do not edit generated files by hand.
Change the manifest input, then run `npm run generate` and inspect the result.
A generated diff should be included only when its input changed.

## Shipping a version

Release preparation is permitted only from `trunk`; the release script rejects another branch.
The tag is written in the `v<version>` form, for example `v2.7.0`.
Add a user-facing entry to `CHANGELOG.md` and have the owner team review it before shipping.

## Review etiquette

Keep a pull request narrow enough that a reviewer can reproduce its behavior.
Attach a small cue sample when a syntax rule changes.
Add or update unit coverage for library behavior and integration coverage for process behavior.
Explain a deliberate test omission instead of leaving the reviewer to infer it.

The package owner is `@lantern-labs/cli-maintainers`.
That team can route questions about release timing, generated files, or compatibility.

## Before requesting approval

- `npm test` is green for the unit suite.
- `INTEGRATION=1 npm run test:integration` is green for integration coverage.
- `npm run lint` is green.
- The commit uses an allowed type, a required scope, and a subject within 72 characters.
- The pull request is aimed at `trunk` and the required CI jobs pass.
