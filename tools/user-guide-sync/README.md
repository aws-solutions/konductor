<!-- SPDX-License-Identifier: Apache-2.0 -->

# user-guide-sync

Keeps `docs/user-guide/` **and** the published HTML (`docs/site/user-guide.html`,
`docs/index.html`) in step with the Konductor source tree.

## The loop

From the repository root:

```bash
make guide-check   # what drifted?  (read-only, no dependencies, seconds)
make guide         # fix what can be fixed mechanically, then re-check and record
```

`make guide` runs, in order: `guide-sync` → `guide-html` → `guide-check` → `guide-record`.
Everything is idempotent, so running it twice is a no-op.

| Step | Tool | What it fixes |
| --- | --- | --- |
| `guide-check` | `check-guide-facts.py` | Nothing — it **reports**. Nineteen sections; see the table below |
| `guide-sync` | `apply-renames.py` | Retired agent / SOP / context-file names, in Markdown **and** HTML, from the single map in `naming.py` |
| `guide-html` | `../build-user-guide/sync-html-content.py` | Source-derived facts in the HTML: roster counts, per-agent model/skill/SOP figures, the SOP catalogue |
| `guide-record` | `../build-user-guide/build-user-guide.sh --record` | Records the Markdown↔HTML pair as built, so `--check` has a baseline |

What no tool can fix is **prose**: workflow descriptions, output samples, and anything
requiring judgment. For that, run the semantic pass — paste `update-user-guide.prompt.md`
into a Claude Code or Kiro CLI session at the repository root, or follow it by hand.

## What `guide-check` actually checks

The numbers are the ones the script prints, in the order it prints them.

| # | Section | Catches |
| --- | --- | --- |
| 1 | Agent roster tables vs the specs | A wrong model, skill count, or SOP list in `agents.md` / `reference.md` / `skills.md`, including the per-agent cards and the bundle's roster rows |
| 2 | Named skills vs the specs | A card that names a skill its agent does not declare, or a "Declared by" cell that omits an agent — both pass every count check |
| 3 | Permission claims vs each runtime's tool model | "This agent cannot write files", derived from `allowedTools` when `tools` is the capability list. Reads the specs for the capability table and rejects the prose forms outright |
| 4 | Every shipped item is documented | A skill, SOP, or agent that no guide page mentions at all |
| 5 | Roster tables are **complete** | A roster table listing 13 of 19 SOPs — section 4 passes that, because the missing names appear elsewhere on the page |
| 6 | SOP ownership outside the roster pages | A removed registration that still names two owners in `sop-workflows/` or `use-cases/` prose |
| 7 | The build prompt's page set | A guide page a regeneration would silently drop |
| 8 | `wc -l` sample outputs | A sample that prints 75 next to a claim of 82 |
| 9 | Config keys vs `cli/gate-config/config.yml` | A missing or invented config key, including inside sample output |
| 10 | Command surface vs `cli/README.md` | A command the guide forgets, or invents, or a withdrawn one that leaked back in |
| 11 | Every `--flag` exists in `cli.rs` | A command that reads fine and exits `64` when a user runs it |
| 12 | Relative links resolve | A broken internal link |
| 13 | Published HTML vs the source tree | Retired names, stale package totals **in every rendering**, duplicated SOP entries, and missing SOPs |
| 14 | The two bundles agree | `docs/index.html` updated without `docs/site/user-guide.html`, or the reverse — which publishes a stale page while the artifact looks correct |
| 15 | Version strings agree with each other | Two different `konductor <x.y.z>` samples in one guide. The documented version is deliberately ungated against the source — see `notes.md` — so this checks the guide against itself |
| 16 | The toolchain's own prompts | A retired path in the two files that drive a regeneration, which is the one place a rename sweep did not reach |
| 17 | `--harness` on every install snippet | A copyable `konductor install` that exits `64` because the flag has no default |
| 18 | No retired download host | A `curl` snippet pointing at a host that never existed |
| 19 | Each bundle's inline JavaScript parses | A bundle that renders blank because an unescaped quote closed a JS string early |

Sections 5, 11, 13's duplicate check, 14, 17, and 19 each exist because a real bug got past
everything else. Keep that in mind before removing one.

## The files

| File | Role |
| --- | --- |
| `naming.py` | **The** retired-name → shipped-name map. Every rename lives here and nowhere else. Adding a rename here fixes Markdown and HTML in one pass |
| `htmlbundle.py` | Reads and writes the readable page inside an HTML bundle. Re-encodes exactly as the original bundler did, so an unchanged page is byte-identical and the theme, fonts and diagrams are untouched by construction |
| `apply-renames.py` | Applies `naming.py` to both artifacts. Dry-run by default |
| `check-guide-facts.py` | The drift report. Exit `0` = clean, `1` = drift, `64` = unexpected layout |
| `update-user-guide.prompt.md` | The semantic pass, for a human or an agent |

## Why the HTML is patched, not regenerated

`docs/site/user-guide.html` is not a render of the Markdown. It is a hand-authored
single-page app — its own navigation, runtime switcher, search, and CSS-built flow diagrams
— bundled with its fonts. Regenerating it from the Markdown would throw that away.

So the HTML is **patched**: `htmlbundle` decodes the page, the tools rewrite only the
strings that state facts, and it is re-encoded byte-for-byte. Fonts, colours, spacing,
and diagrams are never touched, because nothing writes to them.

The consequence: a genuinely **new** section (a new SOP, a new page) has to be authored
for the HTML as well, following the conventions already in the page — `param()` and the
four-argument `node()` helpers, a `flowCaption` per SOP, an entry in `NAV` and in
`SOP_ROWS`. See `tools/build-user-guide/html_sop_edits.py` for a worked example of adding
six SOPs, and `tools/build-user-guide/README.md` for the agent-driven alternative.

## Maintenance

- **Counts hide in more renderings than you expect.** The package totals appear as prose,
  as pre-formatted sample output at two different column widths, as a middot banner
  (`agents 11 · skills 82 · SOPs 19`), and as home-page stat tiles that put the number and
  its label in *separate spans* — so no text search for "82 skills" can see them. Section 13
  checks every one of those renderings against the source tree. If you add a new way of
  displaying a count, add it there too; a substring sweep will not find it for you.
- A new *kind* of mechanical claim (a new roster table, a new generated sample) is worth
  teaching to `check-guide-facts.py`. It is deliberately conservative and only checks what
  it can verify without judgment.
- The script parses the `## The N commands` section of `cli/README.md` and the Markdown
  roster tables by their header names (`Model`, `Skills`). If those structures are renamed,
  update the parsers.
- Intentional divergence between the guide and the source belongs in
  [`docs/user-guide/notes.md`](../../docs/user-guide/notes.md), with the reasoning.
