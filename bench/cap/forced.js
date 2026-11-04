// SPDX-License-Identifier: Apache-2.0
'use strict';

// The forced-load arm. It measures what a skill does once it is loaded, for skills that rarely load on their own.
// The arm is the base ref with a fixed first instruction in front of the task prompt (`run --arm-prefix`) that names the
// skill and says to load it with the harness's own skill tool. Nothing else changes: same agents, same skill index, same
// description. Whether the skill really loaded is read from the run stream with the usual load detection.
//
// A forced result is reported beside the organic arms and never feeds a DELETE, PRUNE or KEEP call: it answers "does the
// skill help when it is loaded", not "should the agent keep it", which also depends on whether the agent ever loads it.

const crypto = require('node:crypto');
const { compareArms, variantStatus } = require('./decide.js');

const HARNESSES = ['kiro-cli', 'opencode'];
const MODES = ['low-load', 'always'];
// The forced arm, its A/A repeat (same ref, same prefix) and the skill deleted, all in one run of their own. The forced
// arms run apart from the unforced control so that wave 1 keeps its own A/A pair and comparison count.
const FORCED_ARMS = ['frc', 'frc-b', 'del'];
const FORCED_WAVE = '1f';
const ARM_LABEL = 'forced-load';
// Below this share of forced runs that loaded the skill, the forced arm mixes loaded and unloaded runs. Our own figure.
const FORCED_LOAD_MIN = 0.9;

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

const prefixHash = (text) => crypto.createHash('sha256').update(text).digest('hex');

/** `--forced-load` value: off when absent, low-load or always. */
function checkMode(v) {
  if (v === undefined || v === null || v === false) return null;
  if (v === true || !MODES.includes(String(v))) throw new Error(`--forced-load takes ${MODES.join(' or ')}`);
  return String(v);
}

/** Whether the forced wave runs, from the mode and the organic load share of the wave 1 control. */
function forcedWanted(mode, organicRate, loadMin) {
  if (mode === 'always') return true;
  if (mode === 'low-load') return organicRate === null || organicRate < loadMin;
  return false;
}

const rateOf = (arms) => {
  const flags = arms.flatMap((a) => a?.loaded ?? []);
  return { loaded: flags.filter(Boolean).length, of: flags.length, rate: flags.length ? flags.filter(Boolean).length / flags.length : null };
};

const READING = {
  lost: 'with the skill loaded, deleting it lost quality: the skill helps when it loads',
  gained: 'with the skill loaded, deleting it improved quality: the skill hurts when it loads',
  safe: 'with the skill loaded, deleting it stayed within the margin: no effect seen when it loads',
  unclear: 'no reading',
};

/**
 * The forced arm against the delete arm of the same run, with the A/A repeat of the forced arm as the noise floor. Pure.
 * `arms` holds frc, frc-b and del as `readWave` returns them. `organic` is the wave 1 control load share, or null.
 * Returns { arm, usedForCall: false, ... }; usedForCall is always false.
 */
function forcedSummary({ arms, organic = null }) {
  const frc = arms?.frc;
  const aa = arms?.['frc-b'];
  const del = arms?.del;
  const out = { arm: ARM_LABEL, usedForCall: false, organicLoad: organic, forcedLoad: null, held: false, aaSpread: null, comparison: null, status: 'unclear', reading: READING.unclear, notes: [] };
  if (!frc || !del) { out.notes.push('the forced wave has no forced arm or no delete arm'); return out; }
  out.forcedLoad = rateOf([frc, aa]);
  out.held = out.forcedLoad.rate !== null && out.forcedLoad.rate >= FORCED_LOAD_MIN;
  if (!out.held) out.notes.push(`the skill loaded in ${out.forcedLoad.loaded} of ${out.forcedLoad.of} forced runs, under ${Math.round(FORCED_LOAD_MIN * 100)}%: the forced arm mixes loaded and unloaded runs`);
  if (!aa) out.notes.push('no A/A repeat of the forced arm, so the noise floor is the minimum');
  const aaCmp = aa ? compareArms(aa.scores, frc.scores) : { delta: null };
  out.aaSpread = aaCmp.delta === null ? 0 : Math.abs(aaCmp.delta);
  const st = variantStatus(del, frc, out.aaSpread);
  out.comparison = st;
  out.status = st.status;
  out.reading = st.status === 'unclear' ? `no reading: ${st.reason}` : READING[st.status];
  if (!out.held && st.status !== 'unclear') out.reading += ' (but forcing did not hold, so read it as a mix)';
  return out;
}

const r3 = (v) => (typeof v === 'number' ? Number(v.toFixed(3)) : v);
const pct = (x) => (x && x.rate !== null ? `${x.loaded} of ${x.of} (${Math.round(x.rate * 100)}%)` : 'n/a');
const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** Markdown for the decisions report: its own section, after the calls, labelled as never used for a call. */
function renderForced(decisions) {
  const rows = decisions.filter((d) => d.forced);
  if (!rows.length) return [];
  const L = ['## Forced-load arm (reported apart, never used for a call)', ''];
  L.push('The forced arm is the base ref with a first instruction that names the skill and says to load it. It is compared with the skill deleted, in a run of its own with an A/A repeat of the forced arm. It shows whether the skill helps once loaded. It does not change any call above: a skill the agent rarely loads on its own can help when forced and still cost every session that never loads it.', '');
  L.push('| skill | organic load (control) | forced load | status | delete minus forced | runs | A/A spread | reading |', '|---|---|---|---|---|---|---|---|');
  for (const d of rows) {
    const f = d.forced;
    const c = f.comparison;
    const delta = c && c.delta !== null ? `${r3(c.delta)}${c.ci ? ` (95% interval ${r3(c.ci.lo)} to ${r3(c.ci.hi)})` : ''}` : 'n/a';
    L.push(`| ${[d.name, pct(f.organicLoad), pct(f.forcedLoad), f.status, delta, c ? `${c.nHead} vs ${c.nBase}` : 'n/a', r3(f.aaSpread), [f.reading, ...f.notes].join('; ')].map(cell).join(' | ')} |`);
  }
  L.push('', 'One comparison per skill (delete against forced), at the plain 95% level like the rest of this report. The forced runs were not counted in any call, any evidence row or the A/A spread of wave 1.', '');
  return L;
}

module.exports = { forcedPrefix, prefixHash, checkMode, forcedWanted, forcedSummary, renderForced, FORCED_ARMS, FORCED_WAVE, FORCED_LOAD_MIN, ARM_LABEL, HARNESSES, MODES };
