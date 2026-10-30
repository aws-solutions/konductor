<!-- SPDX-License-Identifier: Apache-2.0 -->

# Workflow engine

The Rust workspace behind `konductor flow`. It reads a workflow file, checks it against the rules in
[the specification](../docs/design/workflows-spec.md), and prints the result. The design and the plan are in
[docs/design/workflows.md](../docs/design/workflows.md) and [docs/design/workflows-plan.md](../docs/design/workflows-plan.md).

This is step 1c of the plan: the file format, its checks, `flow check` and `flow show`. It has no runner, no trust
and no canvas server yet.

## Crates

- `core` holds the format: the YAML loader, the key table, the checks, the diagnostics, the limits, the path rules and
  the stable JSON. It does no IO. `core/tests/purity.rs` fails the build if the crate reads a file, opens a socket,
  starts a process, reads the environment, the clock or a random source, uses `unsafe`, or depends on a crate that is
  not in its allow list. Files reach it through the `WorkflowSource` port.
- `adapters` holds what touches the world. For now that is the file source, which implements `WorkflowSource`, and the
  lookup of a bare name in `.konductor/workflows/` of the project and then of the home folder.

The commands live in `cli/konductor-rs`, which depends on both crates by path. `examples/hello-plan.yml` is the example
that the tests check.

## Keys and slices

`core/src/keys.rs` has the one table that tags every key with the slice that adds it. A build at slice N honors the
keys of slices 1 to N. A key of a later slice is `NOT_SUPPORTED_BY_THIS_BUILD` and names its slice, and a key that no
slice plans is `UNKNOWN_KEY`. `BUILD_SLICE` is the slice of this build. Raising it, and adding the code that reads the
new keys, is how a slice ships.

## Build and test

```bash
cd workflow-engine
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

The crates declare `rust-version = "1.88"`.
