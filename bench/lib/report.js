// SPDX-License-Identifier: Apache-2.0
/**
 * A plain-markdown report of one run: the control status, then each skill's verdict next to the
 * word-check gap, the gate state and whether the run can be trusted.
 *
 * `renderReport(run)` takes the object `runSummary` (controls.js) returns, `{ status, controls,
 * skills }`, and returns a string. Each entry of `skills` may be an `aggregateSkill` result or the
 * stored result record that holds one, with the `trusted` and `trust_reasons` that `runSummary`
 * adds. The function is pure: it reads no file, no clock and no environment, and the same run
 * gives the same text, byte for byte. Skills are listed in name order.
 *
 * What it prints. Per run: the status and, for each control, its verdict against the expected one.
 * Per skill: the final verdict (after the word-check gate) and the judge-only verdict; the judge
 * gap (with minus without) as a mean and 95% interval over the usable pairs; the word-check gap as
 * a mean and 95% interval over the pairs with checks, or the words "gate off" and how many pairs
 * have checks against how many are needed; whether the gate changed the verdict and why; whether
 * the skill is trusted and the reasons it is not; and the counts of pairs left out (load failures,
 * treatment failures, unscored pairs). Every threshold is introduced as provisional.
 *
 * What it never prints. It copies named, numeric or fixed-word fields and nothing else. It does
 * not print a task id, an answer, a file path or file content, a judge's reply, or the text a
 * treatment check matched, and it does not walk the pair records at all, so such text cannot reach
 * it. A skill name is printed only when it is a valid slug (slug.js); any other key prints as
 * "(unnamed skill)". Free text that the code itself built (a reason) is collapsed to one line and
 * cut at a length cap, so it cannot add headings or list items.
 */
const {
  DECISION_RULE_NAME,
  WORD_CHECK_GATE_ID,
  KEEP_FLOOR,
  PRUNE_FLOOR,
  MIN_DECISION_PAIRS,
} = require('./decision-rule');
const { isSlug } = require('./slug');

const REVIEW = 'needs human review';
const VERDICTS = Object.freeze(['keep', 'prune', REVIEW]);
const MAX_TEXT_CHARS = 300;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** One line of at most MAX_TEXT_CHARS characters; an empty or non-text value gives "none". */
function oneLine(text) {
  if (typeof text !== 'string') return 'none';
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat === '') return 'none';
  return flat.length > MAX_TEXT_CHARS ? `${flat.slice(0, MAX_TEXT_CHARS - 3)}...` : flat;
}

/** A skill name as code, or a fixed label when the key is not a valid slug. */
const nameOf = (skill) => (typeof skill === 'string' && isSlug(skill) ? `\`${skill}\`` : '(unnamed skill)');

/** A verdict word, or "unknown" when the value is not one of the three verdicts. */
const verdictWord = (v) => (VERDICTS.includes(v) ? v : 'unknown');

/** A count, or "unknown" when the field is missing or not a non-negative integer. */
const countOf = (n) => (Number.isInteger(n) && n >= 0 ? String(n) : 'unknown');

/** A number with two decimals and an explicit sign, "+0.00" for zero. */
function signed(x) {
  const rounded = Number(x.toFixed(2));
  return `${rounded >= 0 ? '+' : ''}${rounded.toFixed(2)}`;
}

const isInterval = (ci) => Array.isArray(ci) && ci.length === 2 && ci.every(Number.isFinite);
const interval = (ci) => `[${signed(ci[0])}, ${signed(ci[1])}]`;

/** The `aggregateSkill` result inside an entry that is either that result or a stored record. */
function aggregateOf(entry) {
  if (!isObject(entry)) return null;
  if (isObject(entry.verdict)) return entry;
  return isObject(entry.result) && isObject(entry.result.verdict) ? entry.result : null;
}

function thresholdLines() {
  return [
    `Provisional thresholds (decision rule ${DECISION_RULE_NAME}, word-check gate ${WORD_CHECK_GATE_ID}). ` +
      'They come from a small early run and are not calibrated on this suite. A prune is a ' +
      'candidate for human approval, never an action.',
    '',
    `- keep (provisional): the 95% interval of the judge gap lies entirely above ${signed(KEEP_FLOOR)}.`,
    `- prune (provisional): the 99% one-sided upper bound of the judge gap lies below ${signed(PRUNE_FLOOR)}.`,
    `- Both need at least ${MIN_DECISION_PAIRS} usable pairs (provisional).`,
    `- Word-check gate (provisional): with at least ${MIN_DECISION_PAIRS} pairs with checks, a keep whose ` +
      '95% word-check interval lies entirely below 0, or a prune whose interval lies entirely above 0, ' +
      'becomes needs human review. The gate never creates a keep or a prune.',
  ];
}

function controlLines(controls) {
  if (controls.length === 0) return ['No controls were evaluated.'];
  const lines = [];
  for (const c of controls) {
    const entry = isObject(c) ? c : {};
    const status = entry.status === 'PASS' ? 'PASS' : 'FAIL';
    const actual = entry.actual === null || entry.actual === undefined ? 'no verdict' : verdictWord(entry.actual);
    lines.push(
      `- ${oneLine(entry.id)} control (${nameOf(entry.skill)}): ${status}. ` +
        `Verdict ${actual}, expected ${verdictWord(entry.expected)}.`,
    );
    lines.push(`  - Reason: ${oneLine(entry.reason)}`);
  }
  return lines;
}

function judgeGapLine(verdict) {
  const n = countOf(verdict.pairs);
  if (isInterval(verdict.ci) && Number.isFinite(verdict.mean)) {
    return `- Judge gap (with minus without): mean ${signed(verdict.mean)}, 95% interval ${interval(verdict.ci)}, ${n} usable pairs`;
  }
  if (Number.isFinite(verdict.mean)) {
    return `- Judge gap (with minus without): mean ${signed(verdict.mean)}, no interval, ${n} usable pairs`;
  }
  return `- Judge gap (with minus without): not computed, ${n} usable pairs`;
}

/** A line that counts the pairs left out of the word-check gap for unequal check lists, or none. */
function mismatchLines(aggregate) {
  const n = aggregate.check_mismatch_pairs;
  if (!Number.isInteger(n) || n <= 0) return [];
  return [`- Word-check pairs left out: ${n}, the two arms ran different numbers of checks`];
}

function wordCheckLine(wc) {
  if (!isObject(wc)) return '- Word-check gap: not recorded';
  const k = countOf(wc.k ?? wc.pairs);
  if (wc.gate === 'off') {
    return `- Word-check gap: gate off: ${k} pairs with checks, need ${countOf(wc.need)}`;
  }
  if (isInterval(wc.ci) && Number.isFinite(wc.mean)) {
    return `- Word-check gap (with minus without): mean ${signed(wc.mean)}, 95% interval ${interval(wc.ci)}, ${k} pairs with checks`;
  }
  return `- Word-check gap: not computed, ${k} pairs with checks`;
}

/** Whether the gate changed the verdict, and the reason in fixed words. */
function gateLine(verdict) {
  const judged = verdictWord(verdict.judge_verdict);
  const final = verdictWord(verdict.verdict);
  const wc = isObject(verdict.word_check) ? verdict.word_check : {};
  if (!(wc.vetoed === true) && judged === final) return '- Gate changed the verdict: no';
  const why = !isInterval(wc.ci)
    ? 'the word-check gap could not be computed, so the judge verdict was not confirmed'
    : judged === 'keep'
      ? 'the word-check interval lies entirely below 0, so the checks say the skill is worse'
      : judged === 'prune'
        ? 'the word-check interval lies entirely above 0, so the checks say the skill is better'
        : 'the verdict differs from the judge-only verdict';
  return `- Gate changed the verdict: yes, from ${judged} to ${final}, because ${why}`;
}

function trustLines(entry) {
  if (entry.trusted === true) return ['- Trusted: yes'];
  if (entry.trusted !== false) return ['- Trusted: unknown (the run was not summarised against its controls)'];
  const reasons = Array.isArray(entry.trust_reasons) ? entry.trust_reasons : [];
  return [
    '- Trusted: no',
    ...(reasons.length ? reasons.map((r) => `  - ${oneLine(r)}`) : ['  - no reason recorded']),
  ];
}

function skillLines(name, entry) {
  const aggregate = aggregateOf(entry);
  if (aggregate === null) {
    return [`### ${nameOf(name)}`, '', '- Final verdict: none, the result has no verdict'];
  }
  const verdict = aggregate.verdict;
  return [
    `### ${nameOf(name)}`,
    '',
    `- Final verdict: ${verdictWord(verdict.verdict)}`,
    `- Judge-only verdict: ${verdictWord(verdict.judge_verdict ?? verdict.verdict)}`,
    judgeGapLine(verdict),
    wordCheckLine(verdict.word_check),
    ...mismatchLines(aggregate),
    gateLine(verdict),
    ...trustLines(isObject(entry) ? entry : {}),
    `- Reason: ${oneLine(verdict.reason)}`,
    `- Pairs left out: ${countOf(verdict.load_failed)} load failures, ` +
      `${countOf(verdict.treatment_failed)} treatment failures, ${countOf(verdict.unscored)} unscored`,
  ];
}

/** Code-unit order, so the output does not depend on the locale. */
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The report for one run as markdown. Throws a TypeError when `run` is not the object `runSummary`
 * returns. Ends with one newline.
 */
function renderReport(run) {
  if (!isObject(run) || typeof run.status !== 'string' || !Array.isArray(run.controls) || !isObject(run.skills)) {
    throw new TypeError('renderReport needs the { status, controls, skills } object that runSummary returns');
  }
  const lines = [
    '# Benchmark report',
    '',
    `Run status: ${run.status === 'PASS' ? 'PASS' : 'FAIL'}`,
    '',
    ...thresholdLines(),
    '',
    '## Controls',
    '',
    ...controlLines(run.controls),
    '',
    '## Skills',
  ];
  const names = Object.keys(run.skills).sort(byName);
  if (names.length === 0) lines.push('', 'No skills in this run.');
  for (const name of names) lines.push('', ...skillLines(name, run.skills[name]));
  return `${lines.join('\n')}\n`;
}

module.exports = { renderReport };
