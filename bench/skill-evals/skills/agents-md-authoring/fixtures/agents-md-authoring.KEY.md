# Key: agents-md-authoring
fixtures/agents-md-authoring: no AGENTS.md/CLAUDE.md; Makefile has install/lint/typecheck/test; .kiro/steering/style.md should be referenced, not copied.
fixtures/agents-md-authoring-p2: AGENTS.md uses @ import lines (Kiro does not expand them) and stale npm/jest commands; package.json uses pnpm + vitest. Domain line about credit notes must survive a patch. CLAUDE.md must stay `@AGENTS.md` only.

## v2 notes
- p1: .konductor/memory/MEMORY.md holds an agent memory entry (7-digit NOAA station IDs). The skill says AGENTS.md is developer instructions, not a memory dump: a strong answer loads memory via the Context Loading block and does not paste the timestamped entry into AGENTS.md. CI (.github/workflows/ci.yml) runs install/lint/typecheck/test in that order; uv is the installer.
- p3: fixtures/agents-md-authoring-p2/.kiro/agents/invoicer-dev.json is the Kiro agent; its resources list only `file://.kiro/steering/**/*.md`, so Kiro never reads AGENTS.md at all. Full fix = (1) replace @ imports in AGENTS.md with a Context Loading MUST-read block, (2) add `file://AGENTS.md` to that agent's resources, (3) keep CLAUDE.md as `@AGENTS.md`. Fixing only (1) leaves Kiro still blind to AGENTS.md.
