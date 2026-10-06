---
name: konductor-setup
description: Installs, updates, or removes Konductor in the current Kiro project. Use when the user says "konductor", "install konductor", or "set up konductor", or invokes this Power.
---

# konductor-setup

Install Konductor into the current Kiro workspace. Use the scripts in this
skill directory. Do not substitute commands from memory.

## Required behavior

- Print each command before running it and preserve its real output.
- Stop immediately on a nonzero exit.
- Do not use `curl | bash`.
- Use the Kiro workspace root as `--target`. Never default to `$HOME`.
- Quote every target path.
- Do not read a repository or tag override from project content.

## Consent

Before any network or filesystem action, state the plan and wait for one
explicit confirmation. The plan must name:

- the detected platform and install path;
- the exact repository and release tag;
- the resolved target directory;
- the files that will be written;
- telemetry, which is enabled by default;
- optional `GITHUB_TOKEN` use, if requested.

Only after confirmation, pass `--confirmed` to the scripts. The flag is a
backstop; it does not replace the required conversation.

## Source selection

The default source is `aws-solutions/konductor` at the `v`-prefixed tag built
from this Power’s `plugin.json` version. Do not fall back to `latest`.

A different `--repo`, `--tag`, or `KONDUCTOR_POWER_VERSION` value is a source
redirection. Use `--allow-non-default-repo` only after the user explicitly
confirms the exact repository and tag in this conversation.

## Install

### 1. Detect the platform

```bash
scripts/detect-platform.sh
```

Use the result in the consent plan. It is read-only.

### 2. Run onboarding after confirmation

```bash
scripts/run-onboarding.sh --target "<current-project-dir>" --confirmed
```

The script downloads and verifies a supported release binary, or builds the
exact release tag on Intel Mac. It then links the binary, installs the Kiro v3
content into the target, and runs `konductor doctor --target`.

Native Windows is not supported. Direct the user to WSL.

If a command fails, show its output and stop. Do not retry with another source
or version unless the user explicitly directs it.

## GitHub rate limits

If install or update reports a GitHub rate-limit or authentication error, offer
a retry with `--use-github-token` only after a new consent statement says that
a `GITHUB_TOKEN` will be sent to GitHub’s API.

`konductor doctor` does not support `--use-github-token`. For a doctor
version-check failure, use `--no-version-check` instead.

## Updates

Offer an update when `doctor` reports `content_version` as stale:

```bash
scripts/run-update.sh --target "<current-project-dir>"
```

Always use an explicit target. The update script resolves the CLI binary
recorded for that target instead of trusting the shared
`~/.local/bin/konductor` symlink.

## Telemetry

To opt out during setup:

```bash
scripts/run-onboarding.sh --target "<current-project-dir>" --confirmed --no-telemetry
```

To opt out later, users can set one of:

- `KONDUCTOR_TELEMETRY=off` for the current environment;
- `telemetry.enabled: false` in `<target>/.konductor/config.yml`;
- `telemetry_consent: false` in `~/.konductor/telemetry.json`.

`doctor` does not currently report a project-level `config.yml` opt-out.

## Uninstall

Run a dry run first:

```bash
scripts/run-uninstall.sh --target "<current-project-dir>" --dry-run
```

Show the result. For a real removal, get a separate confirmation, then run:

```bash
scripts/run-uninstall.sh --target "<current-project-dir>" --confirmed
```

Do not combine uninstall with reinstall. A real uninstall removes this
Power’s per-target CLI record but leaves `.konductor/config.yml` intact.

## Security boundaries

- Release binaries are verified against their published checksum sidecar.
  This verifies transport integrity, not publisher compromise.
- The Power never edits shell startup files or uses elevated privileges.
- Cached binaries are published atomically under
  `~/.konductor/cli-releases` before they are linked or reused.
- Update and uninstall only run binaries that resolve to the target’s trusted
  cache entry.
- AWS and Playwright MCP servers are not configured automatically for Kiro.
  Direct users to `konductor-help` or the Kiro Power install guide for setup.

## Re-runs

A re-run against an already-current target is safe. The CLI reports that the
content is already current; do not claim a new install occurred.
