<!-- SPDX-License-Identifier: Apache-2.0 -->

# Building the HTML user guide

`docs/user-guide/**/*.md` is the source of truth. `docs/site/user-guide.html` is a build artifact —
a single self-contained page with search, a collapsible index, per-page tables of contents, copy
buttons, a Kiro CLI / Claude Code runtime switcher, and a light/dark toggle.

> **Most updates do not need this.** For a source change that only moves facts — a
> renamed agent, a new SOP, changed roster counts — run `make guide` from the repository
> root. That patches the Markdown and both HTML bundles deterministically, in seconds,
> with no AI runtime. See [`tools/user-guide-sync/`](../user-guide-sync/README.md).
> Reach for the agent build below only for a genuine re-author.

## Where things live

```text
docs/
├── user-guide/                     # Markdown — the source of truth, edited by hand
├── index.html                      # the page GitHub Pages serves from /docs
├── site/
│   ├── user-guide.html             # the same page, as a standalone artifact
│   ├── .user-guide.manifest        # content hash of the Markdown at last build
│   └── USER_GUIDE_BUILD_NOTES.md   # generated: what changed, what conflicts were found
└── brand/                          # brand sheet + logo assets the build reads
tools/build-user-guide/
├── BUILD_USER_GUIDE_PROMPT.md      # the build instructions the agent follows
├── build-user-guide.sh             # wrapper: build, --check for CI, --record after a tool run
├── sync-html-content.py            # deterministic fact updates for both bundles
├── html_sop_edits.py               # the SOP sections, as exact-match bundle edits
└── README.md                       # this file
```

**Both HTML files matter.** `docs/index.html` is what GitHub Pages serves (there is a
`.nojekyll` at `docs/` and no Pages workflow), and `docs/site/user-guide.html` is the
standalone artifact. Every tool here updates both; updating only one publishes a stale page.

Why `docs/site/` rather than `docs/`: publishing all of `docs/` to Pages would also publish the
raw Markdown and the internal guides. A single output directory keeps the published surface
explicit, and `--check` can gate it. If you would rather not commit a build artifact at all, add
`docs/site/user-guide.html` to `.gitignore` and build it in CI on the release branch — the drift
check then becomes unnecessary and the workflow below just uploads the artifact.

## Build

```bash
./tools/build-user-guide/build-user-guide.sh
```

Detects `kiro-cli` or `claude`, runs the orchestrator (`konductor`) against
`BUILD_USER_GUIDE_PROMPT.md`, writes the HTML, the build notes, and the hash manifest.
Options: `--runtime kiro|claude`, `--dry-run`, `--check`, `--record`.

`--record` writes the manifest for the current Markdown↔HTML pair without running an
agent. Use it after a deterministic update (`make guide` does this for you), so `--check`
has a baseline.

## Check for drift (CI)

```bash
./tools/build-user-guide/build-user-guide.sh --check
```

Pure bash, no AI runtime needed. Exits non-zero when `docs/user-guide/` has changed since the HTML
was last built, and prints the command to fix it. Gate pull requests on this.

## Pipeline example

```yaml
name: user-guide
on:
  pull_request:
    paths: ["docs/user-guide/**", "docs/site/**", "tools/build-user-guide/**"]
  push:
    branches: [main]

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Guide HTML is up to date
        run: ./tools/build-user-guide/build-user-guide.sh --check

  publish:
    if: github.ref == 'refs/heads/main'
    needs: drift
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: docs/site
      - uses: actions/deploy-pages@v4
```

To regenerate inside the pipeline instead of gating on drift, run the build step with a runtime
available and an API credential in the environment, then commit the result with a bot token — but
prefer the drift gate: an agent-authored artifact is worth a human glance before it ships.

## When the build needs a human

- A new Markdown page was added — confirm the agent placed it in the right sidebar section and
  prev/next chain.
- A Mermaid diagram changed shape — hand-built diagrams are redrawn, so look at the result.
- `USER_GUIDE_BUILD_NOTES.md` lists a content conflict — those are fixed in the Markdown, not the
  HTML.
