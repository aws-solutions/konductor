// SPDX-License-Identifier: Apache-2.0
'use strict';

// The evidence-quote rule of a report: which view of the judgments the scores read, how complete that view is, and the
// comparison with the other rule. The judgments hold both views (judge/views.js); nothing here writes a file.

const { viewJudgments, otherRule } = require('../judge/views.js');
const { RULE_TEXT } = require('../judge/quote.js');

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Points run.judgments at the `rule` view and returns what that view is made of. The stored judgments stay in
 * run.judgmentsStored, so another call with the other rule starts from the same records.
 */
function applyQuoteRule(run, tasks, rule) {
  if (run.judgmentsStored === undefined) run.judgmentsStored = run.judgments;
  const v = viewJudgments(run, rule, { tasks });
  run.judgments = v.judgments;
  const state = v.records === 0 ? 'none' : v.missing === 0 ? 'full' : v.missing === v.records && rule === 'lenient' ? 'strict-only' : 'partial';
  run.quoteView = { requested: rule, rule: v.rule, text: RULE_TEXT[v.rule], state, records: v.records, switched: v.switched, rebuilt: v.rebuilt, missing: v.missing };
  return run.quoteView;
}

const STRICT_ONLY = 'strict only: lenient view needs judge --rescore-quotes';

/** The line every report page opens with. `tail` finishes the sensitivity sentence ("see the table below", or the numbers). */
function ruleLine(quote, tail) {
  const other = otherRule(quote.requested);
  const cap = other === 'strict' ? 'Strict' : 'Lenient';
  if (quote.state === 'strict-only') return `Evidence-quote rule: ${STRICT_ONLY}. ${cap} sensitivity: not available.`;
  const lead = quote.state === 'partial'
    ? `Evidence-quote rule: ${RULE_TEXT[quote.requested]} for ${quote.records - quote.missing} of ${quote.records} rubric records; ${STRICT_ONLY} for the other ${quote.missing}.`
    : `Evidence-quote rule: ${RULE_TEXT[quote.requested]}.`;
  return `${lead} ${cap} sensitivity: ${tail}`;
}

/**
 * Default view against the other view for one run. `primary` and `secondary` are analyze() results made with the
 * default and the other rule. Per judge the downgrade rate under each rule, per arm the mean rubric and quality under each,
 * the rank order under each with flips marked, and a warning when the arm order differs.
 */
function compareViews(primary, secondary) {
  const rule = primary.quote.requested;
  const other = secondary.quote.requested;
  if (secondary.quote.state === 'strict-only' || primary.quote.state === 'strict-only') return { available: false, rule, other, reason: STRICT_ONLY };
  // Criteria and lowered criteria per judge, over the records the report uses (stale ones are already out of ctx.rubricIdx).
  const countsOf = (a) => {
    const out = {};
    for (const rec of a.ctx.rubricIdx.values()) {
      if (rec.judgeError || !rec.criteria?.length) continue;
      const c = (out[rec.judge] ??= { criteria: 0, downgraded: 0 });
      c.criteria += rec.criteria.length;
      c.downgraded += rec.criteria.filter((x) => x.evidenceDowngraded).length;
    }
    return out;
  };
  const cp = countsOf(primary);
  const cs = countsOf(secondary);
  const rate = (c) => (c && c.criteria ? c.downgraded / c.criteria : null);
  const judges = Object.keys(cp).sort().map((judge) => ({
    judge, criteria: cp[judge].criteria, downgraded: cp[judge].downgraded, rate: rate(cp[judge]), otherDowngraded: cs[judge]?.downgraded ?? null, otherRate: rate(cs[judge]),
  }));
  const armIds = Object.keys(primary.scores.arms);
  const rubricOf = (a, arm) => {
    const v = a.rows.filter((r) => r.arm === arm && fin(r.rubric)).map((r) => r.rubric);
    return v.length ? mean(v) : null;
  };
  const qualityOf = (a, arm) => a.scores.arms[arm]?.overall?.quality?.value ?? null;
  const rank = (a) => {
    const order = [...armIds].sort((x, y) => (qualityOf(a, y) ?? -Infinity) - (qualityOf(a, x) ?? -Infinity) || (x < y ? -1 : 1));
    return { order, rank: Object.fromEntries(order.map((arm, i) => [arm, i + 1])) };
  };
  const rp = rank(primary);
  const rs = rank(secondary);
  const arms = armIds.map((arm) => ({
    arm, runs: primary.scores.arms[arm]?.overall?.quality?.n ?? 0,
    rubric: rubricOf(primary, arm), otherRubric: rubricOf(secondary, arm), quality: qualityOf(primary, arm), otherQuality: qualityOf(secondary, arm),
    rank: rp.rank[arm], otherRank: rs.rank[arm], flip: rp.rank[arm] !== rs.rank[arm],
  }));
  const orderDiffers = rp.order.join('|') !== rs.order.join('|');
  return {
    available: true, rule, other, partial: secondary.quote.state === 'partial' || primary.quote.state === 'partial', judges, arms, order: rp.order, otherOrder: rs.order, orderDiffers,
    warning: orderDiffers ? `The arm order by quality differs between the rules (${rule}: ${rp.order.join(' > ')}; ${other}: ${rs.order.join(' > ')}). Read the ranking as unsettled.` : null,
  };
}

/** One quote description for several run directories read together: the worst state, record counts added. */
function mergeQuote(quotes) {
  const [first] = quotes;
  if (quotes.length === 1) return first;
  const records = quotes.reduce((n, q) => n + q.records, 0);
  const missing = quotes.reduce((n, q) => n + q.missing, 0);
  const state = records === 0 ? 'none' : missing === 0 ? 'full' : missing === records && first.requested === 'lenient' ? 'strict-only' : 'partial';
  return { ...first, state, rule: state === 'strict-only' ? 'strict' : first.requested, text: RULE_TEXT[state === 'strict-only' ? 'strict' : first.requested], records, switched: quotes.reduce((n, q) => n + q.switched, 0), rebuilt: quotes.reduce((n, q) => n + q.rebuilt, 0), missing };
}

/**
 * Platform verdict under the other rule against the one in use. `v` and `o` are buildVerdict results; arms are matched by
 * label. Each entry: both calls, the quality difference with its interval and the A/A band under the other rule, and whether
 * the call is the same.
 */
function platformSensitivity(v, o) {
  const rule = v.quote.requested;
  const other = o.quote.requested;
  if (o.quote.state === 'strict-only' || v.quote.state === 'strict-only') return { available: false, rule, other, reason: STRICT_ONLY, arms: [] };
  const callOf = (a) => (a.aaRepeatOf ? 'A/A repeat' : a.verdict);
  const arms = v.arms.map((a) => {
    const b = o.arms.find((x) => x.label === a.label);
    if (!b) return { label: a.label, call: callOf(a), otherCall: null, same: false, missing: true };
    return {
      label: a.label, call: callOf(a), otherCall: callOf(b), same: callOf(a) === callOf(b),
      delta: b.quality.delta, ciLow: b.quality.deltaCiLow, ciHigh: b.quality.deltaCiHigh, level: b.quality.level, noisePts: b.noise?.available ? b.noise.pts : null,
      baseDelta: a.quality.delta, baseCiLow: a.quality.deltaCiLow, baseCiHigh: a.quality.deltaCiHigh, reason: b.aaRepeatOf ? null : b.reason,
    };
  });
  return { available: true, rule, other, arms, anyDifferent: arms.some((a) => !a.same) };
}

/** The orchestrator pass under the other rule against the one in use; cells are matched by key and arms by label. */
function passSensitivity(v, o) {
  const rule = v.quote.requested;
  const other = o.quote.requested;
  if (o.quote.state === 'strict-only' || v.quote.state === 'strict-only') return { available: false, rule, other, reason: STRICT_ONLY, arms: [] };
  const arms = [];
  for (const c of v.cells) {
    const oc = o.cells.find((x) => x.key === c.key);
    for (const a of c.arms) {
      const b = oc?.arms.find((x) => x.label === a.label);
      const callOf = (x) => (x.aaRepeatOf ? 'A/A repeat' : x.call);
      if (!b) { arms.push({ cell: c.key, label: a.label, call: callOf(a), otherCall: null, same: false, missing: true }); continue; }
      arms.push({
        cell: c.key, label: a.label, call: callOf(a), otherCall: callOf(b), same: callOf(a) === callOf(b),
        delta: b.quality?.delta ?? null, ciLow: b.quality?.deltaCiLow ?? null, ciHigh: b.quality?.deltaCiHigh ?? null, level: b.quality?.level ?? null,
        noisePts: oc.aa?.available ? oc.aa.qualityDrift : null, reason: b.aaRepeatOf ? null : (b.reasons ?? []).join('; ') || null,
      });
    }
  }
  return { available: true, rule, other, arms, anyDifferent: arms.some((a) => !a.same) };
}

module.exports = { applyQuoteRule, ruleLine, compareViews, mergeQuote, platformSensitivity, passSensitivity, STRICT_ONLY };
