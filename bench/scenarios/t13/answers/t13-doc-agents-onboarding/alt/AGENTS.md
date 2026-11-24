# Working in Harborline

This file is the short operating guide for coding agents. Treat the repository as the source of truth when an older guide disagrees with automation or a current ADR. Keep changes narrow, preserve the CommonJS module setting, and do not put credentials in source, logs, or commits.

## Retired guidance

The following old-guide rules no longer hold:

- `npm install` is not the setup command.
- `npm run test:unit` is not a repository script.
- `feature/<ticket>` is not the branch form.
- Squash merges are not the repository's observed merge practice.

```json
{
 "retired": [
  "squash merges",
  "feature/<ticket> branches",
  "npm run test:unit",
  "npm install setup"
 ],
 "conventions": [
  {
   "source": "user",
   "rule": "make db-reset is local only and must never target a shared or staging database."
  },
  {
   "source": "user",
   "rule": "Deploy on every merge to main; there is no release branch and no release day."
  },
  {
   "source": "user",
   "rule": "One approval from the platform-core team is enough, except anything under src/auth/ needs two."
  },
  {
   "source": "docs/adr/0007-no-default-exports.md:6",
   "rule": "TypeScript modules use named exports and no default export."
  },
  {
   "source": "git-log.txt:2",
   "rule": "Commits use Conventional Commits in type(scope): message form."
  },
  {
   "source": "git-log.txt:18",
   "rule": "Branches use <user>/<short-topic>."
  },
  {
   "source": ".env.example:1",
   "rule": "Local configuration includes SERVICE_SIGNING_KEY, DATABASE_URL, and PORT."
  },
  {
   "source": ".github/workflows/ci.yml:14",
   "rule": "CI supplies SERVICE_SIGNING_KEY from a secret."
  },
  {
   "source": "package.json:5",
   "rule": "Use pnpm 9 for repository scripts."
  },
  {
   "source": ".github/workflows/ci.yml:12",
   "rule": "Use Node 20 for the supported checks."
  }
 ],
 "commands": [
  {
   "command": "make db-reset",
   "purpose": "Reset a disposable local database"
  },
  {
   "command": "make dev",
   "purpose": "Start the service with local configuration"
  },
  {
   "command": "pnpm test:watch",
   "purpose": "Watch tests during edits"
  },
  {
   "command": "pnpm lint",
   "purpose": "Run static analysis"
  },
  {
   "command": "pnpm test",
   "purpose": "Run the test suite once"
  },
  {
   "command": "pnpm build",
   "purpose": "Compile the service"
  },
  {
   "command": "pnpm typecheck",
   "purpose": "Set up and validate the supported runtime"
  }
 ]
}
```

## Repository conventions

Use named exports in TypeScript. The accepted ADR forbids default exports. Commits use Conventional Commits in the form `type(scope): message`, and branch names use `<user>/<short-topic>`. The recent history shows ordinary, unsquashed merges, so do not rewrite a branch merely to manufacture a squash merge. Before review, run the relevant build, typecheck, lint, and test checks, explain operational impact, and include focused tests or a reason they do not apply.

One approval from the platform-core team is enough, except anything under `src/auth/` needs two. We deploy on every merge to main. There is no release branch and no release day. `make db-reset` is local only. Never run it against a shared or staging database. These three statements came from the colleague and are recorded here as user-supplied team facts.

## Setup and checks

Use Node 20, as required by the repository runtime metadata and CI, and pnpm 9. A setup is sound when `pnpm typecheck` can inspect the TypeScript tree. The supported commands are:

- `pnpm build`: compile the TypeScript source.
- `pnpm typecheck`: run the compiler without emitting files.
- `pnpm test`: run the Vitest suite once.
- `pnpm test:watch`: keep the Vitest suite running while editing.
- `pnpm lint`: run ESLint over the repository.
- `make dev`: start the built service with `.env.local`; use only local values.
- `make db-reset`: reset the local database only. Inspect `DATABASE_URL` first.

CI selects Node 20, enables pnpm 9, installs from the lockfile without changing it, and then runs lint, typecheck, and test. The workflow supplies `SERVICE_SIGNING_KEY` from the repository secret. Local configuration names are documented in `.env.example`; the signing key and database URL must be treated as secrets.
