// SPDX-License-Identifier: Apache-2.0
'use strict';

// The two evidence-quote views of a rubric verdict. `judge` records both for every criterion, so a report shows either
// rule without a rescoring pass: verdictStrict / verdictLenient with quoteFound per rule. The fields every older reader
// knows (verdict, verdictScored, evidenceFound, evidenceDowngraded, and the record's score) hold the verdict under the
// rule the judge ran with (the default is lenient, tightened). A record from before the dual view has only the strict
// verdicts in those fields; its lenient view is rebuilt from the saved output when the bundle can be rebuilt.

const { DOWNGRADE, rubricScore } = require('./score.js');
const { makeQuoteMatcher, DEFAULT_QUOTE_RULE, QUOTE_RULES } = require('./quote.js');

const NO_EVIDENCE = /^\(nothing in the output\)/i;

const otherRule = (rule) => (rule === 'strict' ? 'lenient' : 'strict');

function checkRule(rule, flag = '--quote-match') {
  if (!QUOTE_RULES.includes(rule)) throw new Error(`${flag} takes ${QUOTE_RULES.join(' or ')} (got ${JSON.stringify(rule)})`);
  return rule;
}

/** quote => boolean for each rule, over one bundle text. */
function matchersFor(text) {
  return { strict: makeQuoteMatcher(text, { lenient: false }), lenient: makeQuoteMatcher(text, { lenient: true }) };
}

/**
 * Criteria of one reply with both views. `replyCriteria`: [{ id, verdict (the judge's own), evidence }].
 * The fields older readers use carry the `rule` view.
 */
function dualCriteria(replyCriteria, matchers, rule = DEFAULT_QUOTE_RULE) {
  return replyCriteria.map((c) => {
    const raw = c.verdictRaw ?? c.verdict;
    const evidence = c.evidence ?? '';
    // "(nothing in the output)" cites no evidence, so a pass or partial that rests on it drops a level under either rule.
    const none = NO_EVIDENCE.test(evidence);
    const quoteFound = { strict: none ? false : matchers.strict(evidence), lenient: none ? false : matchers.lenient(evidence) };
    const verdictOf = (r) => (quoteFound[r] === false && raw !== 'fail' ? DOWNGRADE[raw] : raw);
    const verdictScored = verdictOf(rule);
    const downgraded = quoteFound[rule] === false && raw !== 'fail';
    return {
      id: c.id, verdict: verdictScored, verdictRaw: raw, verdictScored, evidence, evidenceFound: quoteFound[rule], ...(downgraded ? { evidenceDowngraded: true } : {}),
      verdictStrict: verdictOf('strict'), verdictLenient: verdictOf('lenient'), quoteFound,
    };
  });
}

/** Score of the record under each rule, from criteria made by dualCriteria. */
function dualScores(rubric, criteria) {
  const under = (rule) => rubricScore(rubric, criteria.map((c) => ({ id: c.id, verdict: rule === 'strict' ? c.verdictStrict : c.verdictLenient })));
  return { strict: under('strict'), lenient: under('lenient') };
}

/** True when every criterion of the record carries both views. */
const hasViews = (rec) => Array.isArray(rec?.criteria) && rec.criteria.length > 0 && rec.criteria.every((c) => c.quoteFound && 'verdictStrict' in c && 'verdictLenient' in c);

/** The record as the `rule` view reads it: the older fields hold that rule's verdicts. Only for a record with both views. */
function selectView(rec, rule, rubric) {
  const criteria = rec.criteria.map((c) => {
    const verdict = rule === 'strict' ? c.verdictStrict : c.verdictLenient;
    const found = c.quoteFound[rule];
    const { evidenceDowngraded, ...rest } = c;
    return { ...rest, verdict, verdictScored: verdict, evidenceFound: found, ...(found === false && c.verdictRaw !== 'fail' ? { evidenceDowngraded: true } : {}) };
  });
  const stored = rule === 'strict' ? rec.scoreStrict : rec.scoreLenient;
  const score = typeof stored === 'number' || stored === null ? stored : rubricScore(rubric, criteria);
  return { ...rec, criteria, score };
}

const keyOf = (r) => `${r.armId}\u0000${r.taskId}\u0000${r.replicate}`;

/**
 * Judgments of `run` as the `rule` view reads them. A record with both views is switched to the rule. A record from before
 * the dual view is strict as stored; for the lenient rule it is matched again against the output rebuilt from the run
 * directory, with no model call. Records whose output cannot be rebuilt stay strict and are counted in `missing`.
 * Returns { judgments, rule, requested, rebuilt, missing, records, switched }; judgments is null when the run has none.
 * The caller's run is not changed.
 */
function viewJudgments(run, rule, { tasks, redactions, rebuild = true } = {}) {
  checkRule(rule);
  const j = run.judgmentsStored ?? run.judgments;
  if (!j) return { judgments: null, rule, requested: rule, rebuilt: 0, missing: 0, records: 0, switched: 0 };
  const { buildBundle } = require('./bundle.js');
  const { effectiveLimits } = require('./config.js');
  const { loadRedactions } = require('./redact.js');
  const { rescoredCriteria } = require('./rescore.js');
  let red = redactions;
  const bundles = new Map();
  const matcherFor = (rec) => {
    const k = keyOf(rec);
    if (!bundles.has(k)) {
      let m = null;
      const entry = run.runs.find((e) => keyOf(e) === k);
      const task = tasks?.get(rec.taskId);
      if (entry && task) {
        try {
          red = red ?? loadRedactions(undefined);
          m = makeQuoteMatcher(buildBundle({ runDir: entry.dir, result: entry.result, fixtureDir: task.fixtureDir, limits: effectiveLimits(task, j.limits ?? {}, {}), redactions: red }).text, { lenient: true });
        } catch { m = null; }
      }
      bundles.set(k, m);
    }
    return bundles.get(k);
  };
  let rebuilt = 0;
  let missing = 0;
  let records = 0;
  let switched = 0;
  const rubric = (j.rubric || []).map((rec) => {
    if (rec.judgeError || !rec.criteria?.length) return rec;
    records++;
    const task = tasks?.get(rec.taskId);
    if (hasViews(rec)) { switched++; return selectView(rec, rule, task?.rubric || []); }
    if (rule === 'strict') return rec;
    const found = rebuild && task ? matcherFor(rec) : null;
    if (!found) { missing++; return rec; }
    rebuilt++;
    const criteria = rescoredCriteria(rec.criteria, found);
    return { ...rec, criteria, score: rubricScore(task.rubric, criteria) };
  });
  return { judgments: { ...j, rubric }, rule: missing === records && records > 0 && rule === 'lenient' ? 'strict' : rule, requested: rule, rebuilt, missing, records, switched };
}

module.exports = { dualCriteria, dualScores, hasViews, selectView, viewJudgments, matchersFor, checkRule, otherRule, NO_EVIDENCE };
