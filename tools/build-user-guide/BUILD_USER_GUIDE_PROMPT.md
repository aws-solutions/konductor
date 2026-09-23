# Prompt — regenerate the Konductor HTML user guide

You are regenerating `docs/site/user-guide.html`, the single-file HTML rendering of the Markdown
user guide in `docs/user-guide/`. The Markdown is the source of truth. The HTML is a build artifact:
never hand-edit it, and never invent content that is not in the Markdown.

## Inputs

| Input | Path |
| --- | --- |
| Content (source of truth) | `docs/user-guide/**/*.md` |
| Existing HTML (structure to preserve) | `docs/site/user-guide.html` |
| Brand rules | `docs/brand/konductor-brand-sheet.png`, or the token table below |
| Content hash of the last build | `docs/site/.user-guide.manifest` |

## Hard rules

1. **Content is verbatim.** Reproduce every heading, paragraph, list item, table row, command, and
   expected-output block from the Markdown. Do not summarize, reorder, or "improve" prose. Editorial
   latitude is limited to navigation labels, page eyebrows, and the overview home page.
2. **No content that is not in the Markdown.** If a page is empty, render the page shell with its
   title and a "full content coming" note rather than writing filler.
3. **Every Mermaid block becomes a hand-built HTML/CSS diagram** in the brand style — never a
   `<pre>` of Mermaid source, never an image, never a live Mermaid render. Preserve node labels,
   edge labels, and the node-role semantics (ordinary step / needs-you / stop-or-refusal /
   success / skipped).
4. **One file out.** `docs/site/user-guide.html` must open from `file://` with no build step, no
   network fetch other than the Google Fonts link, and no local asset references.
5. **Behaviors must survive**: client-side search over the nav, collapsible sidebar sections,
   sticky per-page table of contents, copy-to-clipboard on every code block, the Kiro CLI /
   Claude Code runtime switcher that swaps commands, the light/dark toggle (dark default,
   persisted in `localStorage` under `konductor-guide-theme`), and prev/next page navigation.
6. **Flag, do not fix, content inaccuracies.** When the Markdown contradicts itself or the repo
   (for example skill or SOP counts), render what `docs/user-guide/` says and append the conflict
   to `docs/site/USER_GUIDE_BUILD_NOTES.md` with file and line references.
7. **Kiro CLI has two tool lists and they mean different things.** `tools` is what the agent may
   use — reaching for it prompts the reader for permission. `allowedTools` is the subset that is
   pre-approved and runs with no prompt. Never render an agent as *incapable* of writing files or
   running commands because a capability is missing from `allowedTools`; every agent declares
   `@builtin`, which grants `fs_write` and `shell`. The distinction is prompt-or-not, not
   allowed-or-not.
8. **Claude Code permissions belong to the reader, not the package.** `clientConfig.claudeCli.tools`
   is the ceiling — a tool absent from it cannot be used at all — but whether a granted tool prompts
   is decided by the reader's `$HOME/.claude/settings.json`, which sorts calls into `allow`, `ask`,
   and `deny`. Subagents share the parent agent's permission context, so the parent must hold a tool
   before a subagent it dispatches can call it.
9. **Lead every invocation example with an orchestrator.** Specialists can be started directly, and
   the guide may say so, but the default form is `konductor` — or
   `konductor-mux-orchestrator` / `konductor-cmux-orchestrator` for tmux, zellij, and cmux. Render
   a bare `--agent k-*` example as the alternative it is, never as the primary instruction.

## Brand tokens

Dark is the default theme. Do not introduce colors outside this set.

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--bg` | `#0B0A12` | `#F5F3EE` | Page ground |
| `--bg2` | `#100E1A` | `#FFFFFF` | Raised ground, output blocks |
| `--surf` | `#171331` | `#FFFFFF` | Cards |
| `--bd` / `--bd2` | `#2A2450` / `#3A3168` | `#E0DAD0` / `#CFC7BA` | Borders |
| `--tx` / `--mu` / `--mu2` | `#F5F3EE` / `#9C93B8` / `#6F6788` | `#16131F` / `#56516A` / `#8A8398` | Text ramp |
| `--vi` / `--lav` | `#7C5CFF` / `#A78BFA` | `#6236F0` / `#7C5CFF` | Primary accent, links |
| `--sig` | `#3DDC97` | `#0F9B67` | Success, checkpoints, the cursor — scarce by design |
| `--code` | `#0D0B15` | `#14111C` | Code block ground |

Type: Outfit (400/500/600/700) for everything except code, labels, CLI text, and data, which are
JetBrains Mono. Eyebrow labels are mono, 9.5–10px, `letter-spacing: .18–.2em`, uppercase.
Headings are sentence case, tightly tracked, never all-caps and never thin.

## Page set

Render one page per Markdown file, keyed by these ids (the sidebar order):

```
home            docs/user-guide/README.md              (overview home)
concepts        docs/user-guide/concepts.md
prerequisites   docs/user-guide/prerequisites.md
quick           docs/user-guide/quick-start.md
tasks           docs/user-guide/tasks/README.md
install-kiro    docs/user-guide/tasks/install-kiro-cli.md
install-claude  docs/user-guide/tasks/install-claude-code.md
init            docs/user-guide/tasks/initialize-a-project.md
diagnose        docs/user-guide/tasks/diagnose-problems.md
update          docs/user-guide/tasks/update.md
uninstall       docs/user-guide/tasks/uninstall.md
usecases        docs/user-guide/use-cases/README.md
uc-codebase     docs/user-guide/use-cases/understand-a-codebase.md
uc-design       docs/user-guide/use-cases/design-a-system.md
uc-plan         docs/user-guide/use-cases/plan-and-verify-work.md
uc-review       docs/user-guide/use-cases/review-code-and-tests.md
sops            docs/user-guide/sop-workflows/README.md
sop-plan        docs/user-guide/sop-workflows/planning-and-analysis.md
sop-design      docs/user-guide/sop-workflows/design.md
sop-code        docs/user-guide/sop-workflows/code-review.md
sop-test        docs/user-guide/sop-workflows/testing-and-specs.md
sop-orch        docs/user-guide/sop-workflows/orchestration.md
agents          docs/user-guide/agents.md
skills          docs/user-guide/skills.md
reference       docs/user-guide/reference.md
troubleshooting docs/user-guide/troubleshooting.md
faq             docs/user-guide/faq.md
glossary        docs/user-guide/glossary.md
help            docs/user-guide/getting-help.md
contributing    docs/user-guide/appendix/contributing.md
```

The prev/next chain through the SOP section runs `sop-plan` → `sop-design` → `sop-code` →
`sop-test` → `sop-orch` → `agents`, which is the order `html_sop_edits.py` wires into `NAV`.

A new Markdown file that is not in this list: add it to the list, to the sidebar section its
directory implies, and to the prev/next chain — then say so in the build notes.
`check-guide-facts.py` asserts this list covers every page under `docs/user-guide/`, so a file
added without updating it fails the drift check rather than getting silently dropped from a
regenerated bundle.

## Markdown → HTML mapping

| Markdown | Render as |
| --- | --- |
| `#` title | Page `h1`, with a mono eyebrow above it reading `SECTION / PAGE` |
| `##` / `###` | Section heading with an anchor id; every `##` also becomes a sticky-TOC entry |
| Body paragraph | 16px, `line-height: 1.75`, `--mu` |
| `**bold**` | `--tx` at weight 600 |
| Inline `` `code` `` | Mono 13px, `--tx`, on a `rgba(124,92,255,.16)` chip |
| ` ```bash ` / ` ```json ` / ` ```yaml ` | Code card: mono header bar with the language and a copy button, dark `--code` body |
| ` ```text ` immediately after a command | Output card: `--bg2` body, `OUTPUT` header, no copy button |
| Table | Bordered grid with a mono uppercase header row |
| `- [ ]` checklist | Checklist rows with a `--sig` box glyph |
| Blockquote | Bordered violet-tinted panel |
| "Checkpoint" / success block | Green-bordered panel with a `CHECKPOINT` eyebrow |
| Warning or "fails silently" block | Red-bordered panel (`rgba(255,107,107,…)`) |
| Cross-page link | In-app navigation to that page id, not an `href` to the `.md` file |
| External link | Real `href`, `target="_blank"` |

Commands that differ per runtime (`kiro-cli chat --agent konductor` vs
`claude --agent konductor`) must be driven by the runtime switcher rather than duplicated inline.
Only the command differs — the agent name is identical on both runtimes and carries no package
prefix, so never write `ASDLCCoreAICapabilities-<name>`, `konductor-asdlc-<name>`, or `asdlc-<name>`.

## Procedure

1. Read every file in the page set. Do not work from memory of a previous build.
2. Read the current `docs/site/user-guide.html` and keep its shell, tokens, components, and
   interaction code. Change only what the Markdown changed.
3. For each page: rebuild its body from the Markdown, then re-derive its sticky TOC from the `##`
   headings actually present.
4. Rebuild each Mermaid diagram from the current Mermaid source. If a diagram's nodes or edges
   changed, redraw it rather than patching the old markup.
5. Verify before finishing:
   - every page id in the list renders a non-empty body, or an explicit stub;
   - the emitted JavaScript parses: `python3 tools/build-user-guide/check-bundle-js.py`. Prose that
     lands inside a double-quoted JS string in the `data-dc-script` block must escape every `"` as
     `\"` — a raw one closes the string early, `dc-runtime`'s `new Function()` throws, and the whole
     page renders blank while every content check still passes;
   - no `mermaid`, `TODO`, or `lorem` strings survive in the output;
   - every `##` heading in the Markdown appears in the HTML (spot-check three pages by diff);
   - the runtime switcher, search, theme toggle, copy buttons, and prev/next all still work;
   - the page renders with no console errors, at 1280px and 1680px wide, in both themes.
6. Write `docs/site/USER_GUIDE_BUILD_NOTES.md`: build date, source commit, pages regenerated,
   diagrams redrawn, and any content conflicts found.
7. Write the content hash manifest (the wrapper script does this for you when it runs the build).

## Definition of done

`docs/site/user-guide.html` reflects `docs/user-guide/` exactly, opens standalone, keeps every
interaction, and the build notes name every inaccuracy found rather than silently smoothing it over.
