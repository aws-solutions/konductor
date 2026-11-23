// SPDX-License-Identifier: Apache-2.0
'use strict';

// Text the after-capability chain writes into its summaries: the skill-bench decisions and the capability judging
// summary. Read only; each function returns the text.

const fs = require('node:fs');
const path = require('node:path');
const { readJsonOrNull } = require('../../runner/lib/util.js');
const { records } = require('./judgments.js');

const ORDER = ['DELETE', 'PRUNE', 'KEEP', 'NEEDS DATA'];

/**
 * Decision counts, one line per skill, and the controls line.
 * @param {string} file decisions.json
 * @returns {string} text, or 'unreadable'
 */
function decisionsText(file) {
  const j = readJsonOrNull(file);
  if (!j) return 'unreadable';
  const ds = j.decisions || [];
  const lines = [ORDER.map((k) => `${k}=${ds.filter((d) => d.decision === k).length}`).join(' ')];
  const sorted = ds.slice().sort((x, y) => ORDER.indexOf(x.decision) - ORDER.indexOf(y.decision) || String(x.name).localeCompare(y.name));
  for (const d of sorted) lines.push(`  ${d.name}: ${d.decision} (${d.confidence})`);
  const c = j.controls;
  lines.push(`controls: ${c && c.trusted === true ? 'passed' : c && c.trusted === false ? 'FAILED' : 'not checked'}`);
  return lines.join('\n');
}

const usd = (n) => (typeof n === 'number' ? `$${n.toFixed(4)}` : 'n/a');

function spendLines(V, p) {
  let tot = 0;
  const dirs = fs.readdirSync(V).filter((n) => /^(real|pilot)-/.test(n) && fs.existsSync(path.join(V, n, 'summary.json'))).sort();
  for (const n of dirs) {
    const j = readJsonOrNull(path.join(V, n, 'judgments.json'));
    if (!j) { p(`- ${n}: judgments.json missing, not judged`); continue; }
    const recs = records(j);
    const errs = recs.filter((r) => r.judgeError).length;
    const pf = recs.reduce((s, r) => s + (typeof r.parseFailures === 'number' ? r.parseFailures : 0), 0);
    const inv = j.invocations || [];
    const calls = inv.reduce((s, x) => s + (x.calls || 0), 0);
    const cached = inv.reduce((s, x) => s + (x.cachedCalls || 0), 0);
    if (typeof j.spentUsd === 'number') tot += j.spentUsd;
    p(`- ${n}: spent ${usd(j.spentUsd)} over ${inv.length} invocation(s), calls ${calls} (${cached} cached), parse failures ${pf}, judge errors ${errs}, not judged ${(j.notJudged || []).length}`);
  }
  p(`Total judge spend (sum of the per-dir figures): ${usd(tot)}`);
}

function passLines(RJ, p) {
  const pass = readJsonOrNull(path.join(RJ, 'pass', 'orchestrator-pass.json'));
  if (!pass) { p('    report missing: pass/orchestrator-pass.json'); return; }
  for (const c of pass.cells || []) {
    for (const x of c.arms || []) {
      const why = x.aaRepeatOf ? `A/A repeat of ${x.aaRepeatOf}` : (x.reasons || []).slice(0, 2).join('; ');
      p(`- ${c.key || `${c.harnessLabel} / ${c.model}`} | ${x.label} | ${x.call}${why ? ` | ${why}` : ''}`);
    }
  }
}

/**
 * The capability judging summary: spend and errors per task dir, the orchestrator pass rule, the platform verdict
 * and the report dirs.
 * @param {string} V study dir
 * @param {string} RJ judged reports dir
 * @param {Date} [now] clock for the header line
 * @returns {string}
 */
function pilotSummary(V, RJ, now = new Date()) {
  const out = [];
  const p = (s = '') => out.push(s);
  p(`Capability study judging summary, generated ${now.toISOString()}`);
  p(`Study: ${V}`);
  p();
  p('Judge spend and errors per task dir');
  spendLines(V, p);
  p();
  p('Orchestrator pass rule (cell | arm | call)');
  passLines(RJ, p);
  p();
  p('Platform verdict (arm | verdict)');
  const v = readJsonOrNull(path.join(RJ, 'platform', 'verdict.json'));
  if (!v) p('    report missing: platform/verdict.json');
  else for (const x of v.arms || []) p(`- ${x.label} | ${x.verdict}${x.aaRepeatOf ? ` (A/A repeat of ${x.aaRepeatOf})` : ''}`);
  p();
  p('Reports');
  if (fs.existsSync(RJ)) {
    for (const d of fs.readdirSync(RJ).sort()) {
      const f = path.join(RJ, d);
      if (fs.statSync(f).isDirectory()) p(`- ${f}/`);
    }
  }
  return out.join('\n');
}

module.exports = { decisionsText, pilotSummary };
