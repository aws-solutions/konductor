<!-- SPDX-License-Identifier: Apache-2.0 -->

# Install via Kiro Power

[← Task guides](README.md) · [Guide index](../README.md)

The Konductor Power installs Konductor into the current Kiro project. It is an
alternative to the Kiro CLI and Claude Code installation paths.

## Prerequisites

| Requirement | Needed when |
| --- | --- |
| Kiro IDE or Kiro CLI v3 | Always. Powers do not run on Kiro CLI v2. |
| `curl`, `jq` | Always. The Power resolves and verifies a release. |
| `git`, Rust (`cargo`) | Intel Mac only. The Power builds the pinned source release. |

## Import the Power

1. Open the Powers panel and choose **Add Custom Power**.
2. Choose **Import power from GitHub**.
3. Enter:

   ```text
   https://github.com/aws-solutions/konductor/tree/v1.1.0/powers/konductor
   ```

4. Choose **Install**.

Installation registers the Power. It does not install Konductor or run any
commands yet.

For a local checkout, use **Import power from a folder** and select
`powers/konductor/`. If you changed `VERSION`, update
`powers/konductor/plugin.json`'s own `version` field to match first.

## Start setup

Say `konductor`, `install konductor`, or `set up konductor` in Kiro. You can
also use **Try power** from the Powers panel.

Before it writes or downloads anything, the Power asks for one confirmation.
Its plan names:

- the current workspace directory;
- the release repository and pinned tag;
- the platform-specific install path;
- the files it writes;
- telemetry, which is enabled by default;
- whether an optional `GITHUB_TOKEN` will be used.

The default source is `aws-solutions/konductor` at the tag derived from this
Power's `plugin.json`. The Power does not use a repository or tag found in
project files. A different repository or tag requires an explicit user
confirmation and `--allow-non-default-repo`.

## Installation behavior

On supported Linux and Apple Silicon systems, the Power downloads the pinned
release binary and its checksum sidecar. It verifies the checksum before the
binary is executed or linked to `~/.local/bin/konductor`.

On Intel Mac, the Power clones the exact release tag, verifies that `HEAD`
matches it, and runs `make build`. Native Windows is not supported; use WSL.

The Power then runs:

```bash
konductor install --harness kiro-v3 --target <current-project-dir> --version <pinned-tag>
konductor doctor --target <current-project-dir>
```

It stops if a command fails. `doctor` reports source, runtime, manifest,
configuration, container, index, telemetry, CLI version, and content version
status. Read the failing check's `fix:` guidance before retrying.

## After installing

How you start depends on where you are.

**In Kiro IDE:** open the agent selector in the chat input bar, next to the
model picker, and choose `konductor` from the Workspace group (or a
specialist such as `k-architect` or `k-developer`). Then ask in plain
language, for example "What is Konductor and what can I ask it?".

**In kiro-cli:** start a session and ask in plain language:

```bash
kiro-cli chat --agent konductor
```

See the [agents reference](../agents.md) for what each installed agent can
do, and [`about-konductor`](../sop-workflows/orchestration.md#about-konductor)
for a full orientation.

## Telemetry

Telemetry is enabled by default and is disclosed before setup begins. To opt
out during setup, tell the Power to decline telemetry when it states its
plan; it passes `--no-telemetry` to the `konductor install` it runs on your
behalf, using the exact binary it resolved and verified for this project.
Running `konductor install --no-telemetry` yourself invokes whichever
`konductor` is first on your `PATH` instead, which may not be that binary.

To opt out later, use one of these settings:

- `KONDUCTOR_TELEMETRY=off` for the current environment;
- `telemetry.enabled: false` in `<project>/.konductor/config.yml` for one
  project;
- `telemetry_consent: false` in `~/.konductor/telemetry.json` for the
  machine.

See the root README for collected data. `doctor` does not currently report a
project-level `config.yml` opt-out.

## Update

Ask the Power to update this project. It resolves the CLI binary recorded
for that project before updating, which avoids using a shared
`~/.local/bin/konductor` symlink that another project may have changed.
Running `konductor update --target <current-project-dir>` yourself invokes
whichever `konductor` is first on your `PATH` instead, not necessarily the
binary recorded for this project.

Updates overwrite managed agents, skills, and SOPs. Use the CLI dry run if
you need to inspect affected files first.

If the update fails because the project tracks more than one harness, choose
one and rerun with `--harness <name>`.

## Uninstall

Ask the Power to uninstall this project. It starts with a dry run and shows
you the result before removing anything. Running
`konductor uninstall --target <current-project-dir> --dry-run` yourself
invokes whichever `konductor` is first on your `PATH` instead, not
necessarily the binary recorded for this project. Review the dry run's
output, then confirm a real removal through the Power. The Power removes
its per-project CLI record only after a successful uninstall. It leaves
`.konductor/config.yml` in place.

If the uninstall fails because the project tracks more than one harness,
choose one and rerun with `--harness <name>`.

## MCP servers

Kiro does not configure MCP servers from `dependencies.mcpRegistry`
automatically. Configure them in `.kiro/settings/mcp.json` for one project or
`~/.kiro/settings/mcp.json` for all projects.

AWS MCP uses the `aws-mcp` server key. Use this configuration:

```json
{
  "mcpServers": {
    "aws-mcp": {
      "command": "uvx",
      "args": [
        "mcp-proxy-for-aws-cli==1.7.0",
        "https://aws-mcp.us-east-1.api.aws/mcp",
        "--metadata",
        "AWS_REGION=us-east-1"
      ]
    }
  }
}
```

Install `uvx` and configure AWS credentials before using AWS API tools. The
proxy is pinned for repeatable client behavior; the managed endpoint supplies
current AWS documentation and skills. `k-architect` and `k-developer` can use
all AWS MCP tools. Knowledge tools are pre-approved; API tools prompt for
confirmation. Use the `aws:ViaAWSMCPService` and `aws:CalledViaAWSMCP` IAM
condition keys to limit agent-initiated calls.

`k-browser` requires a separately configured Playwright MCP server. See the
[`playwright-mcp` entry](../reference.md#mcp-registry-entries) in the CLI
reference for its definition.

## Related

- [Install for Kiro CLI](install-kiro-cli.md)
- [Install for Claude Code](install-claude-code.md)
- [Install via the Claude Code plugin marketplace](install-claude-plugin-marketplace.md)
- [Troubleshooting](../troubleshooting.md)
- <https://aws-solutions.github.io/konductor/>

[← Task guides](README.md)
