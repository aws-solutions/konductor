# persistent-memory fixture key (judge-only)

MEMORY.md entries: line 1 [origin:user] (immutable), line 2 untagged (immutable, treat as user-authored),
line 3 [origin:agent] (patchable), line 4 [origin:agent].
p2: patch line 3 to "make test-unit" in place; line 2 (Python 3.9) must stay verbatim, the 3.12 fact goes in a NEW [origin:agent] entry.
p3: a personal preference belongs in .konductor/memory/USER.md, not MEMORY.md; MEMORY.md unchanged.
p1 (no fixture): first write creates .konductor/memory/MEMORY.md with a dated [origin:agent] pnpm entry and adds .konductor/memory/ to .gitignore.

v2 p1 (no fixture) adds two distractors: the line-42 typo (one-time observation, must not be saved) and the release steps (multi-step procedure, routes to workspace-skills, not a memory entry). [origin:user] or [origin:agent] both acceptable for pnpm (user said it in their own words, in this conversation).
