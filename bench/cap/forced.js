// SPDX-License-Identifier: Apache-2.0
'use strict';

// The forced-load arm. It measures what a skill does once it is loaded, for skills that rarely load on their own.
// The arm is the base ref with a fixed first instruction in front of the task prompt (`run --arm-prefix`) that names the
// skill and says to load it with the harness's own skill tool. Nothing else changes: same agents, same skill index, same
// description. Whether the skill really loaded is read from the run stream with the usual load detection. The delete arm
// of the same run gets a neutral filler instruction of about the same word count in the same place, so the main contrast
// is not "an instruction against none".
//
// A forced result is reported beside the organic arms and never feeds a DELETE, PRUNE or KEEP call: it answers "does the
// skill help when it is loaded", not "should the agent keep it", which also depends on whether the agent ever loads it.

const crypto = require('node:crypto');
const { diffCI } = require('../report/stats.js');
const { compareArms, variantStatus, MARGIN, NOISE_FLOOR, MIN_RUNS, LOAD_MIN } = require('./decide.js');

const HARNESSES = ['kiro-cli', 'opencode'];
// `off` clears a forced load saved in study.json; it is saved like the other two so a resume stays off.
const MODES = ['low-load', 'always', 'off'];
// The forced arm, its A/A repeat (same ref, same prefix) and the skill deleted (with the filler), all in one run of their
// own. The forced arms run apart from the unforced control so that wave 1 keeps its own A/A pair and comparison count.
const FORCED_ARMS = ['frc', 'frc-b', 'del'];
const FORCED_WAVE = '1f';
const ARM_LABEL = 'forced-load';
// Default share of forced runs that must load the skill for forcing to count as held. Our own figure; `--forced-held-min` changes it.
const FORCED_LOAD_MIN = 0.9;
const FAMILY_ALPHA = 0.05;

const TOOL_OF = {
  'kiro-cli': 'the get_skill tool of the skills server',
  opencode: 'the skill tool',
};

/** The first-turn instruction for one harness. Plain text, no dashes, the skill named once in quotes. */
function forcedPrefix({ name, harness = 'kiro-cli' }) {
  if (!HARNESSES.includes(harness)) throw new Error(`forced load supports ${HARNESSES.join(' and ')} (got "${harness}")`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(name))) throw new Error(`"${name}" is not a skill name`);
  return [
    `Before you do anything else, load the skill named "${name}" with ${TOOL_OF[harness]} and read it.`,
    'Then do the task below, following that skill wherever it applies.',
  ].join(' ');
}

// Neutral sentences for the delete arm's instruction, longest first. None names a skill or a tool, or asks for a load.
const FILLER_SENTENCES = [
  'Before you do anything else, read the task below from start to finish.',
  'Note what it asks for and what a good result would look like.',
  'Then do the task, one step at a time.',
  'Check your work before you finish.',
  'Keep the answer short.',
  'Say what you changed.',
  'Begin now.',
];
const FILLER_TOLERANCE = 0.1;
const wordCount = (text) => String(text).trim().split(/\s+/).filter(Boolean).length;

/**
 * A neutral instruction for the delete arm whose word count is within 10% of `forcedText`'s, built the same way every
 * time: sentences from the fixed list in order, each one taken if it still fits under the upper bound, cycling until the
 * count reaches the lower bound. Single spaces only. It names no skill or tool.
 */
function forcedFiller(forcedText) {
  const target = wordCount(forcedText);
  if (target < 10) throw new Error('the filler needs a forced instruction of at least 10 words');
  const lo = Math.ceil(target * (1 - FILLER_TOLERANCE));
  const hi = Math.floor(target * (1 + FILLER_TOLERANCE));
  const out = [];
  let n = 0;
  for (let i = 0; n < lo && i < FILLER_SENTENCES.length * 8; i++) {
    const sentence = FILLER_SENTENCES[i % FILLER_SENTENCES.length];
    const k = wordCount(sentence);
    if (n + k <= hi) { out.push(sentence); n += k; }
  }
  if (n < lo) throw new Error(`no filler within ${Math.round(FILLER_TOLERANCE * 100)}% of ${target} words`);
  return out.join(' ');
}

const prefixHash = (text) => crypto.createHash('sha256').update(text).digest('hex');

/** `--forced-load` value: null when absent, else low-load, always or off (off is kept so it can be saved). */
function checkMode(v) {
  if (v === undefined || v === null || v === false) return null;
  if (v === true || !MODES.includes(String(v))) throw new Error('--forced-load takes low-load, always or off');
  return String(v);
}

/** `--forced-held-min` value: a share above 0 and at most 1, or the default when absent. */
function checkHeldMin(v) {
  if (v === undefined || v === null) return null;
  const x = Number(v);
  if (v === true || !(x > 0 && x <= 1)) throw new Error('--forced-held-min takes a share above 0 and at most 1 (for example 0.9)');
  return x;
}

/**
 * Whether the forced wave runs, from the mode and the organic load share of the wave 1 control. Fails closed: low-load
 * with no known share does not run. Returns { run, reason }.
 */
function forcedWanted(mode, organicRate, loadMin = LOAD_MIN) {
  const floor = `${Math.round(loadMin * 100)}%`;
  if (mode === 'always') return { run: true, reason: 'always' };
  if (mode !== 'low-load') return { run: false, reason: 'forced load is off' };
  if (organicRate === null || organicRate === undefined || !Number.isFinite(organicRate)) return { run: false, reason: `the wave 1 control load rate is unknown (no control run was read), so --forced-load low-load does not run the forced wave; use always to force it` };
  if (organicRate < loadMin) return { run: true, reason: `the skill loaded in ${Math.round(organicRate * 100)}% of wave 1 control runs, under ${floor}` };
  return { run: false, reason: `the skill loaded in ${Math.round(organicRate * 100)}% of wave 1 control runs, at or over the ${floor} floor; --forced-load low-load runs the forced wave only below it` };
}

const rateOf = (arms) => {
  const flags = arms.flatMap((a) => a?.loaded ?? []);
  return { loaded: flags.filter(Boolean).length, of: flags.length, rate: flags.length ? flags.filter(Boolean).length / flags.length : null };
};
const finite = (xs) => (xs ?? []).filter((x) => typeof x === 'number' && Number.isFinite(x));

/**
 * The delete-against-forced status at the family level 1 - 0.05/comparisons (Bonferroni over the skills with a forced
 * wave). The guards (censoring, uneven scoring, too few runs) come from decide's variantStatus at 95%; the interval and
 * the label are recomputed at the family level with the same margin and noise rules.
 */
function familyStatus(del, frc, aaSpread, comparisons) {
  const m = Math.max(1, Math.floor(comparisons));
  const level = 1 - FAMILY_ALPHA / m;
  const base = variantStatus(del, frc, aaSpread);
  const out = { ...base, level, comparisons: m };
  if (base.censored || base.uneven || base.nEach < MIN_RUNS || !base.ci) return out;
  const r = diffCI(finite(del.scores), finite(frc.scores), { confidence: level });
  out.ci = { lo: r.ciLow, hi: r.ciHigh };
  out.reason = '';
  const noise = Math.max(aaSpread, NOISE_FLOOR);
  if (out.ci.hi < 0 && -out.delta > noise) out.status = 'lost';
  else if (out.ci.lo > 0 && out.delta > noise) out.status = 'gained';
  else if (aaSpread > MARGIN) { out.status = 'unclear'; out.reason = `the A/A spread ${Number(aaSpread.toFixed(3))} is wider than the ${MARGIN} margin, so a no-effect result cannot be read`; }
  else if (out.ci.lo >= -MARGIN) out.status = 'safe';
  else { out.status = 'unclear'; out.reason = `the interval reaches ${Number(out.ci.lo.toFixed(3))}, past the ${MARGIN} margin`; }
  return out;
}

const READING = {
  lost: 'with the skill loaded, deleting it lost quality: the skill helps when it loads',
  gained: 'with the skill loaded, deleting it improved quality: the skill hurts when it loads',
  safe: 'with the skill loaded, deleting it stayed within the margin: no effect seen when it loads',
  unclear: 'no reading',
};

/**
 * The forced arm against the delete arm of the same run, with the A/A repeat of the forced arm as the noise floor. Pure.
 * `arms` holds frc, frc-b and del as `readWave` returns them. `organic` is the wave 1 control load share, or null.
 * `comparisons` is the size of the forced family (skills with a forced wave); `heldMin` the share of forced runs that must
 * load the skill. Returns { arm, usedForCall: false, ... }; usedForCall is always false.
 */
function forcedSummary({ arms, organic = null, comparisons = 1, heldMin = FORCED_LOAD_MIN, loadMin = LOAD_MIN }) {
  const frc = arms?.frc;
  const aa = arms?.['frc-b'];
  const del = arms?.del;
  const out = { arm: ARM_LABEL, usedForCall: false, organicLoad: organic, forcedLoad: null, forcedLoadByArm: {}, heldMin, held: false, aaSpread: null, comparison: null, status: 'unclear', reading: READING.unclear, notes: [] };
  if (!frc || !del) { out.notes.push('the forced wave has no forced arm or no delete arm'); return out; }
  out.forcedLoad = rateOf([frc, aa]);
  // Forcing holds only when each forced arm, frc and its repeat frc-b, reaches the bar on its own.
  out.forcedLoadByArm = { frc: rateOf([frc]), ...(aa ? { 'frc-b': rateOf([aa]) } : {}) };
  const low = Object.entries(out.forcedLoadByArm).filter(([, r]) => r.rate === null || r.rate < heldMin);
  out.held = Boolean(aa) && !low.length;
  for (const [id, r] of low) out.notes.push(`${id} loaded the skill in ${r.loaded} of ${r.of} runs, under ${Math.round(heldMin * 100)}%: forcing did not hold, so the forced arms mix loaded and unloaded runs`);
  if (!aa) out.notes.push('no A/A repeat of the forced arm, so the noise floor is the minimum and forcing cannot be shown to hold in both arms');
  const aaCmp = aa ? compareArms(aa.scores, frc.scores) : { delta: null };
  out.aaSpread = aaCmp.delta === null ? 0 : Math.abs(aaCmp.delta);
  const st = familyStatus(del, frc, out.aaSpread, comparisons);
  out.comparison = st;
  out.status = st.status;
  out.reading = st.status === 'unclear' ? `no reading: ${st.reason}` : READING[st.status];
  if (!out.held && st.status !== 'unclear') out.reading += ' (but forcing did not hold, so read it as a mix)';
  const rare = organic && organic.rate !== null && organic.rate < loadMin;
  if (st.status === 'lost' && out.held && rare) {
    out.fixDescription = true;
    out.notes.push('forced load helps; fix the description (or routing text) so the agent loads it on its own');
  }
  return out;
}

/** The record for a forced wave that did not finish: reported, never read, rerun on resume. */
function forcedFailure(reason) {
  return { arm: ARM_LABEL, usedForCall: false, failed: true, reason, status: 'failed', reading: `the forced wave failed: ${reason}; rerun the study to retry it`, notes: [] };
}

const r3 = (v) => (typeof v === 'number' ? Number(v.toFixed(3)) : v);
const armRates = (f) => (f.forcedLoadByArm && Object.keys(f.forcedLoadByArm).length ? Object.entries(f.forcedLoadByArm).map(([id, r]) => `${id} ${pct(r)}`).join(', ') : 'n/a');
const pct = (x) => (x && x.rate !== null ? `${x.loaded} of ${x.of} (${Math.round(x.rate * 100)}%)` : 'n/a');
const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const levelText = (l) => `${Number((l * 100).toFixed(2))}%`;

/** Markdown for the decisions report: its own section, after the calls, labelled as never used for a call. */
function renderForced(decisions) {
  const rows = decisions.filter((d) => d.forced);
  if (!rows.length) return [];
  const read = rows.filter((d) => !d.forced.failed);
  const m = read[0]?.forced.comparison?.comparisons ?? read.length;
  const L = ['## Forced-load arm (reported apart, never used for a call)', ''];
  L.push('The forced arm is the base ref with a first instruction that names the skill and says to load it. It is compared with the skill deleted, whose first instruction is neutral filler of about the same number of words (within 10%) in the same place, in a run of its own with an A/A repeat of the forced arm. Forced against deleted is the main contrast; forced against its repeat is the noise. It shows whether the skill helps once loaded. It does not change any call above: a skill the agent rarely loads on its own can help when forced and still cost every session that never loads it.', '');
  L.push('Remaining confound: the two instructions differ in text (one names the skill and asks for a load, the filler names nothing), and the forced arm spends an extra turn loading the skill. A difference is the skill plus those two, not the skill alone.', '');
  L.push(`| skill | organic load (control) | forced load per arm | held | status | delete minus forced | runs | A/A spread | reading |`, '|---|---|---|---|---|---|---|---|---|');
  for (const d of rows) {
    const f = d.forced;
    const c = f.comparison;
    const delta = c && c.delta !== null ? `${r3(c.delta)}${c.ci ? ` (${levelText(c.level ?? 0.95)} interval ${r3(c.ci.lo)} to ${r3(c.ci.hi)})` : ''}` : 'n/a';
    L.push(`| ${[d.name, pct(f.organicLoad), f.failed ? 'n/a' : armRates(f), f.failed ? 'n/a' : f.held ? 'yes' : 'no', f.status, delta, c ? `${c.nHead} vs ${c.nBase}` : 'n/a', f.aaSpread === undefined ? 'n/a' : r3(f.aaSpread), [f.reading, ...f.notes].join('; ')].map(cell).join(' | ')} |`);
  }
  L.push('', `The forced comparisons are their own family of ${m} (one per skill with a finished forced wave), each interval at ${levelText(1 - FAMILY_ALPHA / Math.max(1, m))} (Bonferroni), and the status comes from that interval. Wave 1 and the calls keep their own 95% intervals. The forced runs were not counted in any call, any evidence row or the A/A spread of wave 1. Forcing counts as held only when frc and its repeat frc-b each loaded the skill in at least ${Math.round((read[0]?.forced.heldMin ?? FORCED_LOAD_MIN) * 100)}% of their runs (\`--forced-held-min\`).`, '');
  return L;
}

module.exports = {
  forcedPrefix, forcedFiller, prefixHash, checkMode, checkHeldMin, forcedWanted, familyStatus, forcedSummary, forcedFailure, renderForced,
  FORCED_ARMS, FORCED_WAVE, FORCED_LOAD_MIN, ARM_LABEL, HARNESSES, MODES, FAMILY_ALPHA,
};
