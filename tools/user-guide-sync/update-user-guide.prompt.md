<!-- SPDX-License-Identifier: Apache-2.0 -->

# Prompt: update docs/user-guide against the latest source

Paste this prompt into a Claude Code or Kiro CLI session at the repository root (or invoke it
via your agent of choice). It drives a full synchronization of `docs/user-guide/` with the
current state of the Konductor source. An engineer can also follow it by hand as a runbook.

---

You are updating `docs/user-guide/` to reflect the latest changes to the Konductor source
tree. The guide is written against the **end state** of the product, not its current
in-development state — read the ground rules below before changing anything.

## Ground rules

1. **End-state rule.** The guide deliberately describes stubbed or unimplemented features as
   working (`install`, `update`, `uninstall`, `doctor`, `synth`, `metrics` may still be
   stubs). Never "fix" the guide to say a feature is unimplemented. What must always match
   the source: **names, identifiers, counts, command surfaces, flags, config keys, exit
   codes, file paths, and the declared design intent.**
2. **Read `docs/user-guide/notes.md` first.** It is the log of every place the guide is
   intentionally ahead of the source, plus places the source lags its own docs. It tells you
   what NOT to fix backwards. Maintain it as you work: retire entries whose feature has now
   shipped (after verifying the guide's predicted output against the real implementation),
   and add entries for anything newly documented ahead of implementation.
3. **Standing decisions** (recorded in notes.md — do not relitigate without the maintainer):
   - Agent names are runtime-independent and carry no package prefix: the orchestrator is
     `konductor` on both runtimes (`kiro-cli chat --agent konductor`, `claude --agent konductor`),
     its variants are `konductor-mux-orchestrator` and `konductor-cmux-orchestrator`, and every
     specialist takes the `k-` prefix. `ASDLCCoreAICapabilities-<name>` and
     `konductor-asdlc-<name>` are half-renamed forms that `naming.py` rewrites — never
     reintroduce them.
   - `doctor` exits `1` on failed health checks; `64` is strictly for usage errors; `2` is
     forever reserved for the unresolved-CRITICAL-gate signal.
4. **Implemented behaviour wins over prediction.** Where a command actually works, output
   samples must be regenerated from **real output** (build with `cd cli/konductor-rs && cargo
   build --release`, or `cd cli && make build`), not hand-written. Where it is still a stub,
   samples stay as end-state predictions and notes.md must say so.
5. **Guide conventions:** one shell command per `bash` block; expected output in a separate
   `text` block; placeholders like `<your-project-path>`; SPDX comment as the first line of
   every file; diagram palette and node-colour semantics as defined in
   `docs/user-guide/README.md` ("Reading the diagrams").

## Step 1 — mechanical drift check

Run:

```bash
python3 tools/user-guide-sync/check-guide-facts.py
```

Fix every failure it reports (or the source, if notes.md says the guide is intentionally
ahead). Re-run until clean. This catches roster counts, catalog coverage, config keys, the
CLI command surface, and broken links — but not prose, so continue to step 2.

## Step 2 — scope what changed

Identify source changes since the guide was last synchronized:

Derive the window from git rather than from a hand-maintained date — `notes.md` records
current state only and carries no audit marker:

```bash
# when the guide last changed, then what the source did since
SINCE="$(git log -1 --format=%cd --date=short -- docs/user-guide/)"
git log --oneline --since="$SINCE" -- agents/ skills/ agent-sops/ context/ cli/
```

## Step 3 — semantic verification, per area

For each area **touched by the diff** (or all of them for a full audit), verify the guide
against its sources of truth. Do not trust the guide's own cross-references; go to the
source. If the work is large, run these as parallel review subagents — one per area — each
reporting findings as: location, guide claim, what the source says, verdict
(CHANGE / LEAVE AS-IS / JUDGMENT CALL).

| Guide area | Verify against |
| --- | --- |
| `agents.md`, roster in `reference.md` | `agents/*.agent-spec.json` (`tools`, `allowedTools`, `availableAgents`, `clientConfig.claudeCli` skills/tools, models, MCP), `context/k-orchestrator-routing-rules.md` |
| `skills.md` | the shipped set — one directory per skill under `skills/`, each with a `SKILL.md` — that file's frontmatter, and the per-agent skill declarations in the specs |
| `sop-workflows/*` | each `agent-sops/*.sop.md` — steps, parameters, defaults, gates, output paths, verdict vocabulary, which agents declare it |
| `quick-start.md`, `tasks/*`, CLI parts of `reference.md`, `troubleshooting.md` | `cli/README.md` (declared surface + conventions), both implementations (`cli/konductor-rs`, `cli/konductor` — they must agree; `cli/conformance` enforces parity), `cli/gate-config/` schemas, exact parser error messages and exit codes |
| `concepts.md`, `glossary.md`, `faq.md`, `use-cases/*`, `getting-help.md` | all of the above, plus repo governance files (`README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE.txt`) for licensing/support/privacy claims |

Checks that have caught real drift before — always include them:

- Per-agent **skill counts** in both roster tables vs `clientConfig.claudeCli.skills`, and
  the enumerated skill lists in `agents.md`'s orchestrator sections.
- Percentage/fraction phrasing derived from counts ("a third of the library").
- **Config samples**: every `config.yml` listing carries every key in
  `cli/gate-config/config.yml`, with current defaults. The `konductor config` command is
  withheld from the guide — see `WITHDRAWN_COMMANDS` in `check-guide-facts.py`.
- **Command surface**: the reference's command count and per-command flag table vs the clap
  parser in `cli/konductor-rs/src/cli.rs` — including flags the guide invents that the
  parser does not declare (a past bug: a documented `uninstall --yes` that did not exist).
- **Numbered cross-references** ("see Troubleshooting #4") vs the actual heading numbers.
- Claims of exclusivity ("the only agent that…") — verify against *all* specs, not one.
- **Permission claims.** Kiro CLI `tools` grants a tool subject to a prompt; `allowedTools`
  pre-approves it. Never read an absence from `allowedTools` as "the agent cannot do this" —
  `@builtin` grants `fs_write` and `shell` to every agent in the package. On the Claude Code
  side `clientConfig.claudeCli.tools` is the ceiling and the reader's `settings.json` decides
  what prompts, so the guide cannot state prompting behaviour as a package property.
- Output sample formatting matches the shipped Rust binary (e.g. Debug-formatted argv uses
  double quotes).

## Step 4 — verify, then report

- Re-run the step-1 script; it must exit 0.
- Confirm every internal link and anchor you touched still resolves.
- Update `docs/user-guide/notes.md`: retire shipped entries, add new forward-looking ones,
  refresh the audit date.
- Report what changed, what you left alone and why, and any judgment calls that need a
  maintainer decision — do not silently decide naming, exit-code, or scope questions; list
  them with options and a recommendation.
