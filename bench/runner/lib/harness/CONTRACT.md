# Harness contract

A harness runs one agent CLI for one benchmark run. The plugin registry, `bench/core/registry.js`, is the one list of harnesses: every `bench/plugins/<name>/plugin.json`. `runner/lib/harness/index.js` reads it and maps a runtime name to a harness module (`harnessFor(armOrResult)`); `harness/descriptors.js` reads the same list for the descriptors. Today there are four, all plugins: `bench/plugins/kiro-cli/harness.js` (`kiro-cli`, the default runtime: its arms have no prefix), `bench/plugins/opencode/harness.js` (`opencode`), `bench/plugins/claude-code/harness.js` (`claude-code`) and `bench/plugins/strands/harness.js` (`strands`, plant arms only: it runs `bench/physical/strands/launch.py`, a Strands agent with forwarding plant tool stubs).

This file lists what the runner calls. It is derived from the call sites in `run-one.js`, `orchestrate.js`, `run-cmd.js`, `arm-opts.js`, `skills.js` and `trace.js`, and it is checked against the four harness modules by reading them. `runner/test/harness-contract.test.js` reads the member tables below and checks every entry of `HARNESSES` against them, then runs `parseResult` on a recorded stream and checks `acc`. A missing member fails that test instead of raising a `TypeError` in the middle of a run.

"Required" means the runner calls it without a guard. "Optional" means the call site is guarded by `if (harness.x)`.

## Terms

- `arm`: one condition under test. Fields used by harnesses: `id`, `vanilla`, `agent`, `agentOverride`, `armConfig`, `prefixText`, `runtime`, `commitSha`, `contentHash`, `cacheKey`.
- `ctx`: the run context built in `run-cmd.js`. Harness-relevant members: `config`, `cacheDir`, `repo`, `kiroBin`, `opencode`, `claude`, `rgBin`, `awsCredsFile`, `awsProfile`, `awsCreds` (Claude Code with `--aws-profile`: `current()` gives the keys for the next run), `authDb`, `envKeep`, `skillInfo`.
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
| `buildCommand({ arm, task, config, ctx, cwd, resume })` | `resume` is `null` or `{ sessionId, prompt }` for the next turn of an autonomy task | `{ file, args, display, stdin? }`. `file` is an executable path, `display` is the line written to `command.txt`. `stdin`, when set, is the prompt text: the runner writes it to `<outDir>/prompt.txt` (`prompt-<turn>.txt` for a multi-turn task) and gives that file to the agent as stdin, so the prompt is not in argv (see below) | `run-one.runTurns` |
| `env({ arm, config, ctx, home, tmpdir })` | as listed | plain object, the complete environment of the agent process (an allowlist, not a copy of `process.env`). Core filters it before the agent starts (`env.agentEnv`): a `NEVER_PASS` name is always dropped, and a name that looks like a credential (`CREDENTIAL_NAME` in `env.js`) is dropped unless the harness lists it in `credentialEnv` or the operator kept it with `--env-keep`. A drop flags the run `envDropped` and names the variables (never values) on stderr | `run-one.executeRun`, through `env.agentEnv` |
| `removeCredentials(home)` | scratch HOME | nothing. Deletes any credential copy. Must not throw if there is none | `run-one.executeRun` (after the agent exits, and again in cleanup) |
| `keepPaths(ctx)` | run context | array of absolute paths that must stay visible inside the isolation namespace (the agent binary and its helpers) | `run-one.makeIso` |
| `turnSummary(streamText)` | the stdout of one turn | `{ sessionId, runFinishedStatus, stopReason, finalText, askedUser }`. `runFinishedStatus === 'success'` is what lets an autonomy conversation continue | `run-one.runTurns` (autonomy tasks only, but always called then) |
| `parseResult(outDir, { home, tmpdir, acc, arm, ctx, config, freshSessions })` | the run directory and the accumulator; `freshSessions` is true when `stream-N.jsonl` are separate conversations (a fresh-session task), so totals a harness reads as cumulative per conversation must be summed over them | nothing used (kiro returns `acc`, the others return nothing). Fills `acc`, see below | `run-one.postProcess`, only when `outDir/stream.jsonl` exists |
| `collectArtifacts(home, outDir, { arm })` | scratch HOME and run directory | nothing. Copies files worth keeping (installed agent definition, settings) before HOME is deleted, through `safe-copy.copyPlainFile`, which refuses a symlink on the path. A throw becomes the flag `artifactCopyFailed` | `run-one.postProcess` |

## Optional members

| Member | Arguments | Returns | Guard and caller |
| --- | --- | --- | --- |
| `streams` | none (object property) | the readers of the harness's own stream (`harness/streams.js`, FW-17): `finalText(events)` (required: the judge bundle reads it), `timeline(events)` (required when `meta.supports.trace`), `stopEvent(ev)` (one raw event as a stop-watch event `{kind: 'end'\|'call'\|'update', id, capability, detail, input, moreInput, done}`; read when `meta.supports.stopOn`, else the kiro-cli reader is used), and for `skills.js`: `skillReachable(kind, target, startup)` (whether the arm's startup record lets the agent reach a target; default the skills-server filter), `skillExtras(events, startup)` (result fields of the harness's own, Claude Code's `CLAUDE_SKILL_FIELDS`) and `skillsScope` (which sessions' loads the stream shows; default `'all-sessions'`), and `subagentTools` (a Set of the tool names that start a sub-agent, for a stream whose child events point at that call; read by `introspect/scopes.js` and `report/plant-trace/stream-calls.js`, optional). Plant readers are not here: they feed the safety scorer and stay core in `plant/stream-match.js` | `judge/bundle.js`, `judge/toolcalls.js`, `trace.js`, `stop-watch.js` through `streamsOf` |
| `credentialEnv` | none (array property) | credential-like names `env()` may return, for example `AWS_SECRET_ACCESS_KEY` when the agent signs its own model calls. Every other credential-like name is dropped by core. A plugin's list is part of its reviewed, hashed code | `env.agentEnv`: `harness.credentialEnv ?? []` |
| `requiredPaths` | none (array property) | repo-relative files that must exist in the arm's source tree, checked before building | `orchestrate.prepareAll`: `harnessFor(arm).requiredPaths \|\| []` |
| `orchMetrics(outDir)` | run directory | spawn, depth, review-flow and phase-document metrics, or `null`. Stored as `acc.orch`. A throw becomes the flag `orchMetricsFailed` | `run-one.postProcess`: `if (harness.orchMetrics)` |
| `finalize(outDir, ctx)` | run directory | `{ scrubbed, unscrubbed }` from `hygiene.scrubTreeDetailed`: files rewritten, and the files it could not scrub (`[{file, reason, detail}]`; `reason` is a cause class, see `hygiene.SCRUB_CAUSES`, and the judge classes the run by it). `scrubbed` above 0 adds the flag `credsRedacted`; any `unscrubbed` entry (or a throw) adds `credsUnscrubbed`, lists the files in `result.unscrubbedFiles`, and the run is not judged. Do not catch errors here. Files over 8 MB are scrubbed in chunks, symlinks are skipped. A bare number is still accepted as a count with nothing unscrubbed | `run-one.executeRun`: `if (harness.finalize)` |
| `secrets(ctx)` | run context | array of secret strings that are scrubbed from `result.json` before it is written | `run-one.executeRun`: `harness.secrets ? harness.secrets(ctx) : []` |
| `cleanupRun({ cwd, tmpdir, tmpBases })` | run paths | whatever `describeCleanup` accepts. Removes agent state that escapes the scratch HOME (Claude Code writes under the temp dir) | `run-one.executeRun`: `if (harness.cleanupRun)` |
| `observedListing(outDir)` | run directory | what the run loaded at session start, read from its own output (Kiro CLI: the first `context_usage` breakdown), or `null`. Stored as `result.skillListing.observed` beside the arm's record | `run-one.executeRun`, only when the arm has a listing record: `if (harness.observedListing)` |
| `describeCleanup(removed, tmpdir)` | the value `cleanupRun` returned | a record stored as `result.claudeCode.tmpCleanup` | `run-one.executeRun`, only when `cleanupRun` exists and the result has a `claudeCode` block. Required if `cleanupRun` is defined |

## The prompt and argv

An agent that runs `pkill -f <pattern>` matches every process whose command line contains the pattern, its own harness process included. When the prompt is in argv and names task paths, a `pkill -f` on a module the task mentions kills the agent CLI and ends the run. So a harness passes the prompt on stdin when its CLI reads it from there:

| Harness | Prompt | Why |
| --- | --- | --- |
| `claude-code` | stdin | `claude -p` with no prompt argument reads the prompt from stdin (`claude --help`: "useful for pipes") |
| `kiro-cli` | argv | `kiro-cli chat --help` documents the prompt only as the `[INPUT]` argument. It mentions piped stdin only for engine selection, and reading the prompt from stdin has not been checked against the real binary without a paid run. Until it is, the prompt stays in argv and a `pkill -f` on task text can still kill kiro-cli |
| `opencode` | argv | not checked against the opencode CLI; `opencode run` takes the message as arguments |
| `strands` | argv | plant arms only, on the scripted fake model; `display` hides the prompt |

## Host steps after the run

The agent can write its scratch HOME, its workspace and, until it exits, the files it was given. Every host step that runs after the run treats the run home, the workspace and the output files as untrusted: it does not execute them, does not load configuration from them, and does not follow symlinks in them. A query that needs a tool on the host (`parseResult` asking opencode for usage) runs on a clean copy of only the data it needs, in a fresh directory made by the runner after the agent exited, with an allowlisted environment that points only into that directory. Anything that must read agent-written files as code or config runs inside the sandbox instead. `lib/safe-copy.js` has the copy helper for `collectArtifacts`; `bench/plugins/opencode/query.js` is the reference for a query. The live output files are opened by the runner outside the agent-writable space and passed as inherited descriptors (on Linux the out dir files themselves; on macOS files in a directory beside the run root that the profile makes read-only, moved afterwards). Files the runner moves out of that directory (the live stream and stderr) are checked with `lstat` and opened without following links by `lib/move-file.js`, and a swapped file flags the run `stdioTampered`, lists its name in `tamperedFiles`, and keeps it out of judging.

**Limit: stream integrity on Linux.** The child is handed a writable descriptor for `stream.jsonl` and `stderr.txt`, and a hostile agent can rewrite its own descriptor through `/proc/<pid>/fd/1` without opening the masked path. `stdioTampered` does not catch that. Credit limits, the fetch audit, tool counts and the judge's final text derive from the stream, so none of them is protected against a hostile agent on Linux. The fix is a runner-owned pipe: the child writes to a pipe, the runner copies it to the file. It is a follow-up, not done; do not change the spawn mechanism in a harness to work around it.

## Descriptor (`meta`)

Every harness module exports `meta`, a frozen record of static facts about the runtime. It lives in the plugin's `meta.js` next to the module, with no requires, because `runtime.js` and `arms.js` read it and the harness modules cannot be loaded from there (`result.js` requires `runtime.js`). `descriptors.js` builds the registry (`core/registry.js`): the three built-in records, then each harness plugin under `bench/plugins/` (Strands is one; see `docs/write-a-plugin.md`). `index.js` exposes them as `registry` (id to descriptor), built from `HARNESSES`. `registry.test.js` checks that both lists agree, that every record has the fields below, and that `validateResult` accepts exactly the registry ids (the result schema lists no runtime).

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | runtime name, equal to the module's `id` and its `HARNESSES` key |
| `label` | string | display name |
| `proseName` | string | the name used inside error messages and notes (`kiro-cli`, `opencode`, `Claude Code`) |
| `armPrefix` | string | arm id prefix: `''` for kiro-cli, `oc-`, `cc-`. Exactly one runtime has `''`; it is the fallback of `runtimeOf` |
| `costUnit` | `'credits'` or `'usd'` | `'usd'` runtimes are the `USD_RUNTIMES` and fill `acc.usage` |
| `streamFormat` | `'kiro-acp'`, `'opencode-json'`, `'claude-stream-json'` or `'strands-jsonl'` | the shape of `stream.jsonl`. `stop-watch.js`, `trace.js` and `judge/bundle.js` pick their parser from it. A runtime with a new shape adds a value here and a parser to each of those three |
| `supports` | object of booleans | `trace`, `stopOn`, `effort`, `runCreditLimit`, `multiTurn`, `freshSessions`, `capCommands`, `skillStudy`, `agentEngine`, `prepareOnly`, `armConfig` |
| `flags` | object | `own`: run flags that only this runtime's arms accept (refused when no arm of the run uses it). `refused`: run flag to the reason it does not apply, in the order `run` checks them. `perRunCapFlag`: the flag that caps one run's cost, named in the `--run-credit-limit` refusal, or `null` |
| `noPrompt` | object | how runs skip the agent's own approval prompts (design 15.3, A-4): `flags` passed on the command line, `env` variables set for the agent, and a `note` on what they cover. the Strands plugin sets `env`; `kiroArgs` passes the kiro-cli flag, checked by `registry.test.js` |
| `plant` | object or `null` | how the runtime's plant arms reach the gateway: `mount` is `'agent-file'` (Kiro CLI: the shim in the plant agent file), `'mcp-config'` (Claude Code: the shim as the only `--mcp-config` server) or `'forwarder'` (Strands: stubs in the agent process); `pinKey` is the key under the release manifest's `versions` that pins the agent binary or package. Optional `only: true`: every arm of the runtime is a plant arm (Strands); `hooked: true`: it may run the `-hooked` plant arms, whose agent carries tool hooks (Strands); `arms.js` reads both. `null`: no plant arms. `lifecycle.js` mounts by `mount`, `intake.js` checks the pin by `pinKey`, and `checkSuiteShape` refuses a plant arm whose `streamFormat` has no plant reader in `plant/stream-match.js` |
| `multiTurnNote` | string or `null` | why autonomy tasks are refused; a string exactly when `supports.multiTurn` is false |
| `trace` | object | what `trace` says about the run. `sessionFiles`: the harness saves session files (`trace` reports their absence). `timeNote`: how time is known in `stream.jsonl`. `skillsListing`: `'agent-filter'` (the installed agent's skill filter) or `'slash-commands'` (the session init); `null` when `supports.trace` is false |
| `report` | object | what the reports say about the runtime (`bench/report/`). `factorialKey`: the cell key prefix in the 2x2 table (`kiro`, `cc`), or `null` when the runtime is not one of its two harnesses. `usdNote` and `killNote`: for a USD runtime, where its USD and token figures come from and how a killed run is charged (the report's "How to read"); `null` otherwise, and both or neither. `costWords`: the cost words of the efficiency formula when they differ from the shared text ("credits, or USD on opencode"; Claude Code: list-price USD as it reports it), or `null`. The verdict and the orchestrator pass speak of USD for every `'usd'` runtime |
| `capabilities` | object or `null` | how the `cap` commands reach a capability (`bench/cap/cli.js`, `cap/registry.js`); `null` exactly when `supports.capCommands` is false. `tools`: the tool a skill, SOP, agent or context unit is used through. `actingAgents`: the runtime's reach comes from the acting agent's spec (one runtime). `surface`: what the proxy trigger reads, `'agent-filter'` or `'skill-index'`. `proxyCallsPerQuery`: model calls per proxy query. `forcedLoad`: the forced arm's load clause for a skill, SOP and agent, with `{name}` for the unit (`cap/forced.js`) |
| `introspect` | object or `null` | what `--introspect` records (`runner/lib/introspect`). `probe`: `'otlp'` (OpenTelemetry to a loopback sink, and the session transcripts; the Claude Code stream) or `'request-dump'` (the v3 engine's request dumps; the kiro-cli stream). `null`: no probe, the run gets only the stream-based timeline |

`supports` records what the runner allows. `run-cmd.js` reads `runCreditLimit`, `multiTurn`, `freshSessions`, `agentEngine` and `prepareOnly`; `arm-opts.js` reads `armConfig`; `trace.js` reads `trace`. `effort` and `stopOn` must agree with `flags.refused` (`registry.test.js` checks it). The other keys are not read yet.

| Key | Meaning | Where it is enforced |
| --- | --- | --- |
| `trace` | `trace` can read the run | `trace.js` refuses a run whose runtime is false here |
| `stopOn` | `--stop-on` and `--max-tool-calls` apply | `flags.refused` in `run-cmd.js`; `stop-watch.js` reads `streamFormat` |
| `effort` | the effort level is passed to the agent | `flags.refused` in `run-cmd.js` |
| `runCreditLimit` | `--run-credit-limit` applies | `run-cmd.js` refuses runtimes that are false here |
| `multiTurn` | autonomy (multi-turn) tasks run | `run-cmd.js` refuses runtimes that are false here, with `multiTurnNote` |
| `freshSessions` | fresh-session tasks (`freshSessions`) run, with cost summed over the conversations | `run-cmd.js` refuses runtimes that are false here; only Kiro CLI and Claude Code are tested with them (`fresh-sessions.test.js`) |
| `capCommands` | the `cap` commands accept the runtime | `capabilities` is set exactly then (`registry.test.js`); `cap/runtimes.js` accepts those runtimes (`kiro-cli` and `opencode`) |
| `skillStudy` | `cap skill-study` can drive the runtime | `cap/skillstudy.js` and `cap/studyio.js` are kiro-cli only |
| `agentEngine` | `--agent-engine` applies | `engineOpt` in `run-cmd.js` |
| `prepareOnly` | `--prepare-only` covers the runtime | `prepareOnlyRun` in `run-cmd.js` |
| `armConfig` | `installInto` writes the arm's `--arm-config` keys into the scratch `~/.konductor/config.yml` | `applyArmOptions` in `arm-opts.js` refuses the flag for runtimes that are false here |

Derived from the descriptors: `RUNTIMES`, `USD_RUNTIMES`, `isUsdRuntime` and `runtimeOf` in `runtime.js`, and the `oc-`/`cc-` prefix handling and `OC_PREFIX`/`CC_PREFIX` in `arms.js`.

## Other exports the runner uses from harness modules

These are not part of the per-run interface. They are runtime-specific helpers on one harness module, reached by id as `HARNESSES[id]` or `harnessFor(arm)` (`harness/index.js` exports no harness by name since B-014 step 3), so a new runtime that needs the same kind of setup adds its own.

| Export | Used by | Purpose |
| --- | --- | --- |
| kiro-cli `kiroArgs`, `readTranscripts` | re-exported by `run-one.js` as `kiroArgs`, `readTranscripts` | tests and the cap tooling build kiro arguments and read session transcripts through `run-one.js` |
| kiro-cli `aggregateRunDir(outDir)` | `backfill.js`, `backfill-skills.js` (through `harnessFor({})`, the default runtime) | re-aggregate an existing run directory |
| opencode `resolveOpencode`, `resolveRipgrep`, `envSetup`, `variantOf`, `readProfile`, `PROVIDER`, `REGION`, `TITLE`, `VERSION`, `DEFAULT_MODEL` (`HARNESSES.opencode`) | tests only (`opencode-run.test.js`); the opencode judge, `plugins/opencode/judge.js`, reads them from its own `harness.js` (B-014) | binary resolution and the run-config record for opencode |
| Claude Code `resolveClaude`, `listingMismatch`, `envSetup`, `runConfigRecord`, `checkCredentials`, `credentialNames`, `canonicalModel`, `versionWarning`, `CREDENTIAL_VARS`, `PROFILE_VARS`, `PERMISSION_MODE`, `DEFAULT_MODEL`, `DEFAULT_RUN_BUDGET_USD`, `REGION` | `run-cmd.js`, `run-one.js` (`listingMismatch`), `scripts/claude-code-smoke.js` | binary resolution, credential checks and the run-config record for Claude Code |

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
| `delegatedTo` | object, agent name to count | `{}` | subagent delegation counts, summing to `subagentCalls`. All four harnesses set it (Strands always `{}`) |
| `finalText` | string or null | `null` | capped at 20000 characters by the harness. Judges and autonomy replies read it |
| `finalTextTruncated` | boolean or null | `null` | `true` when the cap cut the text |
| `askedUser` | boolean or null | `null` | recorded; the autonomy conversation reads it through `turnSummary` |
| `configuredModel` | string, optional | absent | recorded as `streamModel` when present |

## How to add a runtime

1. Write the harness module in your plugin folder, `bench/plugins/<name>/` (step 3), exporting every required member above, with `id` set to the new runtime name. Add the optional members you need. Keep the parser for the agent's event stream in its own `<name>-parse.js` and reuse `parseStream` from the bench SDK (`require('../../sdk').stream`) for JSON-lines splitting. A plugin requires bench code only through `bench/sdk` (`runner/test/plugin-sdk-lint.test.js`).
2. Make the agent launchable as one local executable. An agent that is a library or a hosted service needs a small wrapper command that writes JSON lines to stdout and exits non-zero on failure. `buildCommand` returns that command.
3. Register it. A new runtime is a plugin: a folder `bench/plugins/<name>/` with the harness module, its descriptor and a `plugin.json` of `{ "benchApi": 1, "kind": "harness", "name": "<name>", "version", "meta": "<descriptor file>", "entry": "<harness module>" }`. The name must equal the folder name, and both files must stay inside the folder. `core/registry.js` refuses another `benchApi`, an unknown kind or a bad manifest, with its reason, and a name clash is an error. `RUNTIMES`, `USD_RUNTIMES` and the arm prefix follow from the descriptor, and `validateResult` checks `harness` against the registry, so no schema edit is needed. `node bench/kit/plugin/check.js bench/plugins/<name>` checks a harness plugin for free. [Write a plugin](../../../docs/write-a-plugin.md) walks through it with the Strands plugin as the example. (The three built-ins are listed in `harness/index.js`, `BUILTIN`, and in `harness/descriptors.js`.)
4. Arm construction in `runner/lib/arms.js` follows the descriptor's `armPrefix`. Today every arm is a konductor ref, so a runtime that does not build konductor also needs a new arm source and a `prepareArm` that does not build anything.
5. A plugin (`bench/plugins/<name>/`, see `docs/write-a-plugin.md`) ships its fixture as `test/fixtures/single-turn.jsonl` with `test/conformance.js` and passes `node bench/kit/plugin/check.js`; a built-in instead adds a fixture: a recorded single-turn stream (one tool call, one final answer) at `runner/test/fixtures/harness-contract/<id>.jsonl` and one row in `CASES` in `harness-contract.test.js`. Also add a fake agent executable under `runner/test/` that prints a canned stream, and a parser test. Copy the shape of `claude-code-parse.test.js`, `claude-code-harness.test.js` and `opencode-run.test.js`.
6. Make `parseResult` fill `acc` as listed above, and run `validateResult` on a result built from the fixture.
7. Update the places that still switch on the runtime name (next section).

### Places outside `harness/` that still switch on the runtime name

Each of these must be edited by hand when a runtime is added. The registry work moves them onto the descriptor in steps. "Next step" marks the switches the following piece migrates; "later" marks the rest. Sites are named by function, not line, so the list does not drift; `grep -rnE "'(kiro-cli|opencode|claude-code|strands)'" bench --include='*.js' | grep -v test` finds each one.

- Done. `runner/lib/run-cmd.js`: flag legality (`flags.own`, `flags.refused`, `supports.runCreditLimit`, `supports.multiTurn`, `supports.agentEngine`, `supports.prepareOnly`, `costUnit`) reads the descriptor. The per-arm setup is asked of the harness (`runCredentials`, `runOptions`, `setUpRun`, `plantPreflight`, `checkFlags`, `prepareOnlyCheck`, `credentialsFile`, `modelConfig`; FW-18 step 6, D-212).
- Done. `runner/lib/stop-watch.js`: reads `streamFormat`. `opencode-json` gets the opencode reader (capability tools `skill` and `task` are still literal there); every other format is read as kiro-cli updates.
- Done. `runner/lib/trace.js`: the refusal (`supports.trace`), the timeline reader (`streamFormat`), the missing-data notes and the skill listing (`trace`) read the descriptor. Left: `agentFor` names runtimes.
- Done. `runner/lib/result.js`: the cost unit comes from `costUnitOf` (`costUnit`); the default runtime comes from `DEFAULT_RUNTIME`.
- Done. `judge/bundle.js`: `finalTextOf` picks its reader from `streamFormat` (`FINAL_TEXT`). A new stream format adds a reader there.
- Next step. `runner/lib/arms.js`: `KNOWN_ARMS`, `parseArmSpec`, `prefixOf`, `resolveArm`, `withProvenance`, `namesPlantArm`, `isHookedPlantArm` and `refusePrefixedPlant` (arm prefix and plant arm literals; use `armPrefix` and `plant`).
- Done. `runner/lib/skills.js`: skill calls, first decision, reachability, the Claude Code extras and `skillsScope` come from the harness `streams`. Left: the `runtime` labels of the startup summaries `startupKiro`, `startupOpencode` and `startupClaude`.
- Done. `runner/lib/introspect/`: the probe, the report and the call scopes read the descriptor's `introspect.probe`.
- Later. `runner/lib/backfill.js` and `runner/lib/backfill-skills.js` `assess`: kiro-cli only.
- Done. `report/`: labels, units and score formulas read `report` from the descriptor (FW-11, D-205).
- Done. `cap/`: the accepted runtimes and the tool table read `capabilities` and `supports.capCommands` through `cap/runtimes.js` (FW-12, D-206).
- Done. `schema/result.schema.json` has no `harness` enum any more; `validateResult` checks the name against the registry (`registry.test.js`).
