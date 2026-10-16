---
name: persistent-memory
description: Use after an error-recovery sequence, when the user corrects your approach and the correction is durable, or when a non-obvious project or environment convention or preference is discovered. Persists the fact to bounded memory files that survive across sessions.
---

# Skill: Persistent Memory

Local scratchpad (`.konductor/memory/`): personal, per-user, per-workspace. Never shared automatically. This is YOUR memory.

## Local Scratchpad Files

| File                          | Purpose                                | Default limit |
| ----------------------------- | -------------------------------------- | ------------- |
| `.konductor/memory/MEMORY.md` | Project/codebase/environment facts     | 2,200 chars   |
| `.konductor/memory/USER.md`   | Personal preferences and working style | 1,375 chars   |

**Semantic rule:** If it describes the project, repo, or environment → `MEMORY.md`. If it describes how the user likes to work → `USER.md`.

## Entry Format

Timestamped bullet lines, one fact per line:

```
- [2026-05-15] Project uses DynamoDB single-table design
- [2026-05-18] User prefers concise responses
```

## Reading Memory

Load `.konductor/memory/MEMORY.md` and `.konductor/memory/USER.md` via `fs_read` at session start for context, skipping silently if a file doesn't exist. Re-read the target file immediately before preparing a write operation, but not mid-session purely for in-context reasoning.

## Writing Memory

1. Re-read the target file from disk.
2. Prepare the **full file content** — all existing entries plus the new/updated one.
3. Pipe through the validator:

   ```bash
   VALIDATOR="$(git rev-parse --show-toplevel 2>/dev/null)/skills/persistent-memory/scripts/memory-validator.sh"
   if [[ ! -x "$VALIDATOR" ]]; then
     VALIDATOR="${SKILLS_HOME:-$HOME/.konductor/skills}/persistent-memory/scripts/memory-validator.sh"
   fi
   printf '%s' "$PROPOSED_CONTENT" | bash "$VALIDATOR" ".konductor/memory/MEMORY.md"
   ```

4. **Exit 0** → write succeeded (validator performs atomic write).
5. **Exit 1** → read stderr for reason, adjust and retry once, or skip if unresolvable.

**Missing validator:** If neither path resolves to an executable validator, fail closed — do not write, log the error, continue the session normally.

### Add an entry

Re-read file → append new bullet line → pipe full content through validator.

### Update an entry

Re-read file → replace the matching bullet line in place → pipe full content through validator.

### Remove an entry

Re-read file → delete the matching bullet line → pipe full content through validator.

### First-session bootstrap

If `.konductor/memory/` doesn't exist, create the directory, then pass initial content through the validator as normal.

- On first write, if `.konductor/memory/` is not in `.gitignore`, add the glob:

  ```bash
  printf '.konductor/memory/\n' >> .gitignore
  ```

## Configuration

Limits and URL allowlist are configurable via `.konductor/memory-config.json` at the project root:

```json
{
  "limits": {
    "memory_max_chars": 2200,
    "user_max_chars": 1375
  },
  "allowlist_patterns": ["*.example.com", "docs.myorg.dev"]
}
```

- `limits.memory_max_chars` — max characters for MEMORY.md (default: 2200)
- `limits.user_max_chars` — max characters for USER.md (default: 1375)
- `allowlist_patterns` — glob patterns for permitted URL domains in entries. Empty array = all URLs allowed. Populate with your org's domains to restrict external URLs.

A template is provided at `skills/persistent-memory/memory-config.json.template`. Copy it to `.konductor/memory-config.json` in your project and customize.

## Staleness

The validator emits warnings for entries older than 90 days. When you see a staleness warning, remove or update the flagged entry before the session ends.

## Memory-Nudge

Every 5–10 turns, self-evaluate: _Is there anything worth persisting?_

**Hard checkpoints — always evaluate before moving on:**

1. After an error-recovery sequence that exceeded 5 tool calls.
2. Before returning a final result.

---

## Routing Note (§6.2.2)

This skill handles **declarative facts, preferences, decisions, and conventions only**. Route
reusable multi-step procedures to `workspace-skills` instead.

| Captured knowledge is...                    | Route to            |
| ------------------------------------------- | ------------------- |
| A fact, preference, decision, or convention | `persistent-memory` |
| A reusable multi-step procedure or workflow | `workspace-skills`  |
| A one-time observation (not durable)        | Neither — discard   |

---

## Proactive Capture Triggers (§6.2.3 — do not wait to be asked)

### Primary triggers (act on any one)

- **User corrects your approach** and the corrected convention or preference is durable
  (implicit-correction detection — capture immediately; see Notification below)
- **Non-obvious convention or preference discovered** during work
  (e.g., "this project uses pnpm not npm")
- **Design decision or architectural constraint** established during the session

### Secondary trigger (weak signal — use only when all above are absent)

- The fact has been referenced or repeated ≥2 times in the same session

### Suppress (do not capture)

- One-time observations tied to a single occurrence (e.g., "build failed because of typo in line 42")
- Anything already covered by an existing entry (patch instead — see Scan-Before-Create below)

---

## Scan-Before-Create (§6.2.4 — hard gate)

**BEFORE creating a new memory entry, you MUST check for overlap.**

Scan `.konductor/memory/MEMORY.md` and `.konductor/memory/USER.md`. Both are loaded at session
start (per AGENTS.md) and are already in your context. Read them directly for the overlap
check; no file I/O needed when they are already in context.

**Decision rules:**

- Existing entry covers the **same fact** → **PATCH it** (only if `[origin:agent]`; see Provenance below)
- Overlap is **partial** and facts differ → **CREATE new** entry
- Unsure → **default to patching ONLY if `[origin:agent]`**; otherwise create new

Duplicates dilute memory quality and degrade recall.

---

## Provenance Markers (§6.2.5 — user entries are immutable to agents)

Every agent-created memory entry **MUST** carry `[origin:agent]` inline after the timestamp.
When the user explicitly dictates what to remember, write `[origin:user]`.

### Marker syntax

```
- [2026-06-12] [origin:agent] Discovered: project uses vitest not jest
- [2026-06-12] [origin:user] Always deploy to us-west-2 first
```

### Provenance gate — check BEFORE any modification

| Marker on entry                                        | Agent may PATCH? |
| ------------------------------------------------------ | ---------------- |
| `[origin:agent]`                                       | Yes              |
| `[origin:user]`                                        | Never            |
| No marker (untagged / legacy)                          | Never            |

If you cannot determine provenance, treat the entry as user-authored. When a user-authored
entry needs updating, **append a new agent-authored entry** with context rather than modifying
the original.

---

## Notification & Reduced Friction (§7.2)

| Capture type                | Confirmation?          | Notification?                |
| --------------------------- | ---------------------- | ---------------------------- |
| Durable fact / convention   | ❌ No                  | ✅ `"Saved: <summary>"`      |
| User implicit correction    | ❌ No                  | ✅ `"Captured: <summary>"`   |
| User-dictated memory        | ❌ No (explicit ask)   | ✅ `"Saved: <summary>"`      |

**All autonomous captures produce a visible notification. Do NOT wait for permission before
saving a durable fact — notify immediately after writing.**

If the capture turns out to be situational, the user can say "don't save that" in the next
turn and the entry can be removed.

---

## Claude Code CLAUDE.md Coexistence

Claude Code maintains its own `CLAUDE.md` file for project context. This coexists with `.konductor/memory/`. They serve different purposes. `CLAUDE.md` is Claude-managed and auto-updated. `.konductor/memory/` is agent-managed via the validator. Do not duplicate content between them. If both exist, use both as context sources.
