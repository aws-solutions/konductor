# Web App Functional Test Generation

## Overview

Discovers a deployed web application via browser automation, then generates either:

- **Unit test prompts**: structured markdown test cases written to `{prompts_dir}` (default `{project_root}/tests/page/`)
- **Functional tests**: executable Cypress or Playwright specs, bootstrapped into a new project or added to an existing one

Use this SOP when the user has a deployed web app and wants test coverage generated from live discovery.

This SOP splits work across `k-browser` (browser automation only), `k-quality-assurance`, and `k-developer` (shell/git only). The orchestrator itself does not execute shell commands or write files. That split buys tool specialization (least privilege): each agent gets only the tool grants its step needs, and any login credentials pass through `k-developer`'s isolated shell rather than through the orchestrator's own context, keeping the secret out of a place a compaction or summary could later expose it.

**Do NOT use for:** unit testing source code logic, API-only testing, or apps that require non-browser authentication (e.g., mTLS, client certificates).

> **Browser note:** The browser agent uses Playwright's bundled **Chromium** (not system Chrome). This avoids the "Browser is already in use" error when Chrome is open on Mac. If the target app requires authentication, provide `username`/`password` or a `credentials_file`. See Parameters below.

## Parameters

| Parameter          | Required                                                      | Description                                                                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`              | Required unless `credentials_file` supplies it via `test_url` | URL of the deployed web application                                                                                                                                                                                                                                       |
| `output_mode`      | Required                                                      | One of `unit-prompts` \| `cypress` \| `playwright`                                                                                                                                                                                                                        |
| `project_mode`     | Required when `output_mode` is `cypress` or `playwright`      | One of `bootstrap` \| `add-to-existing`                                                                                                                                                                                                                                   |
| `project_dir`      | Required when `project_mode` is `add-to-existing`             | Path to the existing test project root                                                                                                                                                                                                                                    |
| `username`         | Optional                                                      | Login username if the app requires authentication                                                                                                                                                                                                                         |
| `password`         | Optional. MUST NOT be logged or displayed anywhere           | Login password if the app requires authentication                                                                                                                                                                                                                         |
| `credentials_file` | Optional                                                      | Path to a `.properties` file with keys: `test_url`, `user_name`, `password` (note: `user_name` maps to the `username` parameter)                                                                                                                                          |
| `prompts_dir`      | Optional, default `{project_root}/tests/page/`                | Directory for unit test prompt files when `output_mode=unit-prompts`. Its default reproduces today's hardcoded location exactly, so a caller that omits this parameter sees no change in where prompt files land. Unused when `output_mode` is `cypress` or `playwright`. |
| `scope_confirmed`  | Optional, default false                                       | Set true when the caller has already authorized test generation for whatever pages discovery finds. Step 3 then reports and proceeds instead of prompting. A parallel or unattended caller MUST set it.                                                                   |

**Parameter acquisition rules:**

- If all required parameters are already provided (or `credentials_file` covers `url`/`username`/`password`), proceed immediately to the Steps
- If any required parameters are missing, ask for all missing parameters in a single prompt
- When `output_mode` is `unit-prompts`, `project_mode` and `project_dir` are not needed
- When `project_mode` is `bootstrap`, `project_dir` is not needed

## Subagents Used

- `k-browser`: navigates the app, takes screenshots, discovers pages
- `k-quality-assurance`: generates test specs and unit test prompts
- `k-developer`: bootstraps projects, validates builds, and analyzes existing project files

## Steps

### Step 1: Load Credentials

Normalize credentials into a single `credentials_file` path before proceeding.

**If `credentials_file` is provided:**

- Read the file and extract: `test_url` → `url`, `user_name` → `username`, `password` → `password`
- Explicit params take precedence: only apply each file value if the corresponding parameter is not already set
- If `url` is still unset after reading `credentials_file` (file is well-formed but missing `test_url`), surface the error and stop
- If exactly one of `username` or `password` is set after merging file values and explicit params (but not both), surface an error: "Incomplete credentials: both `username` and `password` are required." Stop.

**If `credentials_file` is NOT provided and exactly one of `username` or `password` is provided (but not both):**

- Surface an error: "Both `username` and `password` are required together; only one was provided." Stop.

**If `credentials_file` is NOT provided but `username` and `password` are provided:**

Delegate this branch to `k-developer` (not run directly by the orchestrator, which does not execute shell commands or write files itself):

- Generate a unique path: `_mktemp_base="$(mktemp /tmp/test-credentials-XXXXXXXXXX)"; credentials_file="${_mktemp_base}.properties"; rm -f "$_mktemp_base"; unset _mktemp_base` (portable form: BSD/macOS `mktemp` does not support the GNU-only `--suffix` flag, so the bare file `mktemp` actually creates is captured and removed immediately after deriving the `.properties` path from it, since `$credentials_file` names a second path that `mktemp` never touched and later cleanup of `$credentials_file` would not reach the original bare file)
- Create the file with restrictive permissions using the `write` tool (do NOT use a shell heredoc: if the password contains a line that is exactly `EOF`, the heredoc terminates prematurely):
  1. Run `install -m 0600 /dev/null "$credentials_file"` to create the file with owner-only permissions
  2. Use the `write` tool to write the following content to `$credentials_file`:

     ```
     test_url={url}
     user_name={username}
     password={password}
     ```

- Set `credentials_file` to the generated unique path
- Set `agent_created_credentials_file=true`

**If neither `credentials_file` nor `username`/`password` are provided:**

- Set `credentials_file=` (empty string); the app is treated as public/unauthenticated

After this step, `credentials_file` is either a valid path or empty.

**Constraints:**

- MUST NOT log or display the password value in any output
- If the file is missing or malformed, surface the error and stop
- **On any early exit after this step:** if `agent_created_credentials_file=true`, delete the temp file and unset the flag before stopping: `rm -f "$credentials_file" && unset agent_created_credentials_file` (this step still runs in the same `k-developer` shell that set them, so the shell variables are valid here)

### Step 2: Discover the Application

Delegate to `k-browser`.

**REQUIRED SKILLS:** app-discovery, dom-inspection
**REQUIRED TOOLS:** browser automation tools

**MUST DO:**

- Apply the `app-discovery` skill fully (see `skills/app-discovery/SKILL.md`): authenticate if needed, detect UI framework, crawl up to 50 pages or 30 minutes, capture all interactive elements, run `dom-inspection` on every form
- Include `ui_framework` in the discovery report. This flag is passed to Steps 4B-iii and 4B-iv to inject framework-specific selector patterns
- If `credentials_file` is non-empty, sign out of the application before closing (navigate to the app's sign-out/log-off URL or click the sign-out control). Do this before closing the browser
- Close the browser session after the discovery report is written. Only close the session opened for this discovery task; do not affect any other browser sessions that may be running

**MUST NOT DO:**

- Log or display password values
- Navigate outside the app's domain during discovery (identity-provider redirects during the initial authentication flow are permitted)

**ON FAILURE:** If navigation fails or authentication is rejected (wrong credentials, MFA wall, CAPTCHA, unreachable app), `k-browser` surfaces the error and stops; do not proceed to Step 3. If `{agent_created_credentials_file}` is `true`, delegate cleanup to `k-developer`, which runs `rm -f "{credentials_file}"` (not `k-browser` itself). Reference the literal values, not shell variables, the same way Step 5 does.

**CONTEXT:** `url={url}`, `credentials_file={credentials_file}` (always set after Step 1; empty means public app).

### Step 3: Confirm Discovery Scope

Present a summary of the discovery report to the user:

- Number of pages/flows discovered
- List of page names and URLs
- Any failed paths

Unless `scope_confirmed=true`, ask: "Proceed with test generation for these N pages? [y/n]"

**Constraints:**

- If the caller passed `scope_confirmed=true`, MUST report the discovery summary and proceed without asking. The caller already authorized generation for whatever pages discovery found. A parallel or unattended caller MUST set it, since the prompt has no one to answer
- Otherwise MUST NOT proceed without explicit user confirmation
- If the user declines: if `{agent_created_credentials_file}` is `true`, delegate cleanup to `k-developer`, which runs `rm -f "{credentials_file}"` (reference the literal value carried forward from Step 1, not a shell variable, the same way Step 5 does); then stop and report the discovery summary

### Step 4A: Generate Unit Test Prompts

_Only if `output_mode=unit-prompts`. Skip if `output_mode` is `cypress` or `playwright`._

Delegate to `k-quality-assurance`.

**REQUIRED SKILLS:** e2e-test-strategy
**REQUIRED TOOLS:** read, write

**MUST DO:**

- Write one markdown prompt file per page to `{prompts_dir}`
- Each file must contain: Objective, Pre-requisite, Steps, Expected Outcome
- Record the absolute path of the `{prompts_dir}` directory as `prompts_dir` (the same way Step 4B-ii records `project_dir` after bootstrapping)

**ON FAILURE:** If this step fails, `k-quality-assurance` runs `rm -f "{credentials_file}"` if `{agent_created_credentials_file}` is `true`, then surfaces the error and stops. (This step runs in a separate agent from Step 1, which set `credentials_file`/`agent_created_credentials_file`; reference the literal values, not shell variables, the same way Step 5 does.)

### Step 4B: Generate Functional Tests

_Only if `output_mode=cypress` or `output_mode=playwright`. Skip if `output_mode=unit-prompts`._

#### Step 4B-i: Analyze Existing Project

_Only if `project_mode=add-to-existing`. Skip if `project_mode=bootstrap`._

Delegate to `k-developer` (not `k-researcher`: `k-developer` is the agent equipped to analyze a local project).

**REQUIRED TOOLS:** read, glob, grep

**MUST DO:**

- Analyze `{project_dir}` to understand test structure, config files, and existing patterns
- Capture the analysis as `existing_project_analysis` (naming conventions, selector patterns, file structure, config). This is passed as context to Steps 4B-iii and 4B-iv

**ON FAILURE:** `k-developer` runs `rm -f "{credentials_file}"` if `{agent_created_credentials_file}` is `true`, then surfaces the error and stops. (This step runs in a separate agent invocation from Step 1; reference the literal values, not shell variables, the same way Step 5 does.)

#### Step 4B-ii: Bootstrap Project

_Only if `project_mode=bootstrap`. Skip if `project_mode=add-to-existing`._

Delegate to `k-developer`.

**REQUIRED TOOLS:** shell, write

**MUST DO:**

- Scaffold a new Cypress or Playwright project
- For Playwright:
  - Add `@types/node` as a devDependency and ensure `tsconfig.json` includes `"lib": ["ES2020", "DOM"]`, `"strict": true`, `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"esModuleInterop": true`. Without these, TypeScript compilation fails on every Playwright project
  - Run `mkdir -p fixtures/auth` to create the auth state directory before `global-setup.ts` runs. `context.storageState()` throws `ENOENT` if the directory does not exist
  - Add `fixtures/auth/` to `.gitignore` to prevent committing session tokens
- For Cypress:
  - Create `cypress/tsconfig.json` with `{ "compilerOptions": { "types": ["cypress"] } }`. Without this, `npx tsc --noEmit` fails because TypeScript cannot resolve Cypress global types
- After scaffolding, run `npx tsc --noEmit` to confirm TypeScript compiles clean before proceeding (do not use `npm install` as the validation gate: it passes even when TypeScript is broken)
- Record the scaffold root as `project_dir`

**ON FAILURE:** `k-developer` runs `rm -f "{credentials_file}"` if `{agent_created_credentials_file}` is `true`, then surfaces the error and stops. (This step runs in a separate agent invocation from Step 1; reference the literal values, not shell variables, the same way Step 5 does.)

#### Step 4B-iii: Generate Cypress Specs

_Only if `output_mode=cypress`. Skip if `output_mode=playwright`._

Delegate to `k-quality-assurance`.

**REQUIRED SKILLS:** cypress-test-implementation
**REQUIRED TOOLS:** read, write

**MUST DO:**

- Generate spec files using `cy.visit()`, `cy.get()`, `Cypress.env()` for credentials
- Use `Cypress.env('USERNAME')` and `Cypress.env('PASSWORD')` for credentials (Cypress strips the `CYPRESS_` prefix from injected env vars)
- Use `data-testid` selectors; avoid brittle CSS selectors

**Cypress session management (required when app has authentication):**

- Add a reusable login command in `cypress/support/commands.ts`:

  ```typescript
  Cypress.Commands.add('login', () => {
    cy.session(
      'user',
      () => {
        cy.visit('/login');
        cy.get('{username-selector}:visible').type(Cypress.env('USERNAME'));
        cy.get('{password-selector}:visible').type(Cypress.env('PASSWORD'), {
          log: false,
        });
        cy.get('{submit-selector}:visible').click();
        cy.url().should('not.include', '/login');
      },
      {
        validate() {
          cy.visit('/');
          cy.url().should('not.include', '/login');
        },
      },
    );
    cy.visit('/'); // Required: cy.session() always resets browser to about:blank
  });
  ```

- Call `cy.login()` in `beforeEach()` in specs that require authentication
- **Selector substitution required:** replace `{username-selector}`, `{password-selector}`, `{submit-selector}` with the exact selectors from the Step 2 discovery report for the login page
- **Login-flow opt-out:** specs that test the login page itself must NOT call `cy.login()`. They should navigate directly to the login URL and interact with it unauthenticated
- **If `ui_framework=cloudscape` from discovery:** Cloudscape deviates from standard ARIA semantics, so use these scoped patterns:
  - Table row selection: `cy.get('[data-testid="table"]').find('input[type="radio"]').eq(n).click({ force: true })`, scoped to the table, not the whole page
  - Tiles/radio groups: `cy.contains('label', /label text/).find('input[type="radio"]').click({ force: true })`, since tiles render unlabeled radio inputs
  - Select/dropdown: two steps: `cy.get('[data-testid="select-trigger"]').click()` then `cy.get('[role="listbox"]').contains('[role="option"]', /value/).click()`, scoped to the open listbox container to avoid matching stale option lists elsewhere in the DOM
  - Modals: scope to footer: `cy.get('[role="dialog"] footer').contains('button', /cancel/i).click()`, since modals have both an X and a footer Cancel
  - Form fields: prefer `cy.get('[placeholder="..."]')` over `cy.get('label')`, since Cloudscape does not always use standard label associations
- **If `project_mode=add-to-existing`:** follow the naming conventions and patterns from `existing_project_analysis`

**ON FAILURE:** `k-quality-assurance` runs `rm -f "{credentials_file}"` if `{agent_created_credentials_file}` is `true`, then surfaces the error and stops. (This step runs in a separate agent from Step 1, which set `credentials_file`/`agent_created_credentials_file`; reference the literal values, not shell variables, the same way Step 5 does.)

#### Step 4B-iv: Generate Playwright Specs

_Only if `output_mode=playwright`. Skip if `output_mode=cypress`._

Delegate to `k-quality-assurance`.

**REQUIRED SKILLS:** e2e-test-strategy, playwright-test-implementation
**REQUIRED TOOLS:** read, write, shell

Load and follow `skills/playwright-test-implementation/SKILL.md` for the selector fallback chain, the `global-setup.ts`/`storageState` authoring pattern, Cloudscape-specific locator patterns, and the `storageState` opt-out for login-flow specs. The bullets below are specific to this SOP and are not covered by the skill:

**MUST DO:**

- Generate spec files using `page.goto()`, `page.getByTestId()`, `process.env` for credentials
- Use `process.env.TEST_USERNAME` and `process.env.TEST_PASSWORD` for credentials
- **Selector substitution:** the placeholder selectors in the skill's `global-setup.ts` pattern (`input[name="username"]`, `input[name="password"]`, `button[type="submit"]`) must be replaced with the exact selectors captured in the Step 2 discovery report for the login page (`selector_type` and `exact_text` fields)
- **If `ui_framework=cloudscape` from discovery:** apply the Cloudscape-specific locator patterns from the skill's Step 4 (table row selection, tiles/radio groups, select/dropdown, modals, form fields). The skill's "where the app uses Cloudscape" clause maps directly onto this flag, matching how Step 4B-iii gates its Cloudscape block
- **If `project_mode=add-to-existing`:** follow the naming conventions and patterns from `existing_project_analysis`; also run `mkdir -p fixtures/auth` and add `fixtures/auth/` to `.gitignore` if either is missing. `project_mode=bootstrap` handles both in Step 4B-ii, but `add-to-existing` skips that step

**ON FAILURE:** `k-quality-assurance` runs `rm -f "{credentials_file}"` if `{agent_created_credentials_file}` is `true`, then surfaces the error and stops. (This step runs in a separate agent from Step 1, which set `credentials_file`/`agent_created_credentials_file`; reference the literal values, not shell variables, the same way Step 5 does.)

### Step 5: Validate Generated Tests

Delegate to `k-developer`. Pass `{credentials_file}` and `{agent_created_credentials_file}` into this delegated step as literals. Step 5 runs in a separate agent from Step 1, which set them, so the delegate has no shell state to inherit; `k-developer` is the actor that runs the cleanup below using the literal values it was given.

**REQUIRED TOOLS:** shell

**MUST DO:**

- **If `output_mode=unit-prompts`:** skip TypeScript/framework validation. Instead, verify that `{prompts_dir}` exists and contains at least one `.md` file. Then proceed to temp credentials cleanup.
- **If `output_mode=cypress` or `output_mode=playwright`:** run the following commands inside `{project_dir}`:
  - Run `npx tsc --noEmit` (both Cypress and Playwright, since Cypress has no dry-run mode)
  - Run `npx playwright test --list` (Playwright only)
  - Run `npx cypress verify` (Cypress only)
- If `{credentials_file}` is non-empty, scan for the plaintext password before deleting it. Scan `{project_dir}` for `cypress`/`playwright` modes, or `{prompts_dir}` for `unit-prompts` mode (which has no `project_dir`):

  ```bash
  credentials_file="{credentials_file}"
  password=$(grep '^password=' "$credentials_file" | cut -d= -f2-)
  if [ "{output_mode}" = "unit-prompts" ]; then
    scan_dir="{prompts_dir}"
  else
    scan_dir="{project_dir}"
  fi
  if [ ! -d "$scan_dir" ]; then
    echo "ERROR: scan directory '$scan_dir' missing; cannot verify credential leak"
    if [ "{agent_created_credentials_file}" = "true" ]; then rm -f "$credentials_file"; fi
    exit 1
  fi
  if [ -z "$password" ]; then
    echo "WARNING: password field is empty, skipping credential-leak scan"
  elif grep -qrF --exclude-dir=node_modules --exclude-dir=.git "$password" "$scan_dir"; then
    echo "CRITICAL: plaintext password found in generated files"
    grep -rlF --exclude-dir=node_modules --exclude-dir=.git "$password" "$scan_dir"
    if [ "{agent_created_credentials_file}" = "true" ]; then rm -f "$credentials_file"; fi
    exit 1
  fi
  ```

- If `{agent_created_credentials_file}` is `true`, `k-developer` deletes the temp file: `rm -f "{credentials_file}"`

**ON FAILURE:** If any validation command fails, `k-developer` runs `rm -f "{credentials_file}"` if `{agent_created_credentials_file}` is `true`, then surfaces the error and stops.

### Step 6: Commit Generated Tests

_Only if `output_mode=cypress` or `output_mode=playwright`. Skip if `output_mode=unit-prompts`: those prompt files are reference material for a human to act on, the same as `k-light-ui-testing`'s prompt files, not source code, so the commit requirement below does not apply to them._

Delegate to `k-developer`.

**REQUIRED TOOLS:** shell (git)

**MUST DO:**

- Confirm `{project_dir}` is inside a git working tree (`git -C "{project_dir}" rev-parse --is-inside-work-tree`). If it is not, record in the summary that the generated tests were not committed because no git repository is present, and skip the rest of this step. This SOP does not initialize a repository.
- Run `git -C "{project_dir}" status --porcelain`. If it reports no changes, skip the commit, since a pass that generated no new or modified files has nothing to commit, and proceed to Step 7.
- Otherwise, stage everything under `{project_dir}` and commit on the branch currently checked out:
  - `project_mode=bootstrap`: `git add -A` inside `{project_dir}`, commit message `test: bootstrap {Cypress|Playwright} functional tests`.
  - `project_mode=add-to-existing`: `git add -A` inside `{project_dir}`, commit message `test: add {Cypress|Playwright} functional tests`.
- Push the current branch (`git push`, or `git push -u origin <branch>` if it has no upstream yet). If the push fails, for example no remote configured or no network, the commit still exists locally, which already satisfies the requirement that generated tests are not left untracked; record the push failure in the summary as IMPORTANT rather than stopping the SOP.
- When this SOP is reached through `k-full-sdlc`'s Step 9, that SOP's Step 8 already opened a pull request for this feature before Step 9 runs. The push above is what updates it; no separate pull-request action is needed here, matching how `k-full-sdlc`'s own CRITICAL-gap fix loop (Step 9(b)) already treats "push a fix commit" as "update the affected pull request." This SOP does not open or update pull requests directly in any other case either. A standalone invocation with no pull request yet just leaves the branch pushed and ready for one.

**ON FAILURE:** If the commit itself fails (not the push, see above), `k-developer` surfaces the error and stops before Step 7.

### Step 7: Output Summary Report

Print a summary to the user:

| Page URL | Test File          | Status      |
| -------- | ------------------ | ----------- |
| `{url}`  | `{test file path}` | Pass / Fail |

- List any pages that failed to generate tests
- Next steps: how to run the tests locally

## Quality Gate

**CRITICAL (block proceeding):**

- Password value appears in any delegation prompt or log output
- Hard-coded credentials in any generated test file
- Tests generated without user confirmation in Step 3, unless the caller set `scope_confirmed=true`
- Temp credentials file (`agent_created_credentials_file=true`) not deleted before the SOP exits for any reason. Run `rm -f "$credentials_file" && unset agent_created_credentials_file` (Step 1, which has the shell state) or the equivalent `rm -f "{credentials_file}"` against the literal value (Steps 2, 3, 4A, 4B-i through 4B-iv, and Step 5, which run in separate delegated agents) on every exit path

**IMPORTANT (note but do not block):**

- `project_dir` not captured after Step 4B-ii bootstrap

## Related Skills

- `e2e-test-strategy`: prioritized E2E test matrix (P0-P3)
- `cypress-test-implementation`: detailed Cypress implementation planning and tracking
- `playwright-test-implementation`: Playwright selector strategy, `global-setup.ts`/`storageState` authoring, and Cloudscape-specific locator patterns

## Examples

### Example 1: Unit test prompts from a credentials file

```
output_mode: unit-prompts
credentials_file: url_bootstrap.properties
```

`url_bootstrap.properties` contains `test_url`, `user_name`, `password` keys. The `url` parameter is not required because `credentials_file` supplies it via `test_url`.

### Example 2: Bootstrap a new Playwright project

```
output_mode: playwright
project_mode: bootstrap
url: https://example.com
username: testuser
password: <redacted>
```

Expected output: New Playwright project scaffolded, spec files written, `npx playwright test --list` shows all tests.

### Example 3: Add Cypress tests to an existing project

```
output_mode: cypress
project_mode: add-to-existing
project_dir: ./my-e2e-project
url: https://example.com
```

Expected output: New spec files added following existing project conventions, TypeScript compiles clean.
