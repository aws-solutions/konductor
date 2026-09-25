# fuse-flow

Deterministic runner for one workflow definition (`.konductor/workflow.yml`) and one state file per
workstream (`.konductor/workstreams/<slug>.yml`). Run it with Bun, no build step:

```bash
bun run fuse/flow/src/cli.ts <command>      # or put fuse/flow/ on PATH and call: fuse-flow <command>
```

Commands: `start <slug> [--workflow <path>]`, `next <slug>`, `done <slug> <step> [--artifact <path>]...`,
`gate <slug> <step> --owner-approved [--note <text>]`, `status <slug>`. The file formats and the agent
rule that drives it are documented in the FuseAICapabilities `skills/workflow/SKILL.md` (not ported to this repository); the step fields are listed at the top of `workflows/_k-full-sdlc.yml`, which is the default
workflow.

Tests: `bun test` in this directory (`bun install` once, for zod).
