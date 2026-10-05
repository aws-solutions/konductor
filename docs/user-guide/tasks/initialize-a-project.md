<!-- SPDX-License-Identifier: Apache-2.0 -->

# Initialize a project

[← Task guides](README.md) · [Guide index](../README.md)

Scaffolds `.konductor/config.yml` so you have a real file to edit. **Optional**, most
installs never need this. Skip it unless you specifically want to change the telemetry
opt-out.

**Time required:** under a minute.

## Why you might want this

Konductor sends anonymous usage telemetry (see
[Data Collection](../../../README.md#data-collection) in the root README). The one
setting most people reach for is turning that off for a specific project, and
`.konductor/config.yml` is where that opt-out lives. The CLI itself behaves identically
with or without this file present: a project with no `.konductor/config.yml` at all
just uses the shipped defaults (telemetry on).

`konductor init` is the way to get a real, editable copy of that file; there is no other
command that creates it for you.

## Steps

### 1. Scaffold the file

```bash
konductor init
```

Run this from the project root (the same directory you'd run `konductor install`
against). On success it reports the files it wrote:

```
konductor init: Initialized Konductor project at .konductor
Wrote starter config: .konductor/config.yml
Wrote gitignore: .konductor/.gitignore
```

If `.konductor/` already exists, `init` fails rather than overwriting it. Pass
`--force` to overwrite it anyway:

```bash
konductor init --force
```

### 2. Edit the config

The scaffolded file has two fields:

```yaml
version: 1

telemetry:
  enabled: true
```

Set `enabled: false` to opt this project out of telemetry reporting. See the
[Configuration file](../reference.md#configuration-file) reference for the full field
list.

## What success looks like

```bash
cat .konductor/config.yml
```

Shows `version: 1` and a `telemetry:` block. `konductor doctor` also runs clean against
a project with this file in place, see [Diagnose problems](diagnose-problems.md).

---

[← Install for Claude Code](install-claude-code.md) · [Task guides](README.md) · [Next: Diagnose problems →](diagnose-problems.md)
