# mcp/

Rust workspace for Konductor's MCP (Model Context Protocol) servers.

Each server is an independent stdio MCP server, built as its own binary
under `servers/<name>/`. This directory is a Cargo workspace
(`Cargo.toml` with `members = ["servers/*"]`), so `cargo` commands run
from `mcp/` operate across every server without needing to know their
names in advance.

## Layout

```
mcp/
├── Cargo.toml              # workspace root (members = ["servers/*", "lib/*"])
├── Makefile                # build/fmt/lint/test/install/link/clean, mirrors cli/Makefile
├── .gitignore
├── lib/
│   └── skill-lookup-core/   # shared scanning/index/frontmatter core (library crate)
│       └── src/
└── servers/
    └── skill-lookup/        # skill-lookup-mcp binary
        ├── Cargo.toml
        ├── src/main.rs
        └── tests/
```

## Shared library crates

`lib/skill-lookup-core` holds the directory-scan, tolerant-frontmatter-parse, and in-memory-index
logic originally built for `skill-lookup`: `index`, `frontmatter`, `scanner`, `model`, and the
scan-time size-guard constant. It carries no MCP protocol types and no CLI argument parsing — those
stay in each consuming server binary. `skill-lookup-mcp` depends on it via a workspace-relative path
dependency (`skill-lookup-core = { path = "../../lib/skill-lookup-core" }`).

Extracted once a second consumer was concretely planned — another MCP server that reuses the same
scan/frontmatter/size-guard machinery for a docs corpus — rather than speculatively ahead of time,
per this file's own "Adding a second server" guidance below on not guessing at abstractions.

## Current servers

- **skill-lookup** (`skill-lookup-mcp`) — stdio MCP server. Answers the
  MCP `initialize` handshake and scans every configured `--skills-dir`
  (repeatable) into an in-memory skill index at startup, reporting every
  unindexable directory rather than dropping it silently (see
  `SkipReason` in
  `lib/skill-lookup-core/src/model.rs` for the full list of conditions
  covered, and `skip_reason_message` in
  `lib/skill-lookup-core/src/frontmatter.rs` for how each renders). An
  optional `--skill-name-filter` narrows the index after scanning. No
  `find_skills`/`get_skill`/`reload_skills` MCP tools are implemented
  yet — the index built here has no consumer besides this server's own
  startup diagnostics until those land.

## Accepted risk: `rmcp` is pre-1.0

`skill-lookup`'s `Cargo.toml` exact-pins `rmcp = "=0.1.5"`. `rmcp` has not
yet reached a 1.0 release, so it carries no semver stability guarantee --
any future upgrade (e.g. to pick up the tool-registration APIs a planned
follow-up server needs, which don't exist in a no-op form in this
version) is a breaking-change risk. This scaffold's `ServerHandler`
implementation (`initialize`, `get_info`) is written directly against
`rmcp`'s current trait shape with no adapter/wrapper layer to absorb a
future signature change. This is an accepted trade-off for this initial
scaffold, not an oversight -- flagging it here so it stays visible rather
than implicit.

## Building

From `mcp/`:

```bash
make build   # cargo build --release --workspace
make lint    # clippy -D warnings + cargo fmt --check
make test    # cargo test --workspace
```

Or directly with cargo from this directory:

```bash
cargo build --release
cargo test
cargo clippy -- -D warnings
cargo fmt -- --check
```

## Adding a second server

This layout is designed so adding a new server requires **no edit** to
`mcp/Makefile`, `mcp/Cargo.toml`'s `members` glob, or
`build-tools/bin/aim-and-make-build`. Checklist:

1. Create `mcp/servers/<name>/` with its own `Cargo.toml` (`[[bin]] name =
"<name>-mcp"`, one binary per server) and `src/main.rs`. The binary
   name must be unique across the whole `~/.cargo/bin` namespace, not
   just within `mcp/servers/` -- `make install` (via `cargo install
--path`) installs every server's binary into that same shared
   directory, so two servers that produce the same binary name will
   silently overwrite one another there. Append the new binary's name
   to `konductor-rs`'s `MCP_SERVER_BINARY_NAMES` (in
   `cli/konductor-rs/src/cli/install/mcp_server.rs`) to have `konductor
install` pick it up too -- no other change needed there; see that
   constant's own doc comment.
2. Pin dependency versions exactly (no open ranges), matching this
   workspace's convention (see `servers/skill-lookup/Cargo.toml`).
3. Add tests under `mcp/servers/<name>/tests/`.
4. Run `make build lint test` from `mcp/` to confirm it picks up the new
   server automatically (it will, via the `servers/*` workspace glob).
5. If the new server needs to share code with an existing one, put the
   shared logic in a crate under `lib/` (picked up automatically via the
   `lib/*` workspace glob — see `lib/skill-lookup-core` for the existing
   example) rather than duplicating it. Do **not** create a new `lib/`
   crate speculatively ahead of an actual second consumer — the
   `skill-lookup-core` extraction happened only once a second server's
   need for the same scan/frontmatter/size-guard logic was concrete, not
   ahead of time.
