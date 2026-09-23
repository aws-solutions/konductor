# SPDX-License-Identifier: Apache-2.0
from dataclasses import dataclass, replace as _dc_replace
import re


@dataclass
class WorkTypeProfile:
    """Calibrated parameters for a leverage tier."""
    name: str
    v: float        # variable/authoring fraction of the legacy estimate (0..1)
    L: float        # leverage factor: AI compression of the variable part at full capability (0..1)
    tau: float      # verification-tax uplift (>= 0)
    C: float = 1.0  # capability-maturity modifier on realized leverage (0..1)


# Calibrated default profiles per leverage tier.
TIER_PRESETS = {
    "high":   WorkTypeProfile("high",   v=0.70, L=0.75, tau=0.10, C=0.90),
    "medium": WorkTypeProfile("medium", v=0.55, L=0.50, tau=0.15, C=0.70),
    "low":    WorkTypeProfile("low",    v=0.35, L=0.30, tau=0.20, C=0.50),
}


# ---------------------------------------------------------------------------
# Tier inference — the ONLY way an item gets a tier.
# ---------------------------------------------------------------------------
# The skill takes a minimal input contract: each item is {E_legacy, description}
# with an optional per-item {C} capability-maturity override.
# A description is REQUIRED. The tier is always inferred from the description
# (keyword first; the agent escalates low-confidence items to model judgment).
# There are no explicit tiers and no v/L/tau overrides; C is the one exception.
#
# Keyword signals per tier. Weighted so a strong low/high signal outranks a
# generic medium one. Each match contributes its weight; the tier with the
# highest total wins, and confidence scales with the margin of victory.
_TIER_SIGNALS = {
    "high": [
        (r"\bcrud\b", 3), (r"\bboilerplate\b", 3), (r"\bscaffold", 3),
        (r"\bmigrat", 2), (r"\brefactor", 2), (r"\brename\b", 2),
        (r"\bformatt?ing\b", 2), (r"\blint", 2), (r"\bdocs?\b", 1),
        (r"\bdocumentation\b", 1), (r"\bunit tests?\b", 2), (r"\btest coverage\b", 2),
        (r"\bendpoint", 1), (r"\bgetter", 2), (r"\bsetter", 2), (r"\bdto\b", 2),
        (r"\bconfig(uration)?\b", 1), (r"\btemplat", 2), (r"\bcopy\b", 1),
    ],
    "medium": [
        (r"\bintegrat", 2), (r"\bapi\b", 1), (r"\bconnect", 1), (r"\bwire up\b", 2),
        (r"\bfeature\b", 1), (r"\bendpoint", 1), (r"\bvalidation\b", 1),
        (r"\bedge case", 2), (r"\bthird[- ]party\b", 2), (r"\bwebhook", 2),
        (r"\bworkflow\b", 1), (r"\bhandler\b", 1),
    ],
    "low": [
        (r"\barchitect", 3), (r"\bdesign\b", 2), (r"\bnovel\b", 3),
        (r"\bsecurity\b", 3), (r"\bauth(entication|orization)?\b", 2),
        (r"\bencrypt", 3), (r"\bcryptograph", 3), (r"\bfailover\b", 3),
        (r"\bmulti[- ]region\b", 3), (r"\bdistributed\b", 2), (r"\bconsensus\b", 3),
        (r"\bcross[- ]system\b", 3), (r"\bmigration strategy\b", 2),
        (r"\bcompliance\b", 2), (r"\bthreat model", 3), (r"\bblast radius\b", 3),
        (r"\bproof of concept\b", 2), (r"\bresearch\b", 2), (r"\bprototype\b", 1),
    ],
}

# Below this keyword confidence, escalate the item to model judgment
# (performed by the agent at runtime via the prepare -> classify -> finalize seam).
LLM_ESCALATION_THRESHOLD = 0.55


def infer_tier(description):
    """Infer a leverage tier from a task description using keyword signals.

    Returns (tier, confidence, rationale):
        tier: 'high' | 'medium' | 'low'  (defaults to 'medium' when no signal)
        confidence: float 0..1 — margin-based; low when signals are weak/mixed
        rationale: short human-readable string of the matched signals
    """
    text = str(description).lower()
    scores = {"high": 0, "medium": 0, "low": 0}
    matched = {"high": [], "medium": [], "low": []}
    for tier, signals in _TIER_SIGNALS.items():
        for pattern, weight in signals:
            m = re.search(pattern, text)
            if m:
                scores[tier] += weight
                matched[tier].append(m.group(0).strip())

    total = sum(scores.values())
    if total == 0:
        return "medium", 0.0, "no tiering keywords found"

    winner = max(scores, key=scores.get)
    top = scores[winner]
    runner_up = sorted(scores.values(), reverse=True)[1]
    share = top / total
    margin = (top - runner_up) / top if top else 0.0
    # Fold in the absolute score so a lone weak match (e.g. a single weight-1 keyword
    # like "api") reads as low confidence and falls below LLM_ESCALATION_THRESHOLD
    # (0.55), triggering model judgment instead of locking in the tightest band.
    # The absolute score saturates at 3 (one strong keyword or several weak ones); below
    # that it scales linearly.  share and margin are secondary: they distinguish a
    # contested win from a clean sweep, but only after the absolute score has earned
    # the baseline.  A lone weight-1 match (top=1) → conf ≈ 0.33; a weight-2 match
    # (top=2) → conf ≈ 0.67; a weight-3+ clean sweep → conf up to 1.0.
    abs_saturation = min(1.0, top / 3.0)
    confidence = round(abs_saturation * min(1.0, 0.55 + 0.30 * share + 0.15 * margin), 2)

    kws = ", ".join(dict.fromkeys(matched[winner]))  # dedupe, preserve order
    rationale = f"matched {winner} signals: {kws}" if kws else f"weak {winner} signal"
    return winner, confidence, rationale


def profile_for(tier):
    """Return the calibrated WorkTypeProfile for a tier (high/medium/low)."""
    return TIER_PRESETS.get(tier, TIER_PRESETS["medium"])


def convert(E_legacy, p, band=0.15):
    """Convert a legacy all-human estimate to an agentic (low, mid, high) band.

    Formula: E = E_legacy * [(1 - v) + v * (1 - L*C)] * (1 + tau)
    The band flexes L and tau to favorable/unfavorable corners to reflect
    higher oversight variance in agentic work. A larger `band` widens the range.
    """
    def point(L, tau):
        L_eff = L * p.C
        return E_legacy * ((1 - p.v) + p.v * (1 - L_eff)) * (1 + tau)

    mid = point(p.L, p.tau)
    low = point(min(p.L * (1 + band), 1.0), max(p.tau * (1 - band), 0.0))   # best case
    high = point(max(p.L * (1 - band), 0.0), p.tau * (1 + band))            # worst case
    return round(low, 1), round(mid, 1), round(high, 1)


# Band widening: low-confidence inferred tiers carry more uncertainty, so we
# widen their low/high range as confidence drops.
_BASE_BAND = 0.15
_MAX_BAND = 0.45


def band_for(confidence):
    """Return the low/high band width from the inference confidence.

    conf 1.0 -> base band (±15%); conf 0.0 -> max band (±45%).
    """
    return round(_BASE_BAND + (_MAX_BAND - _BASE_BAND) * (1.0 - float(confidence)), 3)


class MissingDescriptionError(ValueError):
    """Raised when an item has no description. Description is required."""


class InvalidELegacyError(ValueError):
    """Raised when an item's E_legacy is missing or non-numeric."""


def _require_description(item, index=None):
    desc = item.get("description")
    if desc is None or not str(desc).strip():
        where = f" (item index {index})" if index is not None else ""
        raise MissingDescriptionError(
            f"Every item must include a non-empty 'description'{where}. "
            "The tier is inferred from it; there is no explicit-tier or default fallback."
        )
    return str(desc).strip()


def _require_e_legacy(item, index=None):
    """Validate that E_legacy is present and numeric; return it as a float.

    Mirrors _require_description: raises InvalidELegacyError with a user-facing
    message rather than a raw KeyError/ValueError, so the agent can surface a
    friendly 'please clarify that row' message instead of a stack trace.
    """
    where = f" (item index {index})" if index is not None else ""
    if "E_legacy" not in item:
        raise InvalidELegacyError(
            f"Every item must include an 'E_legacy' value{where}. "
            "Please clarify that row by providing a numeric legacy estimate."
        )
    raw = item["E_legacy"]
    try:
        value = float(raw)
    except (ValueError, TypeError):
        raise InvalidELegacyError(
            f"'E_legacy' must be a number, got {raw!r}{where}. "
            "Please clarify that row by providing a numeric legacy estimate."
        )
    return value


def resolve_item_tier(item, index=None, llm_threshold=LLM_ESCALATION_THRESHOLD):
    """Resolve a single item's tier from its (required) description, keyword-only.

    Returns a resolution dict. If keyword confidence is below `llm_threshold`,
    `needs_llm` is True so the agent can upgrade it with model judgment via the
    prepare -> classify -> finalize seam.
    """
    desc = _require_description(item, index)
    tier, confidence, rationale = infer_tier(desc)
    return {
        "tier": tier, "tier_source": "inferred-kw", "confidence": confidence,
        "rationale": rationale, "needs_llm": confidence < llm_threshold,
        "description": desc,
    }


def apply_llm_classification(resolution, tier, confidence, rationale):
    """Merge a model-provided classification into a resolution dict.

    The agent calls this (via finalize_batch) for each item flagged needs_llm,
    passing the tier it judged from the description. tier_source -> 'inferred-llm'.
    """
    resolved = tier if tier in TIER_PRESETS else "medium"
    resolution = dict(resolution)
    resolution.update({
        "tier": resolved,
        "tier_source": "inferred-llm",
        "confidence": round(float(confidence), 2),
        "rationale": f"LLM: {rationale}",
        "needs_llm": False,
    })
    return resolution


def _row_from_resolution(item, res, index=None):
    """Compute a converted row from an item + a resolved tier dict.

    Accepts an optional per-item 'C' override (capability-maturity modifier).
    When present it replaces the tier preset's default C; v, L, and tau still
    come from the tier.  Validates the override is in range (0 < C <= 1).
    """
    E = _require_e_legacy(item, index)
    label = str(item.get("description", ""))[:60]
    band = band_for(res["confidence"])
    p = profile_for(res["tier"])
    # Per-item C override: caller may supply {"C": <float>} alongside E_legacy and
    # description.  The tier still drives v/L/tau; only C is overridden.
    if "C" in item:
        raw_c = item["C"]
        try:
            c_val = float(raw_c)
        except (ValueError, TypeError):
            raise InvalidELegacyError(
                f"'C' override must be a number in (0, 1], got {raw_c!r}"
                + (f" (item index {index})" if index is not None else "") + "."
                " Please supply a decimal between 0 (exclusive) and 1 (inclusive)."
            )
        if not (0 < c_val <= 1.0):
            raise InvalidELegacyError(
                f"'C' override must be in (0, 1], got {c_val}"
                + (f" (item index {index})" if index is not None else "") + "."
                " Please supply a decimal between 0 (exclusive) and 1 (inclusive)."
            )
        # Build a modified profile with the overridden C; keep all other params.
        p = _dc_replace(p, C=c_val)
    low, mid, high = convert(E, p, band=band)
    delta = round((mid / E - 1.0) * 100, 0) if E else 0.0
    return {
        "label": label, "E_legacy": E, "tier": res["tier"],
        "tier_source": res["tier_source"], "confidence": res["confidence"],
        "rationale": res["rationale"], "band": band,
        "low": low, "mid": mid, "high": high, "delta_pct": delta,
    }


def convert_batch(items):
    """Convert a list of {E_legacy, description} items — keyword-only path.

    A description is REQUIRED on every item (raises MissingDescriptionError).
    For the hybrid path with model escalation, use
    prepare_batch() -> (agent classifies) -> finalize_batch().
    Returns (rows, totals).
    """
    resolutions = [resolve_item_tier(it, i) for i, it in enumerate(items)]
    return _finalize(items, resolutions)


def prepare_batch(items, llm_threshold=LLM_ESCALATION_THRESHOLD):
    """Hybrid path — Phase 1 (deterministic).

    Validate descriptions, resolve every item's tier by keyword, and return:
        resolutions: list of per-item resolution dicts (aligned with items)
        needs_llm:   list of {index, description, kw_tier, kw_confidence} for
                     items whose keyword confidence fell below threshold.

    Raises MissingDescriptionError if any item lacks a description.
    """
    resolutions = [resolve_item_tier(it, i, llm_threshold) for i, it in enumerate(items)]
    needs_llm = []
    for i, res in enumerate(resolutions):
        if res.get("needs_llm"):
            needs_llm.append({
                "index": i,
                "description": res.get("description", ""),
                "kw_tier": res["tier"],
                "kw_confidence": res["confidence"],
            })
    return resolutions, needs_llm


def finalize_batch(items, resolutions, llm_results=None):
    """Hybrid path — Phase 2 (deterministic).

    llm_results: optional list of {index, tier, confidence, rationale} produced
    by the agent for items flagged in prepare_batch(). Merged over the keyword
    resolutions, then the batch is converted. Returns (rows, totals).
    """
    resolutions = [dict(r) for r in resolutions]
    for r in (llm_results or []):
        i = r["index"]
        resolutions[i] = apply_llm_classification(
            resolutions[i], r["tier"], r.get("confidence", 0.7), r.get("rationale", "")
        )
    return _finalize(items, resolutions)


def _finalize(items, resolutions):
    rows = []
    t_leg = t_low = t_mid = t_high = 0.0
    for i, (it, res) in enumerate(zip(items, resolutions)):
        row = _row_from_resolution(it, res, index=i)
        rows.append(row)
        t_leg += row["E_legacy"]; t_low += row["low"]; t_mid += row["mid"]; t_high += row["high"]
    totals = {
        "E_legacy": round(t_leg, 1), "low": round(t_low, 1),
        "mid": round(t_mid, 1), "high": round(t_high, 1),
        "delta_pct": round((t_mid / t_leg - 1.0) * 100, 0) if t_leg else 0.0,
    }
    return rows, totals


TIER_EMOJI = {"high": "\U0001F7E2 high", "medium": "\U0001F7E1 medium", "low": "\U0001F534 low"}


def _source_label(r):
    src = r.get("tier_source", "inferred-kw")
    if src == "inferred-llm":
        return f"inferred·llm ({r.get('confidence', 0):.0%})"
    return f"inferred·kw ({r.get('confidence', 0):.0%})"


def render_markdown(rows, totals, show_source=True):
    """Render conversion results as a Markdown table with a totals row.

    The 'Tier source' column shows whether each tier was inferred by keyword
    (inferred·kw) or by model fallback (inferred·llm), with the confidence.
    """
    if show_source:
        header = "| Item | Legacy | Tier | Tier source | Low | Mid | High | Δ (mid) |"
        sep = "|---|---|---|---|---|---|---|---|"
    else:
        header = "| Item | Legacy | Tier | Low | Mid | High | Δ (mid) |"
        sep = "|---|---|---|---|---|---|---|"
    lines = [header, sep]

    for r in rows:
        if show_source:
            lines.append(
                f"| {r['label']} | {r['E_legacy']:g} | {TIER_EMOJI[r['tier']]} | {_source_label(r)} | "
                f"{r['low']:g} | {r['mid']:g} | {r['high']:g} | {r['delta_pct']:+.0f}% |"
            )
        else:
            lines.append(
                f"| {r['label']} | {r['E_legacy']:g} | {TIER_EMOJI[r['tier']]} | "
                f"{r['low']:g} | {r['mid']:g} | {r['high']:g} | {r['delta_pct']:+.0f}% |"
            )

    if show_source:
        lines.append(
            f"| **Total** | **{totals['E_legacy']:g}** | | | "
            f"**{totals['low']:g}** | **{totals['mid']:g}** | **{totals['high']:g}** | "
            f"**{totals['delta_pct']:+.0f}%** |"
        )
    else:
        lines.append(
            f"| **Total** | **{totals['E_legacy']:g}** | | "
            f"**{totals['low']:g}** | **{totals['mid']:g}** | **{totals['high']:g}** | "
            f"**{totals['delta_pct']:+.0f}%** |"
        )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Command-line interface
# ---------------------------------------------------------------------------
# The library above is pure, deterministic, and stdlib-only so it can run in a
# sandboxed environment with no network/LLM access. This CLI lets an agent drive
# it from the Bash tool. The model tier judgment for `needs_llm` items happens in
# the AGENT, between `prepare` and `finalize` (the prepare -> classify -> finalize
# seam) — the script never calls a model.
#
#   convert   keyword-only path: convert_batch -> render_markdown (Markdown table)
#   prepare   deterministic Phase 1: print JSON {resolutions, needs_llm}
#   finalize  Phase 2: merge agent llm-results -> finalize_batch -> Markdown table

def _load_items(raw):
    """Parse a JSON array of items from a string, validating shape."""
    import json
    if raw is None:
        raise MissingDescriptionError(
            "No items provided. Pass --items '<json array>' or pipe JSON on stdin."
        )
    try:
        items = json.loads(raw)
    except (ValueError, TypeError) as exc:
        raise SystemExit(f"error: --items is not valid JSON: {exc}")
    if not isinstance(items, list) or not items:
        raise SystemExit("error: items must be a non-empty JSON array.")
    for i, it in enumerate(items):
        if not isinstance(it, dict):
            raise SystemExit(f"error: item index {i} must be a JSON object.")
        # E_legacy and description are both enforced downstream via their respective
        # error classes so the messages stay consistent with the library contract.
    return items


def _read_source(items_arg):
    """Return the raw JSON string from --items or stdin."""
    import sys
    if items_arg is not None:
        return items_arg
    if not sys.stdin.isatty():
        data = sys.stdin.read().strip()
        if data:
            return data
    return None


def _load_json_arg(raw, name, allow_null=False):
    import json
    if raw is None:
        if allow_null:
            return None
        raise SystemExit(f"error: --{name} is required.")
    try:
        value = json.loads(raw)
    except (ValueError, TypeError) as exc:
        raise SystemExit(f"error: --{name} is not valid JSON: {exc}")
    if value is None and not allow_null:
        raise SystemExit(f"error: --{name} must not be null.")
    return value


def _cmd_convert(args):
    items = _load_items(_read_source(args.items))
    rows, totals = convert_batch(items)
    print(render_markdown(rows, totals, show_source=True))


def _cmd_prepare(args):
    import json
    items = _load_items(_read_source(args.items))
    resolutions, needs_llm = prepare_batch(items)
    print(json.dumps({"resolutions": resolutions, "needs_llm": needs_llm}, indent=2))


def _cmd_finalize(args):
    items = _load_items(_read_source(args.items))
    resolutions = _load_json_arg(args.resolutions, "resolutions")
    if not isinstance(resolutions, list):
        raise SystemExit("error: --resolutions must be a JSON array.")
    llm_results = _load_json_arg(args.llm_results, "llm-results", allow_null=True)
    if llm_results is not None and not isinstance(llm_results, list):
        raise SystemExit("error: --llm-results must be a JSON array or null.")
    rows, totals = finalize_batch(items, resolutions, llm_results)
    print(render_markdown(rows, totals, show_source=True))


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(
        prog="convert_estimates.py",
        description="Convert legacy all-human effort estimates into banded agentic estimates.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_convert = sub.add_parser(
        "convert", help="Keyword-only path: convert_batch -> render_markdown (Markdown table)."
    )
    p_convert.add_argument("--items", help="JSON array of {E_legacy, description} items. Reads stdin if omitted.")
    p_convert.set_defaults(func=_cmd_convert)

    p_prepare = sub.add_parser(
        "prepare", help="Deterministic Phase 1: print JSON {resolutions, needs_llm}."
    )
    p_prepare.add_argument("--items", help="JSON array of {E_legacy, description} items. Reads stdin if omitted.")
    p_prepare.set_defaults(func=_cmd_prepare)

    p_finalize = sub.add_parser(
        "finalize", help="Phase 2: merge agent llm-results -> finalize_batch -> Markdown table."
    )
    p_finalize.add_argument("--items", help="JSON array of {E_legacy, description} items. Reads stdin if omitted.")
    p_finalize.add_argument("--resolutions", required=True, help="JSON array of resolution dicts from `prepare`.")
    p_finalize.add_argument("--llm-results", dest="llm_results",
                            help="JSON array of {index, tier, confidence, rationale} from the agent, or null.")
    p_finalize.set_defaults(func=_cmd_finalize)

    args = parser.parse_args(argv)
    try:
        args.func(args)
    except (MissingDescriptionError, InvalidELegacyError) as exc:
        raise SystemExit(f"error: {exc}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
