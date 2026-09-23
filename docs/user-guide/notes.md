<!-- SPDX-License-Identifier: Apache-2.0 -->

# Maintainer notes

**This page is for maintainers, not readers.** It is not linked from the guide index and is not
rendered into `docs/site/user-guide.html`. It records the standing decisions behind the guide's
wording, and the places where the guide and the source tree deliberately disagree — so that a
drift report can be triaged instead of re-litigated.

This file describes the **current state only**. Entries for problems that have been fixed are
removed once the fix lands; the git history is the record of how things got here.

Companion tooling: [`tools/user-guide-sync/`](../../tools/user-guide-sync/README.md) for the
drift checks, [`tools/build-user-guide/`](../../tools/build-user-guide/README.md) for the HTML.

---

## Standing decisions

| Decision | Ruling | Source of truth |
| --- | --- | --- |
| **Agent naming** | The orchestrator is `konductor`; its variants are `konductor-mux-orchestrator` and `konductor-cmux-orchestrator`; specialists carry the `k-` prefix. | `agents/*.agent-spec.json` |
| **Skill naming** | Skills are *not* renamed with the agent prefix. Two shipped skills begin with a prefix that looks like an agent prefix and must survive any rename sweep untouched — see `naming.PRESERVE`. | `skills/` on disk |
| **SOP naming** | All SOPs carry the `k-` prefix except `kiro-spec-workflow` and `about-konductor`. | `agent-sops/` on disk |
| **End-state vs as-shipped** | The guide describes **what ships now**. Where the CLI is a stub, the guide says so rather than describing the finished behaviour. | `cli/README.md` |
| **Documented version** | `1.0.0`. **No source file declares it** — `cli/konductor-rs/Cargo.toml` is `0.1.1` and `package.json` is `0.1.0`. This is the one number in the guide that cannot be verified against the source, and it is deliberately not gated. Bump the source before launch. | none — by decision |

---

## Deliberate divergences from the source

### `konductor`'s skill count is runtime-dependent

`konductor` declares 12 skills in `dependencies.skills.skillNames` and 13 in
`clientConfig.claudeCli.skills`; the extra one is `claude-teams-behavior`. Kiro CLI therefore
sees 12 and Claude Code sees 13. Every other agent's two lists agree.

The roster tables state **13** (the `claudeCli` basis, which `check-guide-facts.py` asserts
against) and footnote the Kiro CLI number. If the two lists are ever reconciled in the specs,
drop the footnote.

### `metrics` is a stub

It prints "not yet implemented". The guide says so rather than describing what it will report.

### Exit code `2` is reserved

`2` signals an unresolved CRITICAL gate and is owned by the run-engine, which is not yet
started. Usage errors are `64`. The guide must never show `2` for a bad invocation.

### No published release exists, and the repository is not public

`https://api.github.com/repos/aws-solutions/konductor` returns **404**. The remote install path
is fully implemented and documented in `cli/README.md` — GitHub release primary, `main`'s `dist/`
as automatic fallback, both checksum-verified — and `.github/workflows/release.yml` publishes
assets in exactly the shape the fetcher expects. What is missing is a published release.

`--from` was removed from every documented `konductor install` by reviewer decision, so the
documented command depends on that release and fails with a missing-asset error until the
repository is public. `--from` survives as one row in `reference.md`'s flag table, marked a
maintainer path. The guide describes the shipped product and does not narrate the pre-launch
window; the quick start builds from a clone without commenting on the release state.

One source-side contradiction is deliberately left alone, being outside a docs change:
`cli.rs`'s `--from` doc comment still says "Currently required: installing from a published
release is not yet available", which contradicts `cli/README.md` and the implemented
`remote_orchestrate` path. Worth a follow-up in the CLI.

### `konductor config` is withheld from the v1 guide

By reviewer decision: the command is not part of the customer-visible surface for the v1 launch,
so the guide does not document it. **`.konductor/config.yml` itself is still documented**,
schema included, because `konductor init` writes it and `konductor doctor` validates it —
removing the file too would leave both of those pointing at something the guide never describes.

`check-guide-facts.py` records this in `WITHDRAWN_COMMANDS` rather than dropping its
command-coverage check. That section asserts three things: every other command in
`cli/README.md` is documented, every withdrawn command is **absent** from `reference.md`,
`concepts.md` and `glossary.md`, and every name in `WITHDRAWN_COMMANDS` still exists in
`cli/README.md`. So a second withdrawal nobody recorded, or a `config` command that gets deleted
outright, both fail loudly instead of quietly widening the carve-out.

**Adding a name to `WITHDRAWN_COMMANDS` is a product decision, not a way to quiet the checker.**

---

## What the checks cover, and why each exists

Run `python3 tools/user-guide-sync/check-guide-facts.py`. Each section below exists because the
class of error it catches actually shipped once.

- **Roster and per-agent figures.** Counts appear in the roster tables, `skills.md`'s own table,
  `agents.md`'s per-agent cards, the bundle's roster rows, the home-page stat tiles and the
  home-page diagram's per-directory cells — six renderings, each checked, because a pattern
  written for one of them silently skipped the others.
- **`--harness` on every install snippet.** The flag has no default, so a snippet without it
  exits `64` on the spot. Scanned only in real snippets — fenced blocks in Markdown, `<pre>` and
  `code:`/`cmd:` fields in the bundle — since scanning prose produces false positives.
- **Retired names, in the guide *and* in `tools/`'s prompt files.** The two prompts that drive a
  regeneration are the worst place for a retired path to hide: an agent following one either
  verifies against a missing file or reads the stale name and reintroduces it.
- **The bundle's inline JavaScript parses.** The page boots by handing its `data-dc-script` block
  to `new Function()`. Prose spliced into a double-quoted JS string with an unescaped `"` closes
  that string early, the eval aborts, and the page renders blank — while every character-level
  check still passes. Only a parse catches it. `node` missing is a failure, not a skip.
- **`wc -l` samples, if any survive.** The reader-facing "verify it yourself" panels were removed;
  the appendix keeps one as a contributor instruction. If the last one ever goes, the section
  fails rather than passing on nothing.
- **Permission claims, against the right list.** Kiro CLI's `tools` is what an agent may use
  subject to a prompt; `allowedTools` is only the pre-approved subset. Reading the second as the
  capability boundary produced "this agent genuinely cannot write files" for eleven agents that
  all declare `@builtin`, which carries `fs_write` and `shell`. The capability table is now
  derived from the specs, and the prose forms of the mistake are rejected by name.

There is deliberately **no check against an installer manifest.** A manifest is a second copy of
the same list of names, so comparing the guide to it answers "do two lists agree" rather than "is
the guide right" — and it made the checker refuse to run in a tree without one. The source
directories are the only ground truth it reads.

Both bundles are also asserted byte-identical, since `docs/index.html` is what GitHub Pages
serves and `docs/site/user-guide.html` is the standalone artifact.

---

## A standing caution on `cli/README.md`

It is reliable for the **command surface** — flags, exit codes, the selection tables — all of
which held up under a line-by-line check against `cli/konductor-rs/src/cli.rs`.

It has repeatedly been wrong about what the CLI does at runtime, always in the same shape:
a claim phrased as "X is not implemented yet" or "Y is not installed anywhere" that had stopped
being true. Four such claims have been found and corrected so far.

**Rule: any claim of the form "not yet / not anywhere / does not work" must be checked against
`cli/konductor-rs/src/` and its tests before it goes in the guide.** Grepping for the relevant
phase or function name first is cheap; not doing it has already cost one documentation
regression, where correct guide text was edited *toward* the wrong answer.

---

## When a drift report fires

1. Run `python3 tools/user-guide-sync/check-guide-facts.py`.
2. For each failure, decide: **guide is stale** (fix the guide) or **source is wrong** (fix the
   source, and record it above only if the divergence is deliberate and ongoing).
3. Re-run until clean, then regenerate the HTML — see
   [`tools/build-user-guide/README.md`](../../tools/build-user-guide/README.md).
