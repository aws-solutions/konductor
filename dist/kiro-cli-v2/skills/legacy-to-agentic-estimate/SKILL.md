---
name: legacy-to-agentic-estimate
description: Convert legacy all-human-coding effort estimates into agentic SDLC estimates that account for AI toolchains and agents. Use to convert legacy estimate(s), produce an agentic estimate, re-baseline LOE for AI, build an AI-assisted estimate, or do effort estimation from a legacy value plus a task description (single item or a batch/table). The tier is always inferred from the description (keyword first, model fallback for ambiguous cases); output is a banded low/mid/high Markdown table with a roll-up.
version: 1.0.0
tags: [skill, estimation, agentic-sdlc, loe, re-baseline, planning]
---

# Legacy → Agentic Estimate Converter

## Overview

This skill converts effort estimates produced under the legacy assumption that
**all code is authored and verified by a human** into estimates that reflect
developers working with **AI toolchains and agents in an agentic SDLC**. It
works on a single estimate or a batch. Each item is just a **legacy value plus a
task description**; the skill infers everything else and returns **banded
(low/mid/high)** agentic estimates plus a roll-up and delta vs. legacy.

Use it to re-baseline an existing backlog without re-estimating every item by
hand.

> **The most important output is not the converted number** — it is that
> **capability maturity is the dominant lever**. Every mature, evaluator-backed
> capability you ship raises realized leverage (`L_eff`) and lowers the
> verification tax (`τ`). Treat this skill as a **transitional tool**, not an
> oracle: its credibility rests entirely on parameters measured from your own
> history.

## Input contract

The input is deliberately minimal. Every item is `{ E_legacy, description }`:

- **`E_legacy`** — the legacy all-human estimate (required, numeric). A missing or
  non-numeric value is a **validation error** (`InvalidELegacyError`) — the agent will
  ask the user to clarify that row rather than failing with a stack trace.
- **`description`** — a task description (**required**). The tier is derived from it.
  A missing or empty description is a **validation error** (`MissingDescriptionError`),
  not a silent default.
- **`C`** — capability-maturity modifier (**optional**, decimal in `(0, 1]`). When
  supplied, it overrides the tier preset's default `C` for that item. Use this to
  express "high-leverage work, but no mature packaged capability yet" — the tier still
  infers `v`, `L`, and `τ`; only `C` is overridden. Values outside `(0, 1]` are a
  validation error with a friendly message.

There is no way to pass an explicit tier or to override `v/L/τ` — tiering stays
honest and inferred from the description. An item with no description or a bad
`E_legacy` value raises a clean error rather than silently defaulting.

Items are passed to the bundled script as a JSON array, e.g.
`[{"E_legacy": 24, "description": "Add CRUD endpoints for the settings API"}]`.

Per-item `C` override example (high-leverage work, immature capability):
`[{"E_legacy": 40, "description": "Add CRUD endpoints", "C": 0.20}]`

## Core method

A legacy estimate bundles two kinds of work that AI affects very differently. The
conversion **unbundles** them and compresses only the AI-amenable part. The key
intermediate is **`L_eff = L × C`** — leverage is realized only to the degree a
mature, evaluator-backed capability actually exists:

```
E_agentic = E_legacy × [ (1 − v) + v × (1 − L_eff) ] × (1 + τ)     where  L_eff = L × C
```

| Symbol  | Meaning                                                                  | Typical range | Source                                            |
| ------- | ------------------------------------------------------------------------ | ------------- | ------------------------------------------------- |
| `v`     | variable/authoring fraction of the legacy estimate (compressible)        | 0.40–0.75     | measured from work-type history                   |
| `L`     | leverage factor — AI compression of the variable part at full capability | 0.30–0.80     | measured from cycle-time telemetry                |
| `C`     | capability-maturity modifier — how much of `L` is actually realized      | 0.20–1.0      | maturity of the packaged capability               |
| `τ`     | verification-tax uplift — added review/validation overhead               | 0.05–0.25     | measured; shrinks as evaluators mature            |
| `L_eff` | effective leverage = `L × C`                                             | derived       | realized leverage given the capability's maturity |

### Agent-variable vs. agent-invariant work

The `v` fraction is the work AI actually compresses; the rest does not shrink.

- **Agent-variable (compressible):** authoring, boilerplate, scaffolding,
  test-writing, docs.
- **Agent-invariant (does NOT shrink):** requirements, review, integration,
  verification, security judgment, stakeholder alignment.

Never apply the AI speedup to the invariant fraction — that is what `(1 − v)`
protects.

**Tier presets** (the profile applied once a tier is inferred):

| Tier      | v    | L    | τ    | C    | Character                                                                                |
| --------- | ---- | ---- | ---- | ---- | ---------------------------------------------------------------------------------------- |
| 🟢 high   | 0.70 | 0.75 | 0.10 | 0.90 | undifferentiated/patterned authoring: CRUD, boilerplate, scaffolding, migration          |
| 🟡 medium | 0.55 | 0.50 | 0.15 | 0.70 | clear intent, novel integration: integration, API, webhook                               |
| 🔴 low    | 0.35 | 0.30 | 0.20 | 0.50 | novel architecture / security / failover; high blast radius, little compressible content |

The output is always a **range**, not a point — agentic work has higher oversight
variance. The bundled `convert_estimates.py` script implements all of this.

## Tier resolution (always inferred from the description)

Every item's tier comes from its description via a **hybrid, two-stage
classifier**. There is no explicit-tier or assumed fallback path.

1. **Inferred (keyword)** — the script classifies from weighted keyword signals
   (CRUD/boilerplate/migration/refactor → high; integration/API/webhook →
   medium; architecture/security/failover/novel → low), producing a tier +
   confidence + rationale. `tier_source = inferred-kw`.
2. **Inferred (model fallback)** — when keyword confidence is **below
   `LLM_ESCALATION_THRESHOLD` (0.55)**, the **agent** reads the description and
   classifies it against the tier definitions with judgment. `tier_source =
inferred-llm`. This handles vocabulary the keyword list doesn't cover, or
   mixed-signal descriptions.

**Confidence controls the band.** Low-confidence classifications carry more
uncertainty, so the band **parameter** widens as confidence drops (from ±15%
`_BASE_BAND` at full confidence up to ±45% `_MAX_BAND` at zero confidence —
these values perturb the formula inputs to compute the low/high corners; the
realized output spread is narrower for low-leverage items and can be well below
±15% even at base confidence).
Surface the guess, never hide it.

**Why the model step lives in the agent, not the script:** the bundled script is
**deterministic and sandboxed (stdlib only, no network/LLM access)**. It exposes
a **seam** — `prepare_batch` flags low-confidence items, the **agent** classifies
them, and `finalize_batch` merges the results. Deterministic math in the script;
semantic judgment from the model; a clean handoff between them.

> **Why this matters:** never silently convert a backlog at one blanket tier —
> that collapses into the "single AI discount %" anti-pattern. Inference +
> confidence + band-widening surfaces the guess instead of hiding it.

## Workflow

The agent drives the bundled script with the **Bash tool** and `python3`,
resolving the script path at runtime (repo root or installed location). Every
command block below is one that was run against this script.

### Step 1 — Parse the input estimates

- Normalize the input into a JSON array of items, each `{ E_legacy (numeric),
description (non-empty) }`. A single estimate is a one-item batch.
- Validate that every item has BOTH a numeric legacy value AND a description.
- **On failure:** if any item lacks a description, ask the user to supply one for
  that item — do not guess or default it. If a value is non-numeric, ask the user
  to clarify that row.

### Step 2 — Resolve tiers (keyword) and find escalations

Run the deterministic Phase-1 seam. It validates descriptions, resolves each
item's tier by keyword, and reports which items need model judgment.

```bash
SCRIPT="$(git rev-parse --show-toplevel 2>/dev/null)/skills/legacy-to-agentic-estimate/scripts/convert_estimates.py"
[ -f "$SCRIPT" ] || SCRIPT="${SKILLS_HOME:-$HOME/.konductor/skills}/legacy-to-agentic-estimate/scripts/convert_estimates.py"
python3 "$SCRIPT" \
  prepare --items '[{"E_legacy":30,"description":"Revamp the onboarding flow"}]'
```

- **Output:** JSON `{ resolutions, needs_llm }`. `resolutions` are the per-item
  keyword resolution dicts; `needs_llm` lists `{index, description, kw_tier,
kw_confidence}` for items whose keyword confidence fell below 0.55.
- A `MissingDescriptionError` (non-zero exit) means Step 1 let an item through
  without a description — go back and fix it.

### Step 3 — Classify escalated items (model judgment)

For each entry in `needs_llm`, the **agent** (not the script) reads the
`description` and decides `tier` (high/medium/low), a `confidence` (0–1), and a
one-line `rationale` grounded in the tier definitions: high = undifferentiated /
patterned authoring; medium = clear intent, novel integration; low = novel
architecture, security, cross-system, high blast radius.

- Produce `llm_results`: a list of `{index, tier, confidence, rationale}`, one per
  `needs_llm` entry.
- If a description is genuinely too vague, assign `medium` at a deliberately low
  confidence so the band widens.
- **Skip when** `needs_llm` is empty — go straight to Step 4 (or use the
  keyword-only shortcut in the note below).

### Step 4 — Finalize the conversion

Merge the agent's judgment back in and compute the bands.

```bash
SCRIPT="$(git rev-parse --show-toplevel 2>/dev/null)/skills/legacy-to-agentic-estimate/scripts/convert_estimates.py"
[ -f "$SCRIPT" ] || SCRIPT="${SKILLS_HOME:-$HOME/.konductor/skills}/legacy-to-agentic-estimate/scripts/convert_estimates.py"
python3 "$SCRIPT" \
  finalize \
  --items '[{"E_legacy":30,"description":"Revamp the onboarding flow"}]' \
  --resolutions '[{"tier":"medium","tier_source":"inferred-kw","confidence":0.0,"rationale":"no tiering keywords found","needs_llm":true,"description":"Revamp the onboarding flow"}]' \
  --llm-results '[{"index":0,"tier":"medium","confidence":0.6,"rationale":"clear intent, UI rework over existing flow"}]'
```

Pass `--llm-results null` (or `[]`) when Step 3 was skipped. `--resolutions` is the
array printed by `prepare`.

- **Validate:** all outputs positive; low ≤ mid ≤ high; low-leverage items may
  exceed the legacy value (expected — not an error).
- **Note:** for a keyword-only run with no escalations, `convert` does Steps 2 + 4
  in one call (it wraps `convert_batch` → `render_markdown`):

```bash
SCRIPT="$(git rev-parse --show-toplevel 2>/dev/null)/skills/legacy-to-agentic-estimate/scripts/convert_estimates.py"
[ -f "$SCRIPT" ] || SCRIPT="${SKILLS_HOME:-$HOME/.konductor/skills}/legacy-to-agentic-estimate/scripts/convert_estimates.py"
python3 "$SCRIPT" \
  convert --items '[{"E_legacy":24,"description":"Add CRUD endpoints and DTOs for the settings API"},{"E_legacy":60,"description":"Design multi-region failover architecture for the datastore"}]'
```

### Step 5 — Render the output

The `convert` and `finalize` subcommands already print the Markdown table
(`render_markdown` with `show_source=True`, so the "Tier source" column shows
kw vs. llm and the confidence). Present that table plus a totals row. Markdown is
the only output — there is no Excel/workbook path.

### Step 6 — Explain and caveat

Add a brief interpretation calling out:

- (a) savings concentrate in **high-leverage** work backed by a **mature
  capability**;
- (b) **low-leverage items can cost more** — a novel/security task costing more is
  a correct result, not an error;
- (c) which tiers were **escalated to model judgment** (`inferred-llm`) and should
  be reviewed;
- (d) that `L`, `τ`, `v`, and `C` **must be recalibrated from the team's own
  telemetry** to be credible.

Always include the measured-vs-assumed caveat; always flag escalated rows.

## Worked examples

All four are a **40-unit** task, showing how the same legacy number diverges by
tier — and, in the fourth case, purely by capability maturity.

| Scenario                                     | v / L / τ / C             | Low / Mid / High   | Δ (mid)                                          |
| -------------------------------------------- | ------------------------- | ------------------ | ------------------------------------------------ |
| high + mature capability                     | 0.70 / 0.75 / 0.10 / 0.90 | 19.8 / 23.2 / 26.7 | −42%                                             |
| medium / novel integration                   | 0.55 / 0.50 / 0.15 / 0.70 | 35.1 / 37.1 / 39.2 | −7%                                              |
| low / novel arch + security                  | 0.35 / 0.30 / 0.20 / 0.50 | 44.0 / 45.5 / 47.0 | **+14%** (low-leverage costs MORE)               |
| **high tier but NO packaged capability yet** | 0.70 / 0.75 / 0.10 / 0.20 | 38.2 / 39.4 / 40.6 | **−2%** (C dropped 0.90 → 0.20; τ stays at 0.10) |

The fourth case is the headline: the **same high-tier task** swings from −42% to
**−2%** purely by dropping `C` from 0.90 to 0.20, with τ held constant at the
tier default. A ~40-point swing in the delta, driven entirely by capability
maturity. **Capability maturity dominates.**

> **Note:** the methodology's fully-unpackaged scenario additionally recalibrates
> the verification tax τ at the tier level (0.10→0.15), which is what pushes a
> fully-unpackaged high-leverage task into net-penalty territory. τ is a
> tier-level calibration, not a per-item input, so the per-item `C` override alone
> does not cross into penalty territory — it collapses the savings without
> reversing them.

## Output

A Markdown table of converted estimates (the "Tier source" column shows how each
tier was reached), with a totals roll-up row:

| Item                                | Legacy | Tier    | Tier source        | Low  | Mid  | High | Δ (mid) |
| ----------------------------------- | ------ | ------- | ------------------ | ---- | ---- | ---- | ------- |
| Add CRUD endpoints for settings API | 24     | 🟢 high | inferred·kw (82%)  | 11.2 | 13.9 | 16.8 | −42%    |
| Design multi-region failover arch.  | 60     | 🔴 low  | inferred·kw (100%) | 66   | 68.2 | 70.5 | +14%    |
| **Total**                           | **84** |         |                    | …    | …    | …    | …       |

Plus a short interpretation and the recalibration caveat.

## Operationalization lifecycle

Treat the presets as a starting point and calibrate against reality:

1. **Seed conservative** — start with the default presets (lower `C`, higher `τ`)
   until you have data.
2. **Feed** `{legacy, description}` items for the work you are re-baselining.
3. **Convert** through the prepare → classify → finalize seam.
4. **Track** actual effort vs. predicted per item.
5. **Recalibrate** `v` / `L` / `τ` / `C` per work-type from your own cycle-time
   telemetry.
6. **Repeat** — the estimates get more credible as the parameters converge on your
   history.

## Guardrails

- **Weight the tail.** Agents accelerate the first ~90%; the last 10%
  (integration, edge cases, prod-hardening) can grow. That growth lives in `τ` —
  don't zero it out.
- **Account for skill dispersion.** Realized leverage depends on how well a
  developer drives the agent; expect per-developer variance. The band reflects
  oversight variance, not a promise.

## Lessons Learned

### Do

- Keep the input **minimal**: a legacy value and a description per item. The
  description is required — the whole method hinges on inferring the tier from it.
- Use the **hybrid classifier**: keyword first (fast, deterministic), model
  fallback only for low-confidence items. Don't spend model judgment when the
  keyword signal is already strong.
- **Surface the guess** — always show tier source (kw/llm) and confidence, and
  widen the band when confidence is low.
- Always emit a **band** (low/mid/high), never a single number.
- Treat **capability maturity (`C`)** as the dominant lever — the same task swings
  from big savings (−42%) to **nearly break-even (−2%)** purely by dropping `C`,
  with τ still held at the tier default.
- Always include the caveat that `L`, `τ`, `v`, and `C` must be **measured from
  your own cycle-time telemetry** to be credible.

### Don't

- Don't accept an item with no description — raise/ask rather than defaulting a
  tier.
- Don't collapse the method into a single "AI discount %" — it discards the
  tiering that keeps it honest.
- Don't run the model classifier inside the sandboxed script — it has no network
  access. Use the prepare → classify → finalize seam.
- Don't apply the AI speedup to the invariant fraction (review, integration,
  security) — it doesn't shrink.
- Don't present low-leverage increases as errors — a novel/security task costing
  more is a correct result.
- Don't treat the output as an oracle — its credibility rests entirely on
  parameters measured from your own history.

### Common Failures

- **Item missing a description** → `MissingDescriptionError` (non-zero exit); go
  back to Step 1 and ask the user for the description.
- **Ambiguous description, no keyword hit** → `prepare` flags it in `needs_llm`;
  classify it in Step 3. If skipped, it stays medium at a wide band (safe, just
  less precise).
- **Non-numeric legacy value** → ask the user to clarify only that row.
- **Malformed JSON in `--items`** → the CLI exits non-zero with a parse error;
  re-check the array shape and quoting.

### When to Ask the User

- When an item arrives with no description — always ask; never default.
- When many items land as `inferred-llm` at low confidence — offer to have the
  user confirm tiers before trusting the roll-up.
