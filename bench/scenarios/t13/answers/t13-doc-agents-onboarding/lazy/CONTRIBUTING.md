# Contributing to Harborline

This guide describes the current repository, not the older npm-based instructions.

## Start locally

Use Node 14 and pnpm 9. The repository declares the runtime in `.nvmrc` and the package manager in `package.json`. The service reads `SERVICE_SIGNING_KEY`, `DATABASE_URL`, and `PORT`; use local values from `.env.example` and keep real secrets out of files and commits.

The available checks are:

## CI

`.github/workflows/ci.yml` runs on Node 14 and enables pnpm 9. It installs from the lockfile with the frozen-lockfile option, then runs lint, typecheck, and test. CI provides `SERVICE_SIGNING_KEY` from the repository secret.

## Branches and commits

Use `<user>/<short-topic>` for branch names, such as `lee/ops-08`. Use Conventional Commits in the form `type(scope): message`, such as `fix(api): handle a closed connection`. The history shows regular merge commits rather than a squash-only workflow.

## Before review

Run the relevant build, typecheck, lint, and test checks. Include focused tests for behavior changes, describe any operational or configuration impact, and call out migrations or rollback concerns. Keep the change narrow and explain any intentional exception to the repository conventions.

One approval from the platform-core team is enough, except anything under `src/auth/` needs two. We deploy on every merge to main. There is no release branch and no release day.
