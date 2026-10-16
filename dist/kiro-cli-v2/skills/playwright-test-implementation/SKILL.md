---
name: playwright-test-implementation
description: Authors Playwright functional test specs — selector strategy, authenticated-session setup via global-setup.ts and storageState, and Cloudscape-specific locator patterns. Use when writing or reviewing Playwright specs against a discovered web app, wiring up global-setup.ts, or fixing flaky selectors on a Cloudscape UI.
version: 1.0.0
tags: [skill, playwright, e2e-testing, implementation, quality-assurance]
---

# Playwright Test Implementation

## Overview

Covers the parts of writing a Playwright spec that are easy to get wrong: which locator to reach for first, how to sign in once and reuse that session across every spec, and how to handle Cloudscape's non-standard ARIA patterns. This is authoring guidance, not a project scaffolder — it assumes a Playwright project already exists (see Prerequisites) and a set of pages/selectors already discovered from the target app.

## Usage

Use this skill when:

- Writing Playwright spec files against a discovered web app
- Setting up `global-setup.ts` and `storageState` for authenticated flows
- Choosing selectors for a page, or debugging a flaky/ambiguous one
- Writing specs against a Cloudscape UI, where standard ARIA-based locators often don't apply
- Reviewing an existing Playwright spec for selector fragility or missing session handling

Do NOT use for: scaffolding a new Playwright project from scratch, planning which tests to write (see `e2e-test-strategy`), or Cypress specs (see `cypress-test-implementation`).

## Prerequisites

### Playwright is a prerequisite, not something this skill installs

This skill assumes Playwright is already part of the project. It does not install Playwright, run installers, or shell out to set it up automatically — installation is the customer's own step, done once per project.

**Check first, before assuming it's missing:**

```bash
npx --no-install playwright --version
```

If that resolves, Playwright is already installed in this project — move on to authoring. `--no-install` is required: a bare `npx playwright --version` silently fetches `@playwright/test` from the registry when it's absent (in a non-interactive shell it installs without prompting), so the check passes against a project that can't actually run a spec — and the auto-fetch is itself the exact behavior the CRITICAL gate at the bottom of this file forbids the skill from triggering. Also check `package.json` for `@playwright/test` under `dependencies` or `devDependencies` as a second signal.

**If it's missing, tell the customer how to add it — do not install it on their behalf:**

```bash
npm install -D @playwright/test
npx playwright install          # downloads the browser binaries Playwright drives
```

`npx playwright install` is a separate step from the npm install — it fetches the actual browser binaries (Chromium, Firefox, WebKit), and specs will fail at launch time without it even if `@playwright/test` is present in `node_modules`.

If a project needs only one browser, `npx playwright install chromium` is enough and considerably faster in CI.

## Steps

### Step 1: Confirm the project can run a spec at all

_Applies when adding specs to an existing Playwright project. Skip on a fresh/bootstrap project where no specs exist yet — `playwright test --list` exits non-zero with "no tests found" in that state, which is expected, not a setup problem._

Before writing any spec content, run `npx playwright test --list` in the project root. An error here means something in the project setup — not the spec you're about to write — needs fixing first (see Prerequisites, or `tsconfig.json` if it's a compilation error). The `--list` check that actually matters on a fresh project is the one run _after_ specs are written (Verification section, and the SOP's Step 5) — that's the point at which a failure means something real.

### Step 2: Set up the authenticated session (`global-setup.ts` + `storageState`)

For any app that requires sign-in, sign in once in a global setup script and reuse that session across every spec — don't re-authenticate per test.

```typescript
import { chromium } from '@playwright/test';

export default async function globalSetup() {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(process.env.PLAYWRIGHT_BASE_URL!);
  await page
    .locator('input[name="username"]:visible')
    .fill(process.env.TEST_USERNAME!);
  await page
    .locator('input[name="password"]:visible')
    .fill(process.env.TEST_PASSWORD!);
  await page.locator('button[type="submit"]:visible').click();
  await page.waitForURL(/\/dashboard/);
  await context.storageState({ path: 'fixtures/auth/state.json' });
  await browser.close();
}
```

The three selectors above are placeholders. Replace them with the actual selectors for the login page — don't ship the generic version. The `waitForURL(/\/dashboard/)` line is a placeholder too: it must point at the app's real post-login destination, not this literal pattern.

Then wire it into `playwright.config.ts`:

```typescript
export default defineConfig({
  globalSetup: './global-setup',
  use: {
    storageState: 'fixtures/auth/state.json',
    baseURL: process.env.PLAYWRIGHT_BASE_URL,
  },
});
```

Playwright does not auto-read `PLAYWRIGHT_BASE_URL` — the `baseURL` line above has to be there explicitly, or every `page.goto()` call needs a full URL.

Before any of this runs, create the directory `storageState` writes into:

```bash
mkdir -p fixtures/auth
```

`context.storageState()` throws `ENOENT` if `fixtures/auth/` doesn't exist yet — Playwright will not create it for you. Add `fixtures/auth/` to `.gitignore` too; it holds live session tokens and must never be committed.

**Two details that are easy to get wrong here:**

- **Wait for the redirect to actually finish before saving state.** Wait on a concrete post-login signal before `context.storageState()` — either a URL pattern that only matches the real post-login destination (`page.waitForURL(/\/dashboard/)`) or a visible element that only exists once authenticated (`await expect(page.getByTestId('user-menu')).toBeVisible()`). Matching the exact base URL as the wait pattern fails whenever sign-in redirects to a different path (OAuth, SSO), but the two fixes below are both worse than they look: `'**'` matches essentially any URL, including the pre-redirect one, so the wait can resolve before the auth redirect has settled and save an unauthenticated state; and Playwright's own docs discourage `waitUntil: 'networkidle'` for waiting on navigation because it is flaky. Use a signal specific to the target app instead — replace the placeholder above with the app's real post-login URL or element.
- **Hosted SSO pages often render a hidden duplicate form.** If the login page is a hosted UI (Cognito, Okta, etc.), scope selectors with `:visible` — `page.locator('input[name="username"]:visible')` — or Playwright can time out matching two elements with the same selector, one of them hidden.

Read credentials from `process.env.TEST_USERNAME` / `process.env.TEST_PASSWORD` in both the setup script and specs — never hardcode them.

### Step 3: Pick selectors using this fallback chain, in order

Stop at the first one that applies:

1. `page.getByTestId('...')` — preferred; needs a `data-testid` attribute on the element
2. `page.getByRole('...', { name: /.../ })`, scoped to a container — always scope it, or a role query can match the same role/name pair on a different part of the page: `page.locator('[data-testid="table"]').getByRole('button', { name: /delete/i })`
3. `page.getByLabel('...')` — for form inputs with an associated label
4. `page.getByPlaceholder('...')` — for inputs that have no label
5. `page.locator('[aria-label="..."]')` — for elements with an `aria-label` but no visible text

If none of these resolve cleanly and you reach for `.first()`, add a comment explaining why the selector is ambiguous and why the first match is the right one — an unexplained `.first()` is a sign the selector needs to be scoped tighter, not accepted as-is.

### Step 4: Apply Cloudscape-specific patterns where the app uses Cloudscape

Cloudscape components deviate from standard ARIA semantics in ways that break the fallback chain above. Use these instead:

- **Table row selection:** `row.locator('input[type="radio"]').click({ force: true })` — not `row.click()`. Cloudscape table rows use radio inputs that need `force: true` to click through the overlay.
- **Tiles / radio groups:** `page.locator('label').filter({ hasText: /label text/ }).locator('input[type="radio"]').click({ force: true })`. Tiles render unlabeled radio inputs, so `getByRole('radio', { name })` never matches; `input[type="radio"]` is a void element with no text content, so `.filter({ hasText })` has to be applied to the wrapping `label`, not the input itself.
- **Select / dropdown:** two steps — open with `getByRole('button', { name: /select .*/i })`, then pick with `page.getByRole('listbox').getByRole('option', { name: /value/i })`. Scope the option pick to the open listbox container, or it can match a stale option list left over from another dropdown elsewhere on the page.
- **Modals with more than one close control:** scope to the footer — `page.locator('[role="dialog"]').locator('footer, [class*="footer"]').getByRole('button', { name: /cancel/i })`. Modals typically have both an X button and a footer Cancel button; an unscoped query can match either.
- **Form fields:** prefer `getByPlaceholder()` over `getByLabel()`. Cloudscape form fields don't always wire up standard label associations.

### Step 5: Opt out of the global session for login-flow specs

A spec that tests the login page itself, or authentication behavior in general, has to opt out of the global `storageState` — otherwise Playwright starts the test already signed in and skips the page under test entirely.

```typescript
test.use({ storageState: { cookies: [], origins: [] } });
```

Place this at the top of the spec file. `test.use({ storageState: undefined })` does not work here — `undefined` falls through to the project-level config instead of clearing it, so the explicit empty object is required.

An alternative to opting out per-spec: define a separate Playwright project in `playwright.config.ts` with no `storageState`, and put all auth-flow specs there.

## Pitfalls

- **`ENOENT` from `context.storageState()`** — `fixtures/auth/` doesn't exist. Run `mkdir -p fixtures/auth` before global setup runs.
- **`baseURL` silently not applied** — `PLAYWRIGHT_BASE_URL` isn't picked up automatically; `use: { baseURL: process.env.PLAYWRIGHT_BASE_URL }` has to be written explicitly in `playwright.config.ts`.
- **Global setup saves state before the redirect finishes** — waiting on the literal base URL breaks the moment sign-in redirects anywhere else (OAuth, SSO), but `'**'` alone is not the fix — it matches the pre-redirect URL too, with or without `waitUntil: 'networkidle'` — and `networkidle` is separately discouraged by Playwright's own docs for waiting on navigation. Wait on a concrete post-login URL pattern or a visible authenticated-page element instead.
- **Login-flow specs never reach the login page** — the global `storageState` signs the test in before it starts. Opt out with an explicit empty `storageState` object, not `undefined`.
- **Ambiguous-selector timeouts on hosted SSO pages** — a hidden duplicate form matches the same selector as the visible one. Scope with `:visible`.
- **`getByRole('radio', { name })` never matches Cloudscape tiles** — the radio input itself carries no text; filter the wrapping `label` by text instead.
- **Credentials leaking into a generated spec** — `process.env.TEST_USERNAME` / `TEST_PASSWORD` belong in the environment, never hardcoded in a spec or committed alongside `fixtures/auth/state.json`.

## Verification

- `npx playwright test --list` runs clean and lists every spec — a compile or config error here means the setup is broken, not the individual specs.
- `npx tsc --noEmit` passes.
- For any spec touching authentication: delete `fixtures/auth/state.json`, run the suite once to confirm global setup regenerates it, then run again to confirm the second run reuses the saved session instead of re-authenticating.
- For any login-flow spec: confirm it actually renders the login page (not a post-login page) by asserting on a login-page element before interacting with it.
- Grep the generated spec files and `fixtures/` for the literal test password before committing anything — it should never appear outside the environment.

## Quality Gate

**CRITICAL (must fix):**

- Hardcoded credentials in any spec file or in `global-setup.ts`
- `fixtures/auth/` (or wherever `storageState` writes to) not in `.gitignore`
- A login-flow spec does not opt out of the global `storageState`
- Playwright installation attempted or scripted by this skill's own procedure instead of directed to the customer

**IMPORTANT (should fix):**

- A selector could have used `getByTestId()` or `getByRole()` but falls back to a raw CSS locator instead
- `.first()` used without an inline justification comment
- `waitForURL()` matches the literal base URL or uses the wildcard `'**'` (with or without `waitUntil: 'networkidle'`), instead of a concrete post-login signal in a global setup that goes through a redirect
- Cloudscape UI targeted with standard ARIA locators instead of the scoped patterns above

**SUGGESTION:**

- Could split auth-flow specs into their own Playwright `project` instead of opting out of `storageState` per file
- Could add a comment linking a Cloudscape-specific locator back to the exact deviation it's working around

Present findings as: CRITICAL → IMPORTANT → SUGGESTION. Ask: "Fix these issues? [y/n]"
