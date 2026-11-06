<!-- SPDX-License-Identifier: Apache-2.0 -->

# Workflow engine

The Rust workspace behind `konductor flow`. It reads a workflow file, checks it against the rules in
[the specification](../docs/design/workflows-spec.md) and runs it. The design and the plan are in
[docs/design/workflows.md](../docs/design/workflows.md) and [docs/design/workflows-plan.md](../docs/design/workflows-plan.md).

This is step 1e of the plan: the file format and its checks (1c), the stage prompt and the runner on the `fake`
harness (1d), and trust (1e). It has no real harness and no canvas server yet.

## Crates

- `core` holds the format: the YAML loader, the key table, the checks, the diagnostics, the limits, the path rules and
  the stable JSON. It also holds the stage prompt (`prompt.rs`), the stage result parser (`result.rs`), the run, stage
  and check states (`run.rs`) and the runner (`runner.rs`), which also holds the guard that stops a session when the repo
  tool configuration changed after the confirmation. It does no IO. `core/tests/purity.rs` fails the build if the
  crate reads a file, opens a socket, starts a process, reads the environment, the clock or a random source, uses
  `unsafe`, or depends on a crate that is not in its allow list. The world reaches it through ports: `WorkflowSource`,
  `Clock`, `Harness`, `RunStore`, `RunLock`, `TrustStore`, `Terminal` and `AgentCatalog` (`ports.rs`). `trust.rs` holds the
  trust hash and its byte layout, the verdict on a `--trust` hash, and the summary the user reads before confirming.
- `adapters` holds what touches the world: the file source and the lookup of a bare name in `.konductor/workflows/` of
  the project and then of the home folder; the run store and the workspace lock under `.konductor/runs/`; the system
  clock; the trust record `~/.konductor/trust.json`; the scan of the repo tool configuration files; the agent catalog,
  which reads the tools of a Kiro or Claude agent definition; the terminal; and the `fake` harness, which replays
  scripted replies and is for tests only. `harness_choice.rs` decides
  which harness a run may use.

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
