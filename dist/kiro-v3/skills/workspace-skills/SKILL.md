---
name: workspace-skills
description: >
  Use after trial-and-error that succeeded, a mid-task course correction, a
  user correction that worked, or an unexpected outcome requiring
  investigation. Captures the reusable procedure as a project-specific
  workspace skill, with proactive capture, dedup, and provenance
  protection.
origin: agent-created
version: 4
last_used: 2026-07-01
---

# Workspace Skills

## Routing note

Reusable multi-step procedures and workflows belong here.
Declarative facts, preferences, decisions, and conventions belong in
persistent-memory. When unsure, apply this rule:

| Captured knowledge is...             | Route to          |
| ------------------------------------ | ----------------- |
| A reusable procedure or workflow     | workspace-skills  |
| A fact, preference, or convention    | persistent-memory |
| A one-time observation (not durable) | Neither — discard |

---

## When to capture a skill (proactive — do not wait to be asked)

### Primary triggers (high-quality signal — act on any one)

- **Trial-and-error that succeeded**: you tried ≥2 different approaches
  before finding what worked
- **Course correction mid-task**: you changed approach partway through
  because the first path failed
- **User corrected your approach** and the corrected approach worked
- **Unexpected outcome requiring investigation**: a non-obvious finding
  that required diagnosis

### Secondary trigger (weak signal — use only when all above are absent)

- The task took **5+ tool calls with a coherent procedural arc**
  (mechanical repetition of the same tool does NOT qualify)

### Suppress (do not capture)

- Mechanical repetition of the same tool call N times with no variation
- Simple one-off answers with no reusable structure
- Anything already covered by an existing skill (patch instead)

---

## Phase-1 Decision Flow

```text
Agent completes a task step
        |
        v
Any Primary trigger fired?
        |
   YES -+- NO -> Any Secondary trigger with coherent arc?
        |                |
        |           YES -+- NO -> continue (nothing to capture)
        |                |
        v                v
Classify: Fact -> persistent-memory | Procedure -> workspace-skills
        |
        v
Scan existing skills for overlap (see Scan-Before-Create)
        |
  Overlap? --YES--> Check origin marker
        |                |
        NO               | [origin:agent-created] --> PATCH existing skill
        |                | [origin:user-authored] or untagged --> CREATE new
        v                v                                       + note related:
  CREATE new          (PATCH or CREATE)
  origin: agent-created    |
        |                  |
        +------------------+
        |
        v
  Lightweight confirm: "Capturing skill: <name> — <one-line desc>. OK?"
        |
        v
  Write skill file
        |
        v
  Notify: "Captured skill: <name> — <desc>"
```

---

## Offer, then confirm

When a quality signal fires, propose the capture with a single
lightweight confirm line — keep it low-friction:

> "Capturing skill: `<name>` — `<one-line desc>`. OK?"

After the user confirms, write the file and notify:
"Captured skill `<name>` — `<desc>`."

Write the offer in third person, stating WHAT the skill does AND WHEN to
use it, including trigger phrases the user might say. The provenance
markers and immutability gate (see Provenance Markers below) are the
safety net — they protect user-authored content regardless of how
capture is initiated.

---

## Scan-Before-Create (dedup gate — mandatory)

**Before creating any new skill entry, you MUST check for overlap.**

Check the `ws-*` workspace skills **already visible in your context**.
They are loaded at session start via the `skill://.kiro/skills/ws-*/SKILL.md`
resource glob (re-resolved each session). Each workspace skill's name
and description appear in your context — scan those for overlap before
writing anything.

**Decision rules:**

- Existing skill covers the **same use case** → **PATCH it** (only if `origin: agent-created`; see Provenance below)
- Overlap is **partial** and use cases differ → **CREATE new** + add
  `related: [existing-name]` in frontmatter
- Unsure → **default to patching ONLY if `origin: agent-created`**;
  otherwise CREATE new + `related: [existing-name]` (so user-authored
  skills are never patched under uncertainty)

Duplicates dilute discovery and degrade retrieval quality.

---

## Provenance Markers (user entries are immutable to agents)

Every agent-created skill **MUST** carry `origin: agent-created` in its
frontmatter. When the user explicitly dictates a skill, write
`origin: user-authored`.

### Provenance gate — check BEFORE any modification

| Marker in frontmatter                         | Agent may PATCH? |
| --------------------------------------------- | ---------------- |
| `origin: agent-created`                       | Yes              |
| `origin: user-authored`                       | Never            |
| No `origin` field (untagged / legacy)         | Never            |

If you cannot determine provenance, treat the entry as user-authored.
When a user-authored skill needs updating, **create a new agent-authored
skill** with `related: [original-name]` rather than modifying the
user's entry.

---

## What a worth-saving skill contains

All four of the following. If any is missing, the workflow is not stable
enough yet — keep iterating, do not save.

1. **Trigger conditions** — when to use this skill (be specific)
2. **Numbered steps** with exact commands or tool calls
3. **Pitfalls section** — what goes wrong and how to avoid it
4. **Verification steps** — how to confirm the procedure succeeded

---

## Key Distinctions

| Type             | Location        | Scope                               | Contains            |
| ---------------- | --------------- | ----------------------------------- | ------------------- |
| Workspace skills | `.kiro/skills/` | Local; commit is developer's choice | Procedures (how-to) |

---

## How to Create a Skill

1. **Scan** for overlap using the `ws-*` workspace skills already in context
   (see Scan-Before-Create above) — the scan result determines whether to
   PATCH an existing skill or CREATE a new one before offering.
2. **Offer** with a lightweight confirm line: "Capturing skill:
   `<name>` — `<one-line desc>`. OK?" Keep it low-friction.
3. **Write** to the appropriate path for the current runtime after
   confirmation:
   - `.kiro/skills/ws-<name>/SKILL.md` (Kiro CLI)
   - `.claude/skills/ws-<name>/SKILL.md` (Claude Code)
4. **Notify** the user: "Captured skill `<name>` — `<desc>`."

The `ws-` prefix is **mandatory** for both runtimes — it prevents name
collisions with package-provided skills.

---

## Frontmatter Schema

```yaml
---
name: ws-<name>         # kebab-case, ws- prefix required
description: <one sentence>  # what procedure this skill captures
origin: agent-created   # or: user-authored
version: 1              # integer, increment on every edit
last_used: YYYY-MM-DD   # updated after applying the skill
related: []             # optional: names of related/overlapping skills
---
```

---

## Example Skill Body

```markdown
---
name: ws-dynamodb-pagination
description: >
  How to implement DynamoDB pagination with LastEvaluatedKey
  in this project.
origin: agent-created
version: 1
last_used: 2026-05-21
related: []
---

# DynamoDB Pagination

## When to use

- Implementing a list/query endpoint that returns more items than fit in a single response
- Adding cursor-based pagination to an existing DynamoDB `QueryCommand` or `ScanCommand`
- Debugging incomplete result sets that silently drop items due to missing `LastEvaluatedKey` handling

## Pattern

Always use `ExclusiveStartKey` + `LastEvaluatedKey`. Never use `Limit`
alone as a pagination signal.

## Steps

1. Accept optional `nextToken` query param (base64-encoded key)
2. Decode token -> pass as `ExclusiveStartKey` to `QueryCommand`
3. If response has `LastEvaluatedKey`, encode -> return as `nextToken`
4. Return `{ items, nextToken }` -- omit `nextToken` on last page

## Pitfalls

- Using `Limit` as a stop signal returns partial pages when items are
  filtered post-scan
- Forgetting to base64-encode the token before returning to the client

## Verification

- Paginate through a table with 3+ pages; confirm all items returned
- Request with an invalid token returns a clear error, not empty page
```
