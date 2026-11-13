# Harness contract

A harness runs one agent CLI for one benchmark run. `runner/lib/harness/index.js` maps a runtime name to a harness module (`harnessFor(armOrResult)`). Today there are three: `kiro.js` (`kiro-cli`), `opencode.js` (`opencode`) and `claude-code.js` (`claude-code`).

This file lists what the runner calls. It is derived from the call sites in `run-one.js`, `orchestrate.js`, `run-cmd.js`, `arm-opts.js`, `skills.js` and `trace.js`, and it is checked against the three modules by reading them. `runner/test/harness-contract.test.js` reads the member tables below and checks every entry of `HARNESSES` against them, then runs `parseResult` on a recorded stream and checks `acc`. A missing member fails that test instead of raising a `TypeError` in the middle of a run.

"Required" means the runner calls it without a guard. "Optional" means the call site is guarded by `if (harness.x)`.

## Terms

- `arm`: one condition under test. Fields used by harnesses: `id`, `vanilla`, `agent`, `agentOverride`, `armConfig`, `prefixText`, `runtime`, `commitSha`, `contentHash`, `cacheKey`.
- `ctx`: the run context built in `run-cmd.js`. Harness-relevant members: `config`, `cacheDir`, `repo`, `kiroBin`, `opencode`, `claude`, `rgBin`, `awsCredsFile`, `awsProfile`, `authDb`, `envKeep`, `skillInfo`.
- `config`: `{ model, canonicalModel?, effort, agentEngine? }`, the same object as `ctx.config`.
- `prepared`: what `prepareArm` returned for the arm, after `orchestrate.prepareAll` added `entryAgent` and `rewrittenAgents`.
- `home`: the per-run scratch HOME. `tmpdir`: `<run>/tmp`. `outDir`: the run's output directory (holds `stream.jsonl`, `stderr.txt`, `command.txt`, `result.json`).

## Required members

| Member | Arguments | Returns | Called from |
| --- | --- | --- | --- |
| `id` | none | string, one of `RUNTIMES` in `runtime.js` | `run-cmd.js` (arm runtimes, the one-harness-per-run check), `run-one.js` (`runTurns` passes it to the stop watcher) |
| `prepareArm(arm, ctx)` | the arm and run context | `prepared` object. Must be cached by arm id and content so a repeat call is cheap. Today: `{ exportDir, bin, mcpSha256, cached, ... }` | `orchestrate.prepareAll` (skipped for vanilla arms) |
| `trialInstall(prepared, ctx)` | the prepared arm | array of agent names whose model was pinned (stored as `prepared.rewrittenAgents`). Should set `prepared.skillInfo` for skill accounting. Must throw if the arm cannot install or load | `orchestrate.prepareAll`, before any credit is spent |
| `installInto(home, { arm, prepared, ctx, config, outDir })` | scratch HOME and the run | `meta` object merged into the run's meta (`rewrittenAgents`, `modelNormalized`, and runtime extras such as `installedAgents`). Writes `install.log` into `outDir` when it has something to log | `run-one.executeRun` |
| `buildCommand({ arm, task, config, ctx, cwd, resume })` | `resume` is `null` or `{ sessionId, prompt }` for the next turn of an autonomy task | `{ file, args, display }`. `file` is an executable path, `display` is the line written to `command.txt` | `run-one.runTurns` |
| `env({ arm, config, ctx, home, tmpdir })` | as listed | plain object, the complete environment of the agent process (an allowlist, not a copy of `process.env`) | `run-one.executeRun` |
| `removeCredentials(home)` | scratch HOME | nothing. Deletes any credential copy. Must not throw if there is none | `run-one.executeRun` (after the agent exits, and again in cleanup) |
| `keepPaths(ctx)` | run context | array of absolute paths that must stay visible inside the isolation namespace (the agent binary and its helpers) | `run-one.makeIso` |
| `turnSummary(streamText)` | the stdout of one turn | `{ sessionId, runFinishedStatus, stopReason, finalText, askedUser }`. `runFinishedStatus === 'success'` is what lets an autonomy conversation continue | `run-one.runTurns` (autonomy tasks only, but always called then) |
| `parseResult(outDir, { home, tmpdir, acc, arm, ctx, config })` | the run directory and the accumulator | nothing used (kiro returns `acc`, the others return nothing). Fills `acc`, see below | `run-one.postProcess`, only when `outDir/stream.jsonl` exists |
| `collectArtifacts(home, outDir, { arm })` | scratch HOME and run directory | nothing. Copies files worth keeping (installed agent definition, settings) before HOME is deleted. A throw becomes the flag `artifactCopyFailed` | `run-one.postProcess` |

## Optional members

| Member | Arguments | Returns | Guard and caller |
| --- | --- | --- | --- |
| `requiredPaths` | none (array property) | repo-relative files that must exist in the arm's source tree, checked before building | `orchestrate.prepareAll`: `harnessFor(arm).requiredPaths \|\| []` |
| `orchMetrics(outDir)` | run directory | spawn, depth, review-flow and phase-document metrics, or `null`. Stored as `acc.orch`. A throw becomes the flag `orchMetricsFailed` | `run-one.postProcess`: `if (harness.orchMetrics)` |
| `finalize(outDir, ctx)` | run directory | number of secrets redacted from output files. A value above 0 adds the flag `credsRedacted` | `run-one.executeRun`: `if (harness.finalize && ...)` |
| `secrets(ctx)` | run context | array of secret strings that are scrubbed from `result.json` before it is written | `run-one.executeRun`: `harness.secrets ? harness.secrets(ctx) : []` |
| `cleanupRun({ cwd, tmpdir, tmpBases })` | run paths | whatever `describeCleanup` accepts. Removes agent state that escapes the scratch HOME (Claude Code writes under the temp dir) | `run-one.executeRun`: `if (harness.cleanupRun)` |
| `describeCleanup(removed, tmpdir)` | the value `cleanupRun` returned | a record stored as `result.claudeCode.tmpCleanup` | `run-one.executeRun`, only when `cleanupRun` exists and the result has a `claudeCode` block. Required if `cleanupRun` is defined |

## Descriptor (`meta`)

Every harness module exports `meta`, a frozen record of static facts about the runtime. It lives in `<name>-meta.js` next to the module, with no requires, because `runtime.js` and `arms.js` read it and the harness modules cannot be loaded from there (`result.js` requires `runtime.js`). `descriptors.js` lists the three records; `index.js` exposes them as `registry` (id to descriptor), built from `HARNESSES`. `registry.test.js` checks that both lists agree, that every record has the fields below, and that the `harness` enum in `schema/result.schema.json` equals the registry ids.

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | runtime name, equal to the module's `id` and its `HARNESSES` key |
| `label` | string | display name |
| `armPrefix` | string | arm id prefix: `''` for kiro-cli, `oc-`, `cc-`. Exactly one runtime has `''`; it is the fallback of `runtimeOf` |
| `costUnit` | `'credits'` or `'usd'` | `'usd'` runtimes are the `USD_RUNTIMES` and fill `acc.usage` |
| `supports` | object of booleans | `trace`, `stopOn`, `effort`, `runCreditLimit`, `multiTurn`, `capCommands`, `skillStudy` |

`supports` records what the code allows today, read from the consumers named here. Nothing reads it yet.

| Key | Meaning | Where it is enforced today |
| --- | --- | --- |
| `trace` | `trace` can read the run | `trace.js:327` refuses opencode |
| `stopOn` | `--stop-on` and `--max-tool-calls` apply | `run-cmd.js:197-201` refuses Claude Code; `stop-watch.js:27` has an opencode branch |
| `effort` | the effort level is passed to the agent | `run-cmd.js:197-201` refuses `--effort` for Claude Code |
| `runCreditLimit` | `--run-credit-limit` applies | `run-cmd.js:215` refuses USD runtimes |
| `multiTurn` | autonomy (multi-turn) tasks run | `run-cmd.js:202-204` refuses Claude Code |
| `capCommands` | the `cap` commands accept the runtime | `cap/*` accept `kiro-cli` and `opencode` only |
| `skillStudy` | `cap skill-study` can drive the runtime | `cap/skillstudy.js` and `cap/studyio.js` are kiro-cli only |

Derived from the descriptors: `RUNTIMES`, `USD_RUNTIMES`, `isUsdRuntime` and `runtimeOf` in `runtime.js`, and the `oc-`/`cc-` prefix handling and `OC_PREFIX`/`CC_PREFIX` in `arms.js`.

## Other exports the runner uses from harness modules

These are not part of the per-run interface. They are runtime-specific helpers that `run-cmd.js` and others import directly, so a new runtime that needs the same kind of setup adds its own.

| Export | Used by | Purpose |
| --- | --- | --- |
| `kiro.kiroArgs`, `kiro.readTranscripts` | re-exported by `run-one.js` as `kiroArgs`, `readTranscripts` | tests and the cap tooling build kiro arguments and read session transcripts through `run-one.js` |
| `kiro.aggregateRunDir(outDir)` | `backfill.js`, `backfill-skills.js` | re-aggregate an existing run directory |
| `opencode.resolveOpencode`, `resolveRipgrep`, `envSetup`, `variantOf`, `PROVIDER`, `REGION`, `TITLE`, `VERSION`, `DEFAULT_MODEL` | `run-cmd.js`, `eval-commands.js`, `judge/opencode.js` | binary resolution and the run-config record for opencode |
| `claudeCode.resolveClaude`, `envSetup`, `runConfigRecord`, `checkCredentials`, `credentialNames`, `canonicalModel`, `versionWarning`, `CREDENTIAL_VARS`, `PROFILE_VARS`, `PERMISSION_MODE`, `DEFAULT_MODEL`, `DEFAULT_RUN_BUDGET_USD`, `REGION` | `run-cmd.js`, `scripts/claude-code-smoke.js` | binary resolution, credential checks and the run-config record for Claude Code |

## What `parseResult` must put in `acc`

`acc` is created by `run-one.executeRun` as `{ agg: null, session: null, checks: [], transcript: null, meta }`. `meta` already holds `flags: []`, `isolation`, `agentStarted` and whatever `installInto` returned. `parseResult` fills these, and `result.buildResult` reads them. Fill each field as soon as it is known, so a throw part-way keeps what was read.

| Field | Shape | Notes |
| --- | --- | --- |
| `acc.agg` | see below | Required. `null` only when parsing never ran |
| `acc.session` | `{ model, totalRequestCount, models? }` or `null` | `model` is compared with `config.canonicalModel ?? config.model`. A mismatch (also any entry of `models`) sets the flag `modelMismatch` and turns a success into an error |
| `acc.transcript` | `{ bytes, chars, partial }` | `chars / 4` is the token estimate for credit runtimes. `partial: true` adds the flag `transcriptPartial` |
| `acc.usage` | `{ tokens: { input, output, reasoning, cacheRead, cacheWrite, total }, costUsd, modelCalls, sessions, variants }` | USD runtimes only (`USD_RUNTIMES` in `runtime.js`). Leave it unset for credit runtimes |
| `acc.skills` | `skills.captureSkills({ runtime, events, arm, ctx })` | Optional but expected. Never throws. `skills.js` branches on the runtime name, see the checklist |
| `acc.meta.flags` | array of strings | Push flags here (for example `throttled`, `streamTruncated`). `buildResult` de-duplicates them |
| `acc.meta.infraError` | string | Set when the failure is not the model's (login, credential, binary problems). Turns a success into an error |
| `acc.meta.runError` | string | Set when the agent reported an error in its stream. Appended to `result.error` |
| `acc.meta.<runtime>` | object | Optional runtime block. Today only `meta.claudeCode` is copied into the result, and the schema allows it by name |
| `acc.meta.creditsSessionTotal` | number | kiro-cli only, the credit total read from session files |

### `acc.agg` fields

All of these are read by `buildResult` (through `streamFields`) or by classification. Use the neutral value shown when the runtime has no such concept.

| Field | Type | Neutral value | Used for |
| --- | --- | --- | --- |
| `sessionId`, `sessionIds` | string or null, string array | `null`, `[]` | result `sessionId`, session copy, credit cross-check |
| `runFinishedStatus` | string or null | `null` | status classification (`success` and `error` are the meaningful values) and the "finished" test for censoring. `null` means the stream never reported an end |
| `stopReason` | string or null | `null` | recorded in the result |
| `credits` | number | `0` | credit runtimes. Used only when `meteringEntries > 0` |
| `meteringEntries` | number | `0` | credit runtimes. USD runtimes report `0` |
| `nonCreditUnits` | array | `[]` | a non-empty array adds the flag `meteringUnit` |
| `turnDurationMs` | number or null | `null` | recorded in the result |
| `contextUsagePercentage` | number or null | `null` | recorded in the result |
| `toolCalls`, `workToolCalls`, `subagentCalls` | numbers | `0` | recorded in the result. `workToolCalls` is `toolCalls - subagentCalls` |
| `toolNames` | object, name to count | `{}` | recorded in the result |
| `skillsMcpOk` | boolean or null | `null` | kiro-cli only (skills server health). Others use `null` |
| `delegatedTo` | object, agent name to count | `{}` | subagent delegation counts, summing to `subagentCalls`. All three harnesses set it |
| `finalText` | string or null | `null` | capped at 20000 characters by the harness. Judges and autonomy replies read it |
| `finalTextTruncated` | boolean or null | `null` | `true` when the cap cut the text |
| `askedUser` | boolean or null | `null` | recorded; the autonomy conversation reads it through `turnSummary` |
| `configuredModel` | string, optional | absent | recorded as `streamModel` when present |

## How to add a runtime

1. Write `harness/<name>.js` exporting every required member above, with `id` set to the new runtime name. Add the optional members you need. Keep the parser for the agent's event stream in its own `<name>-parse.js` and reuse `parseStream` from `runner/lib/stream.js` for JSON-lines splitting.
2. Make the agent launchable as one local executable. An agent that is a library or a hosted service needs a small wrapper command that writes JSON lines to stdout and exits non-zero on failure. `buildCommand` returns that command.
3. Add `harness/<name>-meta.js` (the descriptor above), re-export it as `meta` from the module, list it in `harness/descriptors.js`, and register the module in `harness/index.js` (`HARNESSES`). `RUNTIMES`, `USD_RUNTIMES` and the arm prefix follow from the descriptor. Add the id to the `harness` enum in `schema/result.schema.json`; `registry.test.js` fails until you do.
4. Arm construction in `runner/lib/arms.js` follows the descriptor's `armPrefix`. Today every arm is a konductor ref, so a runtime that does not build konductor also needs a new arm source and a `prepareArm` that does not build anything.
5. Add a fixture: a recorded single-turn stream (one tool call, one final answer) at `runner/test/fixtures/harness-contract/<id>.jsonl` and one row in `CASES` in `harness-contract.test.js`. Also add a fake agent executable under `runner/test/` that prints a canned stream, and a parser test. Copy the shape of `claude-code-parse.test.js`, `claude-code-harness.test.js` and `opencode-run.test.js`.
6. Make `parseResult` fill `acc` as listed above, and run `validateResult` on a result built from the fixture.
7. Update the places that still switch on the runtime name (next section).

### Places outside `harness/` that still switch on the runtime name

Each of these must be edited by hand when a runtime is added. The registry work moves them onto the descriptor in steps. "Next step" marks the switches the following piece migrates; "later" marks the rest. Line numbers are at the time of writing.

- Next step. `runner/lib/run-cmd.js`: `:60` and `:114` (`r !== 'kiro-cli'`), `:188` (Claude Code only flags), `:191-192` (`isOc`, `isCc`), `:193-195` (cost unit and budget flag), `:197-201` (flags refused for Claude Code, from `supports.stopOn`, `supports.effort`), `:202-204` (multi-turn, from `supports.multiTurn`), `:215` (`--run-credit-limit`, from `supports.runCreditLimit`), `:99` (summary unit, from `costUnit`).
- Next step. `runner/lib/stop-watch.js:27`: `--stop-on` treats `opencode` specially and everything else as kiro.
- Next step. `runner/lib/trace.js`: `:236`, `:240`, `:326-329`, `:335-336` (refusal from `supports.trace`; timeline and skill-listing note per runtime).
- Next step. `runner/lib/result.js:64`: cost unit, already behind `isUsdRuntime`; switch to `costUnit` when the others move.
- Next step. `judge/bundle.js:49-50`: how the final text is extracted per runtime.
- Next step. `runner/lib/arms.js` `KNOWN_ARMS` and the `listArms` condition text; `report/aggregate.js:312`, `report/skills.js:165`, `report/factorial.js:60`, `cap/cli.js:328`, `cap/cli.js:567` (arm prefix literals; use `armPrefix`).
- Later. `runner/lib/skills.js`: `:125`, `:135`, `:177`, `:191`, `:291`, `:464` (skill-load capture, startup summaries, `skillsScope`).
- Later. `runner/lib/backfill.js:39`, `runner/lib/backfill-skills.js:34`: kiro-cli only.
- Later. `report/render.js:112,170`, `report/verdict.js:243,271`, `report/verdictdoc.js:43,112`, `report/orchpass.js:327`, `report/scores.js:237`, `report/diligence.js:166`, `report/compare.js:48,51`, `report/factorial.js:32,51`: labels, units and score formulas per runtime.
- Later. `cap/audit.js`, `cap/cli.js`, `cap/evidence.js`, `cap/forced.js`, `cap/proxy.js`, `cap/prune.js`, `cap/usage.js`: accept only `kiro-cli` and `opencode` (`supports.capCommands`); `cap/skillstudy.js`, `cap/studyio.js` (`supports.skillStudy`).
- Done by hand once: `schema/result.schema.json`, the `harness` enum. `registry.test.js` fails when it differs from the registry.
