// SPDX-License-Identifier: Apache-2.0
'use strict';

// run-judging.sh's two reads: the smoke test verdict and the judging summary. Read only; each returns text.

const fs = require('node:fs');
const path = require('node:path');
const { readJsonOrNull } = require('../../runner/lib/util.js');
const { records } = require('./judgments.js');

/**
 * The smoke test verdict from the smoke script's JSON lines.
 * @param {string} file the smoke script's output
 * @param {string} rc its exit status
 * @param {string} models space-separated models that must have passed ('' = every model seen)
 * @returns {{ok:boolean, lines:string[]}} lines: 'OK <model>' per pass, then one 'FAIL ...' line when any failed
 */
function smokeVerdict(file, rc, models) {
  const seen = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.startsWith('{')) continue;
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (r && r.model) seen[r.model] = r;
  }
  const lines = [];
  const bad = [];
  const wanted = String(models || '').split(/\s+/).filter(Boolean);
  for (const m of wanted.length ? wanted : Object.keys(seen)) {
    const r = seen[m];
    if (!r) bad.push(`${m}: no result printed`);
    else if (r.error) bad.push(`${m}: ${String(r.error).slice(0, 300)}`);
    else if (r.jsonOk === false) bad.push(`${m}: reply was not valid JSON`);
    else lines.push(`OK ${m}`);
  }
  if (!wanted.length && !Object.keys(seen).length) bad.push('the smoke script printed no result');
  if (String(rc) !== '0') bad.push(`smoke script exit status ${rc}`);
  if (bad.length) lines.push(`FAIL ${bad.join(' | ')}`);
  return { ok: bad.length === 0, lines };
}

const usd = (n) => (typeof n === 'number' ? `$${n.toFixed(4)}` : 'n/a');

function cellLines(study, cell, exit, p) {
  const j = readJsonOrNull(path.join(study, cell, 'judgments.json'));
  p(`- ${cell}: judge exit status ${exit ?? 'unknown'}`);
  if (!j) { p('    judgments.json missing or unreadable, so nothing was judged'); return; }
  const inv = j.invocations || [];
  const calls = inv.reduce((s, x) => s + (x.calls || 0), 0);
  const cached = inv.reduce((s, x) => s + (x.cachedCalls || 0), 0);
  const recs = records(j);
  const parseFailures = recs.reduce((s, r) => s + (typeof r.parseFailures === 'number' ? r.parseFailures : 0), 0);
  const errors = recs.filter((r) => r.judgeError);
  const byJudge = {};
  for (const r of errors) byJudge[r.judge] = (byJudge[r.judge] || 0) + 1;
  p(`    backend ${j.backend}, subject ${j.subjectModel}, judges ${(j.judges || []).join(', ')}`);
  p(`    spent ${usd(j.spentUsd)} over ${inv.length} invocation(s) (${Object.entries(j.spentUsdByJudge || {}).map(([k, v]) => `${k} ${usd(v)}`).join(', ')})`);
  p(`    calls ${calls} (${cached} served from cache), records: ${(j.rubric || []).length} rubric, ${(j.pairwise || []).length} pairwise, ${(j.graded || []).length} graded`);
  p(`    parse failures ${parseFailures}, judge errors ${errors.length}${errors.length ? ` (${Object.entries(byJudge).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}, runs not judged ${(j.notJudged || []).length}`);
  if (errors.length) p('    judge errors were not cached: rerun the script to retry them');
}

/**
 * The judging summary: per cell spend and errors, the orchestrator pass rule, the platform verdicts, the reports.
 * @param {{study:string, rj:string, statusLines:string, budget:string, cells:string[], now?:Date}} o
 *   statusLines 'cell=exit;cell=exit;' as the script builds it
 * @returns {string}
 */
function judgingSummary({ study, rj, statusLines, budget, cells, now = new Date() }) {
  const out = [];
  const p = (s = '') => out.push(s);
  const exits = Object.fromEntries(String(statusLines).split(';').filter(Boolean).map((x) => x.split('=')));
  p(`Judging summary, generated ${now.toISOString()}`);
  p(`Study: ${study}`);
  p(`Budget cap per cell and command: $${budget}`);
  p();
  p('Judging per cell');
  for (const cell of cells) cellLines(study, cell, exits[cell], p);
  p();
  p('Orchestrator pass rule (cell | arm | call)');
  const pass = readJsonOrNull(path.join(rj, 'pass', 'orchestrator-pass.json'));
  if (!pass) p('    report missing: pass/orchestrator-pass.json');
  else {
    for (const c of pass.cells || []) {
      for (const a of c.arms || []) {
        const why = a.aaRepeatOf ? `A/A repeat of ${a.aaRepeatOf}` : (a.reasons || []).slice(0, 2).join('; ');
        p(`- ${c.key || `${c.harnessLabel} / ${c.model}`} | ${a.label} | ${a.call}${why ? ` | ${why}` : ''}`);
      }
    }
  }
  p();
  p('Platform verdict (arm | verdict)');
  for (const cell of cells) {
    const v = readJsonOrNull(path.join(rj, `platform-${cell}`, 'verdict.json'));
    p(`${cell}:`);
    if (!v) { p('    report missing'); continue; }
    for (const a of v.arms || []) p(`- ${a.label} | ${a.verdict}${a.aaRepeatOf ? ` (A/A repeat of ${a.aaRepeatOf})` : ''}`);
  }
  p();
  p('Reports');
  if (fs.existsSync(rj)) {
    for (const d of fs.readdirSync(rj).sort()) {
      const full = path.join(rj, d);
      if (fs.statSync(full).isDirectory()) p(`- ${full}/`);
    }
  }
  return out.join('\n');
}

module.exports = { smokeVerdict, judgingSummary };
