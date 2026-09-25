---
name: app-discovery
version: 1.0.0
description: Use when you need a map of a deployed web application's pages, forms, and interactive elements, for example before writing UI or end-to-end tests for it. Crawls the app into a structured discovery report, using dom-inspection for form validation rules.
tags: [discovery, browser, dom, testing, playwright, app-inspection]
---

# App Discovery

## Overview

Navigates a deployed web application using browser automation and produces a structured discovery report capturing every page, interactive element, and form validation rule. The report is the shared input artifact for both light UI testing and full functional test generation.

**This skill defines what to discover and how to structure the output.** The SOP that loads this skill handles credentials, user confirmation, and cleanup.

## Usage

Use this skill when:

- Discovering a deployed web app before generating test prompts or functional specs
- Building a discovery report that captures DOM structure, validation rules, and UI framework

Load this skill into `k-browser`. It depends on `dom-inspection` — ensure that skill is also available.

## Discovery Protocol

### Phase 1: Authentication

If `credentials_file` is empty or absent, skip this phase (the app requires no authentication).

If `credentials_file` is non-empty, read it first to obtain credentials before navigating, then perform login using the selectors from the login page. Choose the flow that matches the app's sign-in behavior:

#### Flow A: Redirect-based sign-in (e.g. Cognito Hosted UI, OAuth/SSO, SAML IdP)

After login:

- Call `waitForURL('**', { waitUntil: 'networkidle' })` to ensure OAuth/SSO redirect completes
- Reuse the session for all subsequent pages — do NOT re-authenticate on every page

#### Flow B: Generic in-page sign-in (SPA/AJAX login with no redirect)

If the login does NOT trigger a navigation/redirect (single-page apps that authenticate in place), do NOT use `waitForURL` — it will hang waiting for a redirect that never happens. Instead, wait for a positive post-login signal, in preference order:

1. A known authenticated-page selector becoming visible (nav bar, avatar, dashboard heading): `page.waitForSelector(<post-auth-selector>, { timeout: 10000 })`
2. A URL change away from the login URL: `page.waitForURL(url => url !== loginUrl, { timeout: 10000 })`
3. Fallback only if neither signal is available: `page.waitForTimeout(3000)` — and note the fallback was used in the discovery report.

As with Flow A, reuse the session for all subsequent pages — do NOT re-authenticate on every page.

### Phase 2: UI Framework Detection

After loading the first authenticated page (past any login/SSO page):

- Inspect the DOM for `awsui-` prefixed elements → set `ui_framework=cloudscape`
- Inspect for `MuiButton`, `MuiTextField` → set `ui_framework=material-ui`
- Otherwise → set `ui_framework=plain-html`

Include `ui_framework` in the discovery report. This flag is used by spec generation to inject framework-specific selector patterns.

### Phase 3: Page Crawl

Navigate depth-first from `{url}`:

- Track all visited URLs — do NOT visit the same URL twice
- Take a screenshot after loading each page
- Stop after 50 pages or 30 minutes, whichever comes first — if the limit is reached, note the cutoff in the report
- Do NOT navigate outside the app's domain (identity-provider redirects during authentication are permitted)

### Phase 4: Per-Element Capture

For every interactive element on each page, capture:

| Field                 | Description                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------- |
| `selector_type`       | Most reliable selector: `data-testid` → `aria-label` → role → placeholder → CSS fallback |
| `exact_text`          | Exact visible label or button text as rendered — not inferred                            |
| `initial_state`       | `enabled`, `disabled`, `hidden`, or `checked` at page load                               |
| `interaction_pattern` | `click`, `two-step` (open → select), `type`, `checkbox`, `radio`, `form-submit`          |
| `duplicate_dom`       | Flag if multiple elements match the same selector                                        |

### Phase 5: Form DOM Inspection

For every form on each page, apply the `dom-inspection` skill:

- Extract HTML5 validation attributes (`required`, `pattern`, `min`, `max`, `minlength`, `maxlength`)
- Determine `validation_trigger` (submit, blur, or change)
- Capture error message selectors and exact error text
- Identify conditional field visibility and cross-field business rules

See `skills/dom-inspection/SKILL.md` for the full inspection protocol and output schema.

### Phase 6: Cleanup

After the discovery report has been fully written:

- Close the browser session
- This ensures no Chromium process remains running after discovery completes, preventing session conflicts when a subsequent agent (e.g. Step 6 test execution) launches its own browser

## Output: Discovery Report

Produce a discovery report with this structure:

```
## Discovery Report

**URL:** {url}
**Pages discovered:** N
**UI framework:** cloudscape | material-ui | plain-html
**Limit reached:** yes/no

### Pages

#### {page-name} — {url}
**Screenshot:** {path}

**Interactive elements:**
| Selector | Label | Type | Initial State | Interaction Pattern | Duplicate DOM |
|---|---|---|---|---|---|
| ... | ... | ... | ... | ... | ... |

**Forms:**
{dom-inspection output per form — see dom-inspection skill for schema}

**Failed paths:** {list of URLs or actions that failed, with reason}
```

## Constraints

- MUST NOT log or display password values
- MUST NOT navigate outside the app's domain during crawl
- Identity-provider redirects during the initial authentication flow are permitted
- If navigation fails or authentication is rejected, surface the error and stop — do not produce a partial report without noting the failure

## Quality Gate

**CRITICAL:**

- `ui_framework` not detected and set
- Forms present on page but `dom-inspection` not run
- Password value appears anywhere in the report

**IMPORTANT:**

- `duplicate_dom` not flagged for elements with ambiguous selectors
- Crawl limit reached without noting cutoff in report
