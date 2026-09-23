<!-- SPDX-License-Identifier: Apache-2.0 -->

# Prerequisites

[← Back to guide index](README.md)

What you need before you start. It is a short list — Konductor is configuration plus a single binary,
with no servers, services, or cloud resources.

---

## The essentials

| Requirement | Why | Check it with |
| --- | --- | --- |
| **One AI runtime** — Kiro CLI *or* Claude Code | Konductor supplies no model of its own; it configures a runtime you already have | `kiro-cli --version` or `claude --version` |
| **Git** | Agents run git operations on your behalf during review and cleanup workflows | `git --version` |
| **A Rust toolchain** | No release has been published yet, so you build the CLI from a clone — [rustup](https://rustup.rs) is the usual way to get one | `cargo --version` |
| **A terminal** | Everything here is command-line | — |

That is all that is required. Pick your runtime:

### Kiro CLI

```bash
kiro-cli --version
```

Nothing else to configure — `konductor install` handles the rest. See
[Install for Kiro CLI](tasks/install-kiro-cli.md).

### Claude Code

```bash
claude --version
```

**Version 2.1.178 or later** is required for the agent-teams runtime, which is what lets the
orchestrator spawn specialists.

Claude Code also needs two settings configured before a team of agents can do anything — an
experimental environment variable and a tool-permissions allowlist. Skipping either makes the agents
fail *silently* rather than with an error, so it is worth doing up front. Both are covered in
[Install for Claude Code](tasks/install-claude-code.md).

---

## Supported platforms

| Platform | Status |
| --- | --- |
| macOS | Supported — Intel and Apple silicon |
| Linux | Supported — x86_64 and arm64 |

---

## Accounts and permissions

- **No Konductor account.** There is nothing to sign up for and no licence key.
- **Your runtime needs its own authentication.** Claude Code requires you to be signed in; Kiro CLI
  requires whatever your organisation configures.
- **No administrator privileges.** The CLI writes only to your project directory (`.konductor/`,
  `dist/`), your home directory (`~/.konductor/`), and your runtime's own configuration directory.
- **AWS credentials are optional** — needed only for the AWS documentation integration below.

---

## Optional integrations

Four agents can use external tool servers. Two are pre-configured and need only a local dependency;
two are opt-in and need an account.

| Agent | Integration | Pre-configured? | What you need |
| --- | --- | --- | --- |
| `k-architect`, `k-developer` | AWS documentation and region/service lookups | Yes | `uvx` installed, plus AWS credentials in `~/.aws/credentials` or environment variables. Both agents work without credentials, just without AWS lookups. |
| `k-browser` | Playwright browser automation | Yes | The Chromium binary |
| `k-researcher` | Slack search | No — opt-in | Your own Slack app. See [Slack integration](../guides/slack-integration.md). |
| `k-product-manager` | Asana sprint planning | No — opt-in | An Asana OAuth2 app. See [Asana integration](../guides/asana-integration.md). |

Install the Chromium binary if you plan to use `k-browser`:

```bash
npx playwright install chromium
```

For Claude Code specifically, the AWS and Playwright integrations need an MCP server configured on
your side — the agents request the tools but do not launch the servers. Detail in
[Install for Claude Code](tasks/install-claude-code.md#optional-integrations).

---

## Checkpoint

At least one of these should print a version:

```bash
kiro-cli --version
```

```bash
claude --version
```

If neither works, install a runtime first — nothing else in this guide will succeed without one.

Then continue to the [Quick Start](quick-start.md).

---

[← Core concepts](concepts.md) · [Back to guide index](README.md) · [Next: Quick Start →](quick-start.md)
