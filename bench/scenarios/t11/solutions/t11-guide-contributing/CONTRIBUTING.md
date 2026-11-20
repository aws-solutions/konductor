# Contributing to Whistleline

Thanks for improving the cue parser and its command line output. Small, focused changes are easiest to review.

## Before you start

- Use Node.js 24.4.1. The supported major version is Node.js 24.
- Clone the repository and work from its root directory.
- This package has no runtime dependencies, so there is no dependency installation step.
- Read the relevant example in `examples/` before changing cue behavior.

## Test commands

The default test command is `npm test`, and it runs the unit suite only.

Run the integration suite separately. It needs the `INTEGRATION=1` environment variable.

```sh
INTEGRATION=1 npm run test:integration
```

Run both suites before a broad change with `npm run test:all`.
The integration files skip themselves when that environment variable is absent.

## Linting

Run the repository lint check with:

```sh
npm run lint
```

Keep a final newline in JavaScript files and avoid unrelated formatting changes.

## Commit messages

Commit messages use the form `type(scope): subject`.
The scope is required and should identify the area changed.
Allowed types are `add`, `change`, `fix`, `docs`, `test`, `chore`, and `release`.
Keep the subject to 72 characters or fewer.
Use a lowercase scope, for example `fix(parser): reject empty cue text`.

## Branches and pull requests

Pull requests target the `trunk` branch.
Create a short-lived branch for each change and rebase it before requesting review.
The required CI jobs that must pass are `unit`, `integration`, and `lint`.
The pull request description should explain the behavior change and list the commands run.

## Generated code

The files under `src/generated/` come from the repository manifest.
Do not edit generated files directly.
When command metadata changes, edit the source manifest and run `npm run generate`.
Review the generated diff before committing it.

## Releases

Only the release process from the `trunk` branch may create a release.
The release script refuses to run from another branch.
Release tags use the `v<version>` format, such as `v2.7.0`.
Update the changelog with user-visible notes before a release review.

## Reviews and ownership

Open a draft pull request when feedback on the direction would help.
Ask for review from `@lantern-labs/cli-maintainers`, the owner team for the package.
Include tests for parser or formatter changes and a small input example for syntax changes.
Respond to review comments with a follow-up commit or an explanation in the pull request.
Keep generated output, documentation, and tests in the same change when they describe the same behavior.

## A final checklist

- The unit suite passes with `npm test`.
- Integration checks pass with `INTEGRATION=1 npm run test:integration`.
- `npm run lint` passes.
- The commit subject follows the allowed format.
- The pull request targets `trunk` and all required CI jobs pass.
