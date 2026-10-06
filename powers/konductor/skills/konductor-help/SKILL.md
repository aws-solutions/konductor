---
name: konductor-help
description: Answers questions about an existing Konductor installation, CLI flags, health checks, SOPs, and MCP setup. Use after konductor-setup runs or when the user reports a Konductor problem.
---

# konductor-help

Use the installed CLI and project files as the source of truth. Resolve the
absolute binary created by `konductor-setup`; a bare `konductor` on `PATH` may
refer to a different installation.

## CLI behavior

Use the live schema for flags and defaults:

```bash
konductor __dump_schema
```

Do not present these entries as normal user commands:

- `metrics` is a stub.
- `config` is withheld from normal installations.
- `__telemetry-hook` is internal.

## Diagnose an install

```bash
konductor doctor --target <dir>
```

Read each failed or stale check’s `fix:` guidance. Use `--json` for
machine-readable output and `--no-version-check` when GitHub rate limits block
version checks.

The most relevant checks are:

| Check | Meaning |
| --- | --- |
| `source` | Validates the source tree and its references. |
| `runtime` | Reports detected runtime support. |
| `manifest` | Checks installed files and drift. |
| `config` | Validates `.konductor/config.yml`. |
| `telemetry_state` | Reports install-record and machine-level telemetry state. |
| `cli_version` | Compares the running binary with the latest release. |
| `content_version` | Compares target content with the latest release. |

`cli_version` and `content_version` are independent. The Power’s update path
uses `content_version`.

`telemetry_state` does not currently account for a project-level
`telemetry.enabled: false` setting in `.konductor/config.yml`. Do not claim
that doctor shows the full telemetry state.

## GitHub rate limits

Install and update support `--use-github-token` after explicit user consent.
`doctor` does not. For doctor, use `--no-version-check` instead of suggesting
a nonexistent token flag.

## SOPs and workflows

- In a source checkout, read `agent-sops/*.sop.md`.
- In an installed target, read `<target>/.konductor/sops/*.sop.md`.
- Kiro prompt discovery also creates `sop-<name>/SKILL.md` under
  `<target>/.kiro/skills/`.

Describe a workflow from its current source. Do not rely on an old command
list or hardcoded SOP count.

## MCP setup

Kiro does not automatically configure servers from `dependencies.mcpRegistry`.
Users must configure them in `.kiro/settings/mcp.json` or
`~/.kiro/settings/mcp.json`.

For AWS MCP, use the `aws-mcp` key and the pinned proxy configuration in the
Kiro Power install guide. Knowledge tools are pre-approved; API tools prompt
for confirmation. There is no `aws___call_aws` tool.

`k-browser` requires a user-configured `playwright-mcp` server. Do not launch
or configure browser or AWS MCP servers on the user’s behalf.

## Escalation

For behavior not covered here, use the project documentation and the actual
CLI output. State uncertainty rather than inventing a command, flag, or
runtime behavior.
