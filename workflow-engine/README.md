<!-- SPDX-License-Identifier: Apache-2.0 -->

# Workflow engine

The Rust workspace behind `konductor flow`. It reads a workflow file, checks it against the rules in
[the specification](../docs/design/workflows-spec.md) and runs it. The design and the plan are in
[docs/design/workflows.md](../docs/design/workflows.md) and [docs/design/workflows-plan.md](../docs/design/workflows-plan.md).

This is step 1f-3 of the plan: the file format and its checks (1c), the stage prompt and the runner on the `fake`
harness (1d), trust (1e), the process launcher with the `kiro-cli` harness (1f-1), the `claude` harness (1f-2), and the
optional ACP harnesses (1f-3). It has no canvas server yet.

## Crates

- `core` holds the format: the YAML loader, the key table, the checks, the diagnostics, the limits, the path rules and
  the stable JSON. It also holds the stage prompt (`prompt.rs`), the stage result parser (`result.rs`), the run, stage
  and check states (`run.rs`) and the runner (`runner.rs`), which also holds the guard that stops a session when the repo
  tool configuration changed after the confirmation. It does no IO. `core/tests/purity.rs` fails the build if the
  crate reads a file, opens a socket, starts a process, reads the environment, the clock or a random source, uses
  `unsafe`, or depends on a crate that is not in its allow list. The world reaches it through ports: `WorkflowSource`,
  `Clock`, `Harness`, `ProcessLauncher`, `RunStore`, `RunLock`, `TrustStore`, `Terminal` and `AgentCatalog`
  (`ports.rs`). The runner records the process group of each running session in the run state, and a new run ends the
  groups that a killed owner left behind (`runner.rs`, `sweep_session`). A harness that cannot get the group recorded
  stops the session, because the callback that records it returns a `Result`. `trust.rs` holds the
  trust hash and its byte layout, the verdict on a `--trust` hash, and the summary the user reads before confirming.
- `adapters` holds what touches the world: the file source and the lookup of a bare name in `.konductor/workflows/` of
  the project and then of the home folder; the run store and the workspace lock under `.konductor/runs/`; the system
  clock; the trust record `~/.konductor/trust.json`; the scan of the repo tool configuration files; the agent catalog,
  which reads the tools of a Kiro or Claude agent definition; the terminal; the process launcher (`launcher.rs`), which
  starts a program as the leader of its own process group, under the system `timeout` (or `gtimeout`) when one is on
  `PATH`, so that the limit outlives the owner, and runs it directly with a warning when there is none, keeps the tail
  of its output and of its standard error, stops it at a deadline or when the interrupt flag it was given is set, and ends a group with the system `kill` program (the
  CLI crate owns the signal handlers, so this crate has no signal crate and no `unsafe`); the `kiro-cli` harness
  (`kiro_harness.rs`), which runs one headless Kiro CLI session for each stage and passes no `--trust-tools`, so the
  agent file alone says what may run without asking; the `claude` harness (`claude_harness.rs`), which runs one headless
  Claude Code session for each stage and maps the agent's `tools` to `--allowedTools` rules; the ACP harnesses
  (`acp_harness.rs`), which run one ACP adapter for each stage (see below); and the `fake` harness, which replays
  scripted replies and is for tests only.
  `harness_choice.rs` decides which harness a run may use: the name given, or else the one runner harness that the
  install index records, which the CLI reads and passes in.

## ACP harnesses

`kiro-cli-acp` and `claude-acp` run a stage in an adapter that speaks the Agent Client Protocol, version 1, over the
adapter's standard input and output. The parts are:

- `acp_frames.rs` cuts the adapter's output into newline-delimited frames of at most 4 MiB.
- `acp_client.rs` is the conversation: `initialize`, `session/new`, `session/prompt`, the updates and permission
  requests that come while the agent works, and `session/cancel` at the time limit. It runs over a `Wire` trait, so its
  tests use no process. The agent's message is the text of its `agent_message_chunk` updates, of which the last 1 MiB is
  kept. Any other update is dropped, because updates are display data and never evidence. The deadline is checked before
  every frame, so an adapter that keeps sending updates cannot extend the time limit. A frame that is too long, is not
  JSON or answers a request that was not asked ends the stage with the cause. So does a request of the adapter whose id
  is not a number or a string of at most 256 bytes, more than 1000 requests of its own in one stage, a permission
  request for another session, and a change of the Claude permission mode away from `default`.
- `acp_permission.rs` answers `session/request_permission` from the allow rules of the agent file. A rule that names the
  tool allows the request through its `allow_once` option, chosen by `kind` and never by option id. Nothing else is
  allowed: `allow_always` is never chosen, a request that offers no one-time option is refused, and a rule narrowed in a
  way the matcher does not know (a Kiro rule scoped to some commands, or one with a deny rule beside it) matches
  nothing, and so does a name that starts with `-`. A rule that ends in `_*`, `/*`, `:*` or `.*`, as in
  `mcp__server__*`, is a prefix rule, and a `*` anywhere else matches nothing. The CLI harnesses have no matcher of
  their own: they hand the rules to Kiro or to Claude Code, which read them. A refusal ends the stage as
  `SESSION_FAILED` with the tool in the message, and the run halts. The agent file is the only source of allow rules
  that the runner uses. Kiro sends a permission request only when its own policy did not allow the tool, and the harness
  then answers from the agent file alone. Kiro also holds rules of its own, in its user and workspace permission stores
  and in what a user chose to always allow, and applies them without a request. Those stores were not verified, so a
  tool that one of them allows can run with no request and no mention in the agent file.
- `acp_process.rs` starts the adapter with `SystemLauncher::spawn_piped`: its own process group, piped input and output,
  and the group and start time recorded through the same callback as `launch`, so the sweep of a killed owner ends it. A
  reader thread and a writer thread keep every wait bounded by the time limit. Frames that wait for the client are
  bounded by bytes (8 MiB), so a fast adapter is slowed by the pipe, and so is what waits to be written to the adapter
  (1 MiB). Like a launched session, the adapter runs under `timeout` where there is one: that program is the group
  leader and the one whose start time is recorded, and its limit is set beyond the owner's own cancel, wait and group
  end, so these come first while the owner lives and the limit still ends the group if the owner is killed. The record
  carries that deadline. Without `timeout` the adapter runs directly. The group is ended on every path, and the adapter
  gets the environment of this process as it is. If the callback that records the group fails, the adapter is stopped
  and the stage does not start. A launcher given an interrupt flag passes it on: on Ctrl-C, SIGTERM or SIGHUP the
  conversation ends at once with no `session/cancel`, and the group gets the terminate signal, the grace period and the
  kill, as for the CLI harnesses. The last 4 KiB of the adapter's standard error are kept for the terminal and cut to
  printable lines under a failure line.
- `acp_harness.rs` implements `Harness` on the agent file that the catalog finds. One adapter runs for each stage and is
  ended when the stage ends. The agent file is hashed before the adapter starts and after the stage, and a stage during
  which the adapter rewrote the file fails. Every refusal names the agent file as the trust summary shows it, with the
  reason: a denied permission names the file whose rules decided it, and a rewrite says whether the file is gone or its
  content differs. A link to an agent file counts as that file, as in the config scan. Some Kiro CLI builds, including
  the 3.5.0 build this step was checked on, rewrite a writable agent file at the start of a session, so on them every
  `kiro-cli-acp` stage fails with this message. A read-only agent file in a read-only `.kiro/agents` folder avoids the
  rewrite. The check detects the rewrite after the stage. It does not prevent it. The harness reports a session as timed
  out only when the stage limit passed in the conversation, because the runner treats that verdict as the whole of the
  time limit. An adapter that exits with 124 or 137 early is a failed session, and so is every other end. The message
  text keeps its last 1 MiB, which is where the result line is, and that is the amount the runner reads. The 16 MiB of
  the Claude harness is for a JSON reply whose `result` is not at the end, so it does not apply.

The agent is chosen the way each adapter allows, and the answer to `session/new` has to name it, or the stage fails.
Kiro's V2 engine takes `--agent <id>`, and its V3 engine takes the agent as the session mode in `_meta.kiro.modeId`.
Claude's adapter takes `_meta.claudeCode.options.agent`, and the runner also passes `settingSources: ["project"]`,
so the user's settings and the local settings, which can hold allow rules the agent file does not, are not read. It
sets the permission mode `default` before the first prompt, because the adapter starts in `auto`. A session that does
not confirm the mode never gets the prompt.

The tests run a scripted ACP agent, `adapters/tests/common/fake_acp_agent.sh`. The engine's `adapters/tests/acp.rs` runs
it through the harness, and the CLI end-to-end tests put the same script on `PATH` under the name of an adapter. The
adapters are checked against the real programs by hand.

Two environment variables shorten the limits of an ACP stage for a test: `KONDUCTOR_ACP_TEST_LIMIT_MS` caps the
stage time limit (30 minutes) and `KONDUCTOR_ACP_TEST_GRACE_MS` sets the wait after `session/cancel` (10 seconds). The
`konductor` binary reads them in debug builds only, so a release build ignores them, and they can only make the limits
shorter.

The golden files of the stage prompt are in `core/tests/golden/`. They hold the exact text, with no final newline.

`examples/hello-plan.yml` is the example that the tests check.

## Keys and slices

`core/src/keys.rs` has the one table that tags every key with the slice that adds it. A build at slice N honors the
keys of slices 1 to N. A key of a later slice is `NOT_SUPPORTED_BY_THIS_BUILD`, and a key that no slice plans is
`UNKNOWN_KEY`. The message is plain, and the slice is in the `slice` field of the diagnostic. `BUILD_SLICE` is the slice
of this build. Raising it, and adding the code that reads the new keys, is how a slice ships.

## Build and test

```bash
cd workflow-engine
cargo fmt --check && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked
```

The crates declare `rust-version = "1.89"`, the first release with `File::try_lock`, which the workspace lock uses.

The checks of the `claude` harness against the real Claude Code are opt-in, because each one starts a session and
spends model time. A plain `cargo test` skips them with a message. To run them:

```bash
KONDUCTOR_CLAUDE_CONFORMANCE=1 cargo test --test claude_conformance -- --nocapture --test-threads=1
```

Each check works in a temporary project with its own `.claude/agents` and `.claude/settings.json` and a temporary
`CLAUDE_CONFIG_DIR`, so your own settings are not read. `KONDUCTOR_CLAUDE_PROGRAM` names another program than `claude`.
