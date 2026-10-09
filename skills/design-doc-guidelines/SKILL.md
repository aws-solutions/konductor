---
name: design-doc-guidelines
description: Use when writing, reviewing, or restructuring a design doc, RFC, technical spec, architecture proposal, ADR, or one-pager. Trigger on requests like "review my design," "tighten this spec," or "is this too technical?" Covers outside-in structure, plain writing rules, AI slop detection, diagram accuracy, and technical accuracy. To challenge the design's decisions rather than its writing, use adversarial-design-review.
version: 1
---

# Design Doc Review

Use this skill when reviewing, writing, or restructuring design documents.

## Structure (outside-in)

Every design doc follows this flow:

1. **Problem**: concrete pain examples, not abstract statements
2. **Solution Overview**: one full-system diagram, one paragraph per feature, decisions framed as outcomes
3. **Decision Requested**: what you are asking approvers to approve, framed as user outcomes not feature names
4. **How It Works**: design-level explanation with diagrams BEFORE prose. No scripts, schemas, or regex.
5. **Implementation Details**: confined section. Clearly labeled so readers can skip.
6. **Implementation Plan**: phased task tables

## Review Checklist

When reviewing a design doc, check:

- [ ] Problem stated in first 10 lines with concrete examples?
- [ ] Can a reviewer understand the full approach in 10 minutes (reading §1-3 only)?
- [ ] Every "How It Works" subsection opens with a diagram?
- [ ] Diagrams tell the story without needing to read prose?
- [ ] Implementation detail confined to its own section (not mixed into design sections)?
- [ ] Language is simple and succinct? (short sentences, active voice, no filler)
- [ ] Tables used instead of prose for structured data?
- [ ] No forward references (mentioning something before it's defined)?
- [ ] Decision Requested framed as user outcomes, not feature names?
- [ ] Features explained in terms of problems they solve, not what the tool does?

## Anti-patterns

- Tool-first framing: "Here's what the tool does" instead of "Here's the problem, and here's how the tool solves it..."
- Walls of text where a diagram would work
- Mixing implementation spec into design sections (bash scripts, frontmatter schemas, regex rules)
- Abstract pain: "agents forget" instead of "you spend 5 minutes re-explaining DDB design every session"
- Feature-listing in Decision Requested: "approve Feature 1" instead of "approve so agents retain context"

## Writing Style

Engineering design documents must be written so the whole team can read them: PMs, engineering managers, and engineers alike. Trigger this section whenever the document is being drafted, revised, reviewed, or critiqued: a design doc, RFC, technical spec, architecture proposal, ADR, one-pager, or any "how we're going to build this" document. Trigger it even when the user just says "review my design," "tighten this spec," "is this too technical?", or pastes a doc and asks for feedback. Trigger it proactively too when producing a design doc as part of a larger task.

A design doc fails when half the team stops reading it. The PM skims it and gives up at the third acronym. The engineering manager can't tell what's actually being decided. An engineer reads the whole thing and still doesn't know what to build. The fix is to write so the ideas land for everyone, without dumbing the content down, and to layer the detail so each reader can go as deep as they need. Keep the engineering substance intact. Cut the things that get in its way: vague language, unexplained jargon, and the inflated, hedge-heavy filler that machine-generated text tends to produce.

A good design doc lets the first reader stop early and lets the last reader keep going, without the document repeating itself or splitting into two incompatible voices.

### Writing Rules

Default to plain words. If a short common word works, use it. Replace inflated vocabulary on sight.

Lead with the point. Put the conclusion first, then the support. Don't make readers wade through buildup to find out what you're recommending. "We should use a queue here because X" beats "There are several factors to consider, and after weighing them, a queue emerges as a reasonable option."

One idea per sentence; one topic per paragraph. Long, multi-clause sentences are where readers fall off. If a sentence has three commas and an "and," split it.

Handle jargon with a budget, not a ban. Engineers need precise terms; the doc would get longer and vaguer without them. The rule is placement and introduction:

- In the Summary, Problem, and Goals sections: no unexplained jargon, no acronyms on first use without expansion.
- In Detailed Design, technical terms are fine. That's what the section is for.
- The first time any acronym or non-obvious term appears, expand or define it once. "We'll use a write-ahead log (WAL) — a record of changes written before they're applied — so…" After that, use it freely.
- If you can't explain a term in a half-sentence, that's a signal the idea itself isn't clear yet.

Show, don't gesture. Replace vague claims with specifics. "Improves performance" → "cuts p99 latency from ~400ms to ~120ms." "Handles scale" → "designed for 10k writes/sec." A claim without a number or example is usually filler.

Prefer prose to bullet soup. Bullets are good for genuine lists (goals, options, steps). They're bad as a substitute for explaining how things connect. If every section is bullets, the reasoning has gone missing. Reasoning lives in sentences.

Use diagrams for anything spatial or sequential. Draw a flow, an architecture, a state machine, or a sequence of calls. One diagram replaces a paragraph that nobody parses correctly anyway.

### Cut the AI Slop

Machine-generated drafts (and tired human ones) share a recognizable set of tics. Hunt these down and delete or rewrite them. None of them carry information:

Filler openers and connectors add nothing. Delete outright:

- "It's important to note that…", "It's worth mentioning that…", "It should be noted that…"
- "In today's fast-paced / ever-evolving / rapidly-changing world/landscape…"
- "When it comes to…", "At the end of the day…"
- Stacked transitions: "Moreover," "Furthermore," "Additionally," opening consecutive paragraphs.

Inflated buzzwords that sound substantive but aren't. Cut them or make them concrete. `humanize-writing` §7 is the canonical list; this section defers to it rather than keeping a separate one.

Empty structure:

- The rule-of-three reflex: "fast, scalable, and maintainable" applied to everything. Keep the adjectives you can defend; drop the rest.
- Conclusion paragraphs that restate the doc without adding anything. If the last section just repeats the summary, delete it.
- "Not only X but also Y" when "X and Y" would do.

Over-hedging: "may potentially possibly," "it could be argued that," "in some cases it might be the case that." State the claim, then note the real uncertainty plainly: "This probably won't scale past 5k writes/sec — we haven't tested it."

Tone mismatch: marketing voice in an engineering doc. A design doc is an internal working document, not a launch announcement. No exclamation points, no "exciting," no "powerful new capability."

The test for any sentence: if deleting it loses no information, delete it. If a word can be swapped for a plainer one with no loss, swap it.

## Diagrams

- Use Mermaid (not ASCII art). Renders in most Markdown viewers.
- `sequenceDiagram` for multi-component interactions
- `flowchart` for decision trees and data flows
- `stateDiagram-v2` for lifecycle states
- Color-code with `rect rgb(...)`: blue (100,160,220) for reads, green (80,180,100) for writes, orange (220,150,50) for async/dispatch, using mid-tones that work on both dark and light themes
- Place diagrams BEFORE the prose they illustrate
- A reader should understand the flow from the diagram alone
- Don't overload one diagram. If it has >10 nodes or crossing arrows, split into focused diagrams (one job each)
- Label diagrams by what they answer: "How a session starts", "How agents get invoked", "What the agent writes back"

## Redundancy Review

After writing or restructuring, do a redundancy pass:

- Does any concept appear twice without adding richer detail the second time?
- If a detail exists in the Implementation section, the Design section should only summarize + cross-reference
- Sentinel files, retry behavior, and validation rules are common offenders for duplication
- Tables that appear in both "How It Works" and "Implementation Details" need clear boundary: summary vs spec
- Check adjacent sentences, not just sections: if covering sentence A and reading sentence B alone tells the reader nothing new, cut B or merge its addition into A.

## Document Flow (outside-in)

The doc must tell a story from the outside in:

1. Problem (why) → 2. Solution Overview (what, with full-system diagram) → 3. Decision Requested (approve what outcome) → 4. How It Works (design-level, diagrams first) → 5. Implementation Details (spec-level, confined) → 6. Implementation Plan (tasks)

Each layer is self-contained. A reviewer reads 1-4. A developer reads 1-6. Never mix layers.

## Multi-Feature Design Structure

When a design spans multiple features, use an anchor doc + per-feature sub-documents:

The **anchor document** covers the overall architecture and its components:

- Full system diagram showing all components and their relationships
- Component registry: name, responsibility, interfaces, owned data
- Cross-cutting concerns: auth, observability, error handling, data flow between components
- Does NOT contain feature-specific implementation detail

The **per-feature sub-document** follows a Minor Patch template:

- References the anchor doc for component definitions (do not redefine)
- States which anchor components participate and their role in this feature
- Adds only what is new or changed for this feature
- Sequence diagrams show anchor components by name, not re-described

**Rules:**

- Components flow from anchor → sub-docs, never the reverse
- A component's responsibility is defined once (anchor). Sub-docs reference it.
- If a sub-doc needs to clarify a component's behavior for its feature, add a focused note instead of copying the component description
- Avoid duplicating content unless emphasis is critical and the duplication is explicitly marked as intentional

## Diagram Accuracy

Before polishing layout or colors, verify the diagram is technically correct:

- Trace the actual control flow: who invokes whom? An arrow means "triggers" or "sends data to."
- Don't draw components side-by-side and connect them arbitrarily. Start with the trigger chain.
- If two things are entry points into the same system, show them converging. Don't imply one feeds the other.
- Results flow back through the component that produced them (e.g., agent reports results, not "during session" directly).
- Ask: "If I follow the arrows, does this match what actually happens at runtime?" If not, the diagram is wrong regardless of how clean it looks.

## Technical Accuracy

Before finalizing any claim in the doc, verify it matches reality:

- "Work stops when you close your laptop" — does it? (tmux survives)
- "Agent dispatches tasks to the board" — does it? (user creates tasks manually)
- "Three context sources load at start" — is it three or four?
- If you can't trace the claim to an implementation file or tool behavior, it's probably wrong.

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

## Threat Model Completeness

Every data flow that crosses a boundary needs a threat entry:

- Local → team memory sync: what sensitive data could leak?
- Team → local memory read: what cross-namespace data could be exposed?
- User → agent (instructions): what could be poisoned?
- Agent → filesystem (writes): what could be bypassed?

For each threat: state mitigations AND residual risk. "Accepted risk" is valid. Undocumented risk is not.

## Rename Propagation

After renaming any file or config field:

- `grep -rn "old-name"` across the entire repo
- Check: design docs, guides, scripts, skills, templates, .gitignore, CHANGELOG
- Companion docs are the most common place stale references hide
