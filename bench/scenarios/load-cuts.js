// SPDX-License-Identifier: Apache-2.0
'use strict';

// Whole or cut skill loads in the pilot table (result.skillLoads, runner/lib/skills.js): a load kiro-cli cut to its
// 30,000-char preview and never read back in full did not give the agent the skill, so a forced-skills gap over such
// runs is not a reading of the skill (forced-skills review 2026-11-23, claim 6).

/**
 * Per skill of one run: whole when any load of it was whole (a read-back that covered the file counts), else cut.
 * @param {object} r result.json
 * @returns {Object<string, {whole:boolean, recovered:boolean}>} keyed by the lower-case skill name; {} without skillLoads
 */
function loadState(r) {
  const out = {};
  for (const l of r.skillLoads || []) {
    const k = String(l.name).toLowerCase();
    const cur = out[k] ?? { whole: false, recovered: false };
    out[k] = { whole: cur.whole || Boolean(l.whole), recovered: cur.recovered || Boolean(l.recovered) };
  }
  return out;
}

/** A load's label for the table: the name, plus '(cut)' or '(whole after read-back)' when skillLoads says so. */
function markLoad(name, state) {
  const s = state[String(name).toLowerCase()];
  if (!s) return name;
  if (!s.whole) return `${name} (cut)`;
  return s.recovered ? `${name} (whole after read-back)` : name;
}

/**
 * The counts the table prints under its rows.
 * @param {Object<string, {whole:boolean, recovered:boolean}>[]} states loadState of each run that ran
 * @returns {{skills:number, cut:number, recovered:number, runsWithLoads:number, runsAllWhole:number}}
 */
function cutSummary(states) {
  const t = { skills: 0, cut: 0, recovered: 0, runsWithLoads: 0, runsAllWhole: 0 };
  for (const st of states) {
    const all = Object.values(st || {});
    if (!all.length) continue;
    t.runsWithLoads++;
    for (const s of all) {
      t.skills++;
      if (!s.whole) t.cut++;
      else if (s.recovered) t.recovered++;
    }
    if (all.every((s) => s.whole)) t.runsAllWhole++;
  }
  return t;
}

/** The summary line, or null when no run recorded skillLoads. */
function cutLine(t) {
  if (!t.runsWithLoads) return null;
  return `Skill loads (per run and skill): ${t.skills - t.cut} whole (${t.recovered} only after a read-back), ${t.cut} cut and never read whole; ${t.runsAllWhole} of ${t.runsWithLoads} runs with skill loads had every skill whole. A gap over runs with a cut load does not read the skill.`;
}

module.exports = { loadState, markLoad, cutSummary, cutLine };
