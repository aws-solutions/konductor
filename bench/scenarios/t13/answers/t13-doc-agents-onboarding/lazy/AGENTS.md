# Working in Harborline

This file is the short operating guide for coding agents. Treat the repository as the source of truth when an older guide disagrees with automation or a current ADR. Keep changes narrow, preserve the CommonJS module setting, and do not put credentials in source, logs, or commits.

## Setup and checks

Use Node 14, as required by the repository runtime metadata and CI, and pnpm 9. A setup is sound when `pnpm typecheck` can inspect the TypeScript tree. The supported commands are:

- `pnpm build`: compile the TypeScript source.
- `pnpm typecheck`: run the compiler without emitting files.
- `pnpm test`: run the Vitest suite once.
- `pnpm test:watch`: keep the Vitest suite running while editing.
- `pnpm lint`: run ESLint over the repository.
- `make dev`: start the built service with `.env.local`; use only local values.
- `make db-reset`: reset the local database only. Inspect `DATABASE_URL` first.

## Repository conventions

Use named exports in TypeScript. The accepted ADR forbids default exports. Commits use Conventional Commits in the form `type(scope): message`, and branch names use `<user>/<short-topic>`. The recent history shows ordinary, unsquashed merges, so do not rewrite a branch merely to manufacture a squash merge. Before review, run the relevant build, typecheck, lint, and test checks, explain operational impact, and include focused tests or a reason they do not apply.

## Retired guidance

The following old-guide rules no longer hold:

```json
{
 "commands": [
  {
   "purpose": "Set up and validate the supported runtime",
   "command": "pnpm typecheck"
  },
  {
   "purpose": "Compile the service",
   "command": "pnpm build"
  },
  {
   "purpose": "Run the test suite once",
   "command": "pnpm test"
  },
  {
   "purpose": "Run static analysis",
   "command": "pnpm lint"
  }
 ],
 "conventions": [
  {
   "rule": "Use Node 20 for the supported checks.",
   "source": ".github/workflows/ci.yml:12"
  },
  {
   "rule": "Use pnpm 9 for repository scripts.",
   "source": "package.json:5"
  },
  {
   "rule": "CI supplies SERVICE_SIGNING_KEY from a secret.",
   "source": ".github/workflows/ci.yml:14"
  },
  {
   "rule": "Local configuration includes SERVICE_SIGNING_KEY, DATABASE_URL, and PORT.",
   "source": ".env.example:1"
  },
  {
   "rule": "Branches use <user>/<short-topic>.",
   "source": "git-log.txt:18"
  }
 ],
 "retired": [
  "npm install setup",
  "npm run test:unit"
 ]
}
```
