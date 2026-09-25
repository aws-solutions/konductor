# Light UI Testing

## Overview

Discovers a deployed web page using browser automation and DOM inspection, writes structured markdown test prompts for the features described by the user, then executes those prompts live using the browser and reports pass/fail per prompt.

Use this SOP during development when pages are not yet ready for full functional test generation. It provides immediate feedback on what's working without requiring a test framework or scaffold.

**Do NOT use for:** full Cypress/Playwright spec generation, CI pipeline wiring, or apps requiring non-browser authentication (e.g. mTLS).

> **Browser note:** The browser agent uses Playwright's bundled **Chromium** (not system Chrome). This avoids the "Browser is already in use" error when Chrome is open on Mac. If the target page requires authentication, provide `username`/`password` or a `credentials_file`. See Parameters below.

## Parameters

| Parameter          | Required                                                      | Description                                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`              | Required unless `credentials_file` supplies it via `test_url` | URL of the page to test                                                                                                                                                                                               |
| `features`         | Required                                                      | Description of the features/flows to test (free text)                                                                                                                                                                 |
| `username`         | Optional                                                      | Login username if the app requires authentication                                                                                                                                                                     |
| `password`         | Optional, MUST NOT be logged or displayed anywhere           | Login password                                                                                                                                                                                                        |
| `credentials_file` | Optional                                                      | Path to a `.properties` file with keys: `test_url`, `user_name`, `password` (note: `user_name` maps to `username`)                                                                                                    |
| `output_dir`       | Optional, default `tests/page/`                               | Directory to write prompt files (relative to current working directory)                                                                                                                                               |
| `scope_confirmed`  | Optional, default false                                       | Set true when the caller has already authorized generating and running prompts for whatever discovery finds. Steps 3 and 5 then report and proceed instead of prompting. A parallel or unattended caller MUST set it. |

**Parameter acquisition rules:**

- If all required parameters are provided (or `credentials_file` covers `url`), proceed immediately
- If any required parameters are missing, ask for all missing parameters in a single prompt

## Subagents Used

- `k-browser`, discovers the page, runs DOM inspection, executes test prompts
- `k-quality-assurance`, writes structured test prompt files from discovery report

## Steps

> **Dispatch model:** `k-light-ui-testing` may be registered on more than one orchestrator's `agentSopNames`. Verify via each orchestrator's own agent spec rather than assuming `konductor` is the only one. Today `konductor`, `konductor-mux-orchestrator`, and `konductor-cmux-orchestrator` all register it, and all three carry the Steps 1/3/5/7 shared-shell-state carve-out this SOP depends on. Whichever orchestrator is driving this SOP dispatches Step 2 and Step 6 to its own browser-persona subagent (`k-browser` in `konductor`'s case), and Step 4 to its own test-writing subagent (`k-quality-assurance` in `konductor`'s case), as three independent peer delegations. The test-writing subagent runs Step 4's work inline once dispatched, with no further delegation hop.

### Step 1: Load Credentials

Normalize credentials into a single `credentials_file` path.

**If `credentials_file` is provided:**

- Read the file and extract: `test_url` → `url`, `user_name` → `username`, `password` → `password`
- Explicit params take precedence: only apply each file value if the corresponding parameter is not already set
- If `url` is still unset after reading, surface the error and stop
- If exactly one of `username`/`password` is set after merging (but not both), surface an error and stop

**If `credentials_file` is NOT provided but `username` and `password` are provided:**

- Generate a unique path: `credentials_file=$(mktemp /tmp/test-credentials-XXXXXXXXXX)`
- Run `install -m 0600 /dev/null "$credentials_file"` then use the `write` tool to write:

  ```
  test_url={url}
  user_name={username}
  password={password}
  ```

- Set `agent_created_credentials_file=true`

**If `credentials_file` is NOT provided and exactly one of `username`/`password` is provided (but not both):**

- Surface an error: "Both `username` and `password` are required together; only one was provided." Stop.

**If neither provided:** set `credentials_file=` (empty string, public app).

**Constraints:**

- MUST NOT log or display the password value
- **On any early exit after this step:** if `agent_created_credentials_file=true`, run `rm -f "$credentials_file" && unset agent_created_credentials_file`

### Step 2: Discover the Page

Delegate to `k-browser`.

**REQUIRED SKILLS:** app-discovery, dom-inspection
**REQUIRED TOOLS:** browser automation tools

**MUST DO:**

- Apply the `app-discovery` skill with the following overrides: authenticate if needed, detect UI framework, capture all interactive elements, run `dom-inspection` on every form
- Focus discovery on `{url}` and any pages directly reachable from it (depth ≤ 2). This is a targeted page test, not a full app crawl
- Stop after 10 pages or 15 minutes, whichever comes first (overrides app-discovery defaults of 50 pages / 30 minutes)
- If `credentials_file` is non-empty, sign out of the application before closing (navigate to the app's sign-out/log-off URL or click the sign-out control). Do this before closing the browser
- Close the browser session after the discovery report is written. Only close the session opened for this discovery task, do not affect any other browser sessions that may be running

**MUST NOT DO:**

- Log or display password values
- Navigate outside the app's domain

**ON FAILURE:** `k-browser` runs `rm -f "{credentials_file}"` if `{agent_created_credentials_file}` is `true`, then surfaces the error and stops. (This step runs in a separate agent from Step 1, which set `credentials_file`/`agent_created_credentials_file`. Reference the literal values, not shell variables.)

**CONTEXT:** `url={url}`, `credentials_file={credentials_file}`, `agent_created_credentials_file={agent_created_credentials_file}`, `features={features}`.

### Step 3: Confirm Discovery Scope

Present a summary to the user:

- Pages discovered and UI framework detected
- Interactive elements and forms found
- Validation rules extracted (required fields, patterns, error messages)
- Any failed paths

Unless `scope_confirmed=true`, ask: "Proceed with test prompt generation for these features? [y/n]"

**Constraints:**

- If the caller passed `scope_confirmed=true`, MUST report the discovery summary and proceed without asking. The caller already authorized generation for whatever features discovery found. A parallel or unattended caller MUST set it, since the prompt has no one to answer
- Otherwise MUST NOT proceed without explicit user confirmation
- If the user declines, run `rm -f "$credentials_file" && unset agent_created_credentials_file` if `agent_created_credentials_file=true`, then stop

### Step 4: Write Test Prompts

Delegate to `k-quality-assurance`. Pass `{credentials_file}` and `{agent_created_credentials_file}` into this delegated step as literals. Step 4 runs in a separate agent from Step 1, which set them, so the delegate has no shell state to inherit.

**REQUIRED TOOLS:** read, write

**MUST DO:**

- Write one markdown prompt file per feature/flow described in `{features}` to `{output_dir}`
- Each file must contain:
  - **Objective.** What feature is being tested
  - **Pre-requisites.** Authentication state, data setup
  - **Steps.** Exact interactions using selectors from the discovery report
  - **Expected Outcome.** Specific assertions including validation error messages captured by `dom-inspection`
  - **DOM Context.** Relevant selectors, validation rules, and error message text from the discovery report
- Use the `dom-inspection` output to make assertions precise: test exact error messages, exact field constraints, exact conditional visibility triggers
- Name files descriptively: `{feature-slug}.test-prompt.md`

**ON FAILURE:** `k-quality-assurance` runs `rm -f "{credentials_file}"` if `{agent_created_credentials_file}` is `true`, then surfaces the error and stops. (Reference the literal values, not shell variables. This step runs in a separate agent from Step 1.)

### Step 5: Review Prompts

Present the list of written prompt files to the user.

Unless `scope_confirmed=true`, ask: "Review the prompts above. Run them now? [y/n/select]"

- `y`, run all prompts
- `n`, if `agent_created_credentials_file=true`, run `rm -f "$credentials_file" && unset agent_created_credentials_file`; stop, leave prompts for manual review
- `select`, ask which prompts to run

**Constraints:**

- If the caller passed `scope_confirmed=true`, MUST report the prompt list and run all of them without asking. The same authorization covers generating and running. Otherwise MUST NOT proceed to execution without explicit user confirmation

### Step 6: Execute Test Prompts

Delegate to `k-browser`. Pass `{credentials_file}` and `{agent_created_credentials_file}` into this delegated step as literals. Step 6 runs in a separate agent from Step 1, which set them, so the delegate has no shell state to inherit.

**REQUIRED TOOLS:** browser automation tools

**MUST DO:**

- For each selected prompt file, read it and execute the Steps section using Playwright browser tools
- After each step, take a screenshot to document state. Whether the screenshot is persisted to a referenceable path or must be described in text depends on which MCP server the dispatched browser agent is actually using. Check both before assuming either:
  - **`playwright-mcp`** (the public `@playwright/mcp` package, used by `k-browser`) IS configured with `--output-dir` (see that agent's `mcpRegistry` entry). `browser_take_screenshot` persists to that directory (default filename `page-{timestamp}.{png|jpeg|webp}` when no `filename` argument is given, per that tool's own documentation). Record the actual saved path, as reported back by the tool call, or `{configured-output-dir}/{filename-used}` if the tool call did not echo one, as Evidence, not a text description.
  - **An internal proxy MCP server some packages route through instead** has no equivalent, and this is verified, not assumed: it is a shared, remote, multi-tenant server that opens one CDP connection per session via a hardcoded, empty connection config with no output-directory option and no per-agent way to set one. There is no CLI-args entry point analogous to `playwright-mcp`'s spawn-time flags at all, since that proxy is a long-running deployed service, not a process this SOP spawns. For this path, `browser_take_screenshot` still returns the image inline with no persisted, referenceable path. Do not invent one. Record the screenshot's on-screen content as a short text description (what was visible, e.g. "success banner: 'Item saved'") instead of a path, exactly as before.
- Evaluate the Expected Outcome. Assert the described behavior using DOM queries and screenshot comparison
- Record pass/fail per prompt with evidence, a real screenshot path when the dispatched agent is using `playwright-mcp` (per the first bullet above), or a short text description of the screenshot's content plus actual vs expected when it is using the internal proxy MCP server (per the second bullet above)
- If `credentials_file` is non-empty, authenticate before executing prompts (reuse session across all prompts)
- If `credentials_file` is non-empty, sign out of the application before closing (navigate to the app's sign-out/log-off URL or click the sign-out control)
- Close the browser session after all prompts have been executed and results recorded. Do this before returning results to the orchestrator

**MUST NOT DO:**

- Log or display password values
- Modify any application data beyond what the test requires

**ON FAILURE of a prompt:** record as FAIL with the failure reason and the Evidence captured per Step 6 above (a screenshot path or a text description, depending on the MCP server in use), continue to the next prompt. Do not abort the entire run.

**ON FAILURE of the browser session:** `k-browser` runs `rm -f "{credentials_file}"` if `{agent_created_credentials_file}` is `true`, then surfaces the error and stops. (Reference the literal values, not shell variables. This step runs in a separate agent from Step 1.)

### Step 7: Report Results

Print a summary:

| Prompt File  | Feature     | Result            | Evidence                           |
| ------------ | ----------- | ----------------- | ---------------------------------- |
| `{filename}` | `{feature}` | ✅ Pass / ❌ Fail | `{screenshot path or description}` |

- Evidence is, per Step 6: a real screenshot path under the configured `--output-dir` when the dispatched agent used `playwright-mcp`, or a short text description of each screenshot's on-screen content when it used the internal proxy MCP server. That server has no persisted, referenceable output location (verified against its actual implementation; see Step 6)
- For each FAIL: include the step that failed, the expected outcome, and the actual outcome
- If `agent_created_credentials_file=true`, delete the temp file: `rm -f "$credentials_file" && unset agent_created_credentials_file`
- Next steps: fix failing features and re-run, or escalate to full Cypress/Playwright spec generation once the page is stable

## Quality Gate

**CRITICAL (block proceeding):**

- Password value appears in any delegation prompt, log output, or prompt file
- Temp credentials file not deleted after Step 7 (plaintext password persists on disk). Run `rm -f "$credentials_file" && unset agent_created_credentials_file` (Step 1, 3, 5, 7, which share Step 1's shell state) or the equivalent `rm -f "{credentials_file}"` against the literal value (Steps 2, 4, 6, which run in separate delegated agents) on every exit path
- Test prompts executed without user confirmation in Step 5, unless the caller set `scope_confirmed=true`
- `dom-inspection` not run on forms (assertions will be inaccurate)

**IMPORTANT (note but do not block):**

- Prompt files written without DOM context section (assertions will be generic)

## Related Skills

- `app-discovery`, page crawl and element capture
- `dom-inspection`, form validation rule extraction
- `e2e-test-strategy`, for escalating to full functional test generation

## Related SOPs

- `k-e2e-test-generation`, full Cypress/Playwright spec generation from the same discovery workflow
