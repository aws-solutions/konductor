// SPDX-License-Identifier: Apache-2.0
'use strict';

// The arm gaps under the pilot table: each arm against the base arm, paired by task, with the detectable gap at 80%
// power (report/power.js) and the A/A noise floor when the runs hold the same arm twice (report/aa.js). Code score only.

const { loadRuns } = require('../report/load.js');
const { pairedCellCI } = require('../report/stats.js');
const { prefixIdentity } = require('../report/aa-identity.js');
const { detectableGap, gapWords, powerLine } = require('../report/power.js');
const { aaNoise, noiseMark } = require('../report/aa.js');

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const signed = (v) => (finite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}` : 'n/a');

/**
 * What an arm is, from its saved results: two arm ids with one identity are the same condition run twice (A/A).
 * @param {string[]} dirs wave output dirs
 * @returns {Map<string, string|null>} armId -> identity; null when its runs disagree or carry an unhashed prefix
 */
function armIdentities(dirs) {
  const byArm = new Map();
  for (const e of loadRuns(dirs).runs) {
    if (!byArm.has(e.armId)) byArm.set(e.armId, []);
    byArm.get(e.armId).push(e.result);
  }
  const out = new Map();
  for (const [arm, rs] of byArm) {
    const prefix = prefixIdentity(rs);
    const keys = new Set(rs.map((r) => JSON.stringify([r.runtime ?? null, r.commitSha ?? null, r.contentHash ?? null, r.armConfig ?? null])));
    out.set(arm, prefix === null || keys.size !== 1 ? null : `${[...keys][0]}${prefix}`);
  }
  return out;
}

/** Per task, the scores of each side, from pilot rows (pairedRows already applied by the caller). */
function cellsOf(rows, head, base) {
  const tasks = [...new Set(rows.map((r) => r.task))].sort();
  const scores = (arm, t) => rows.filter((r) => r.arm === arm && r.task === t && finite(r.score)).map((r) => r.score);
  return tasks.map((t) => ({ task: t, head: scores(head, t), base: scores(base, t) })).filter((c) => c.head.length && c.base.length);
}

/** The first A/A pair among the arms: [primary, repeat], preferring the base arm's own repeat. */
function aaPair(arms, ids, base) {
  const groups = new Map();
  for (const a of arms) {
    const k = ids.get(a);
    if (k === null || k === undefined) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }
  const pairs = [...groups.values()].filter((g) => g.length >= 2);
  const own = pairs.find((g) => g.includes(base));
  const g = own ?? pairs[0];
  if (!g) return null;
  const primary = g.includes(base) ? base : g[0];
  return [primary, g.find((a) => a !== primary)];
}

/**
 * The arm gaps of pilot rows.
 * @param {object[]} rows pairedRows(pilotRows(dirs))
 * @param {Map<string, string|null>} ids armIdentities(dirs)
 * @returns {{base:string, aa:object|null, aaArms:string[]|null, gaps:object[]}|null} null with fewer than 2 arms
 */
function armGaps(rows, ids) {
  const arms = [...new Set(rows.map((r) => r.arm))].sort();
  if (arms.length < 2) return null;
  const base = arms.includes('vanilla') ? 'vanilla' : arms[0];
  const pair = aaPair(arms, ids, base);
  const aa = pair ? aaNoise(cellsOf(rows, pair[1], pair[0])) : null;
  const gaps = arms.filter((a) => a !== base && !(pair && a === pair[1] && pair[0] === base)).map((arm) => {
    const ci = pairedCellCI(cellsOf(rows, arm, base));
    const sd = ci.se === null ? null : ci.se * Math.sqrt(ci.k);
    const detectable = detectableGap({ sd, tasks: ci.k });
    return { arm, tasks: ci.k, gap: ci.delta, low: ci.ciLow, high: ci.ciHigh, sd, detectable };
  });
  return { base, aa, aaArms: pair, gaps };
}

/** Markdown lines for the gaps section. */
function renderGaps(g) {
  if (!g) return [];
  const L = ['', `Arm gaps against ${g.base} (code score; each task's mean over its replicates, paired by task; 95% t interval; detectable gap at 80% power from the spread of the per-task gaps)`, '',
    '| arm | tasks | gap | 95% interval | detectable gap | reading | A/A noise |', '| --- | --- | --- | --- | --- | --- | --- |'];
  for (const x of g.gaps) {
    const reading = finite(x.gap) ? gapWords({ gap: x.gap, detectable: x.detectable }) : 'no paired task';
    L.push(`| ${x.arm} | ${x.tasks} | ${signed(x.gap)} | ${finite(x.low) ? `[${signed(x.low)}, ${signed(x.high)}]` : 'n/a'} | ${finite(x.detectable) ? x.detectable.toFixed(1) : 'n/a'} | ${reading} | ${finite(x.gap) ? noiseMark(x.gap, g.aa) : '-'} |`);
  }
  if (g.aa) L.push('', `A/A noise floor: ${g.aaArms[1]} against ${g.aaArms[0]}, gap ${signed(g.aa.delta)}, half-width ${finite(g.aa.halfWidth) ? g.aa.halfWidth.toFixed(1) : 'n/a'} over ${g.aa.tasks} tasks. A gap inside it is not a finding.`);
  else L.push('', 'No A/A pair in these runs, so no noise floor: run the base arm twice under two ids (name=vanilla) to print one.');
  return L;
}

/**
 * The A/A floor of two sets of one arm (run-aa-pack.sh: set a and set b of vanilla in separate dirs), code score.
 * @param {string[]} dirsA set a wave dirs
 * @param {string[]} dirsB set b wave dirs
 * @param {object} [o] { packDir } for pilotRows
 * @returns {string} the floor line and the detectable gap it implies
 */
function aaFloorText(dirsA, dirsB, o = {}) {
  const { pilotRows, pairedRows } = require('./pilot-table.js');
  const label = (rows, arm) => pairedRows(rows).map((r) => ({ ...r, arm }));
  const rows = [...label(pilotRows(dirsA, o), 'set-a'), ...label(pilotRows(dirsB, o), 'set-b')];
  const aa = aaNoise(cellsOf(rows, 'set-b', 'set-a'));
  if (aa.halfWidth === null) return `A/A floor: unknown (${aa.tasks} paired task(s); needs 2 or more)\n`;
  return `A/A floor (code score, set b against set a, paired by task): gap ${signed(aa.delta)}, half-width ${aa.halfWidth.toFixed(1)} over ${aa.tasks} tasks\n${powerLine({ sd: aa.sd, tasks: aa.tasks })}\n`;
}

if (require.main === module) {
  const a = process.argv.slice(2);
  const sep = a.indexOf('--');
  if (a[0] !== '--aa' || sep < 2 || sep === a.length - 1) {
    process.stderr.write('usage: node pilot-gaps.js --aa SET_A_DIR... -- SET_B_DIR...\n');
    process.exit(64);
  }
  process.stdout.write(aaFloorText(a.slice(1, sep), a.slice(sep + 1)));
}

module.exports = { armIdentities, armGaps, renderGaps, cellsOf, aaPair, aaFloorText };
