# Multi-document designs

Read this when a design spans several features, has a parent and companion doc, targets more than one runtime, or renames a file or config field.

## Multi-Feature Design Structure

When a design spans multiple features, use an anchor doc + per-feature sub-documents:

**Anchor document** — overall architecture and its components:

- Full system diagram showing all components and their relationships
- Component registry: name, responsibility, interfaces, owned data
- Cross-cutting concerns: auth, observability, error handling, data flow between components
- Does NOT contain feature-specific implementation detail

**Per-feature sub-document** — follows a short change template (problem, what changes, impact):

- References the anchor doc for component definitions (do not redefine)
- States which anchor components participate and their role in this feature
- Adds only what is new or changed for this feature
- Sequence diagrams show anchor components by name, not re-described

**Rules:**

- Components flow from anchor → sub-docs, never the reverse
- A component's responsibility is defined once (anchor). Sub-docs reference it.
- If a sub-doc needs to clarify a component's behavior for its feature, add a focused note — do not copy the component description
- Avoid duplicating content unless emphasis is critical and the duplication is explicitly marked as intentional

## Companion Documents

When a design has a parent + companion doc:

- The parent explains WHAT and WHY. The companion explains HOW in full detail.
- Every change to the parent risks breaking the companion. After editing the parent, check:
  - Stale section anchors (renamed sections = broken links)
  - Config examples missing new fields
  - Contradictions in defaults, paths, or behavior descriptions
- Duplicate content between docs must add richer detail in the companion. If it's just repeating, remove it and cross-reference.

## Cross-Tool Parity

When a design spans multiple runtimes (Kiro CLI, Claude Code):

- Call out where paths differ (`.kiro/skills/` vs `.claude/skills/`)
- State explicitly what is NOT portable and what requires manual copying
- If enforcement mechanisms differ by runtime (hooks available vs instruction-only), document both and state the gap

## Rename Propagation

After renaming any file or config field:

- `grep -rn "old-name"` across the entire repo
- Check: design docs, guides, scripts, skills, templates, .gitignore, CHANGELOG
- Companion docs are the most common place stale references hide
