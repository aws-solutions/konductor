<!-- SPDX-License-Identifier: Apache-2.0 -->

# Workflow engine

The Rust workspace behind `konductor flow`. It reads a workflow file, checks it against the rules in
[the specification](../docs/design/workflows-spec.md) and runs it. The design and the plan are in
[docs/design/workflows.md](../docs/design/workflows.md) and [docs/design/workflows-plan.md](../docs/design/workflows-plan.md).

This is step 1f-2 of the plan: the file format and its checks (1c), the stage prompt and the runner on the `fake`
harness (1d), trust (1e), the process launcher with the `kiro-cli` harness (1f-1), and the `claude` harness (1f-2). It
has no canvas server yet.

## Crates

- `core` holds the format: the YAML loader, the key table, the checks, the diagnostics, the limits, the path rules and
  the stable JSON. It also holds the stage prompt (`prompt.rs`), the stage result parser (`result.rs`), the run, stage
  and check states (`run.rs`) and the runner (`runner.rs`), which also holds the guard that stops a session when the repo
  tool configuration changed after the confirmation. It does no IO. `core/tests/purity.rs` fails the build if the
  crate reads a file, opens a socket, starts a process, reads the environment, the clock or a random source, uses
  `unsafe`, or depends on a crate that is not in its allow list. The world reaches it through ports: `WorkflowSource`,
  `Clock`, `Harness`, `ProcessLauncher`, `RunStore`, `RunLock`, `TrustStore`, `Terminal` and `AgentCatalog`
  (`ports.rs`). The runner records the process group of each running session in the run state, and a new run ends the
  groups that a killed owner left behind (`runner.rs`, `sweep_session`). `trust.rs` holds the
  trust hash and its byte layout, the verdict on a `--trust` hash, and the summary the user reads before confirming.
- `adapters` holds what touches the world: the file source and the lookup of a bare name in `.konductor/workflows/` of
  the project and then of the home folder; the run store and the workspace lock under `.konductor/runs/`; the system
  clock; the trust record `~/.konductor/trust.json`; the scan of the repo tool configuration files; the agent catalog,
  which reads the tools of a Kiro or Claude agent definition; the terminal; the process launcher (`launcher.rs`), which
  starts a program as the leader of its own process group, keeps the tail of its output, stops it at a deadline and ends
  a group with the system `kill` program; the `kiro-cli` harness (`kiro_harness.rs`), which runs one headless Kiro CLI
  session for each stage; the `claude` harness (`claude_harness.rs`), which runs one headless Claude Code session for
  each stage and maps the agent's `tools` to `--allowedTools` rules; and the `fake` harness, which replays scripted
  replies and is for tests only.
  `harness_choice.rs` decides which harness a run may use: the name given, or else the one runner harness that the
  install index records, which the CLI reads and passes in.

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
