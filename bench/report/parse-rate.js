#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Judge parse rates: per judge, how many replies were readable first time, readable only after the one re-ask
// (judge/run.js judgeOnce), or lost after it, plus replies read only after a JSON repair. A judge that needs the re-ask
// often costs twice and leans on the repair; one that loses replies drops tasks from a reading.
//   node bench/report/parse-rate.js [--json] DIR...   (every judgments.json under the dirs)

const fs = require('node:fs');
const path = require('node:path');
const { readJsonOrNull } = require('../runner/lib/util.js');

const LOST = /^unusable after retry/;
const empty = () => ({ records: 0, firstTry: 0, afterReask: 0, lost: 0, otherErrors: 0, repaired: 0 });

function judgmentFiles(root, acc = []) {
  let ents;
  try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) judgmentFiles(p, acc);
    else if (e.name === 'judgments.json') acc.push(p);
  }
  return acc.sort();
}

function add(t, r) {
  t.records++;
  const err = r.judgeError ? String(r.judgeError) : '';
  if (LOST.test(err)) t.lost++;
  else if (err) t.otherErrors++;
  else if ((r.parseFailures || 0) === 0) t.firstTry++;
  else t.afterReask++;
  if (Array.isArray(r.calls) && r.calls.some((c) => c && c.jsonRepaired)) t.repaired++;
}

/**
 * Parse counts over every judgments.json under the dirs.
 * @param {string[]} dirs study, cell or run dirs
 * @returns {{files:number, byJudge:Object<string, object>, total:object}} counts: records, firstTry, afterReask, lost,
 *   otherErrors (no reply to read: credentials, budget), repaired (read after a JSON repair)
 */
function parseRates(dirs) {
  const out = { files: 0, byJudge: {}, total: empty() };
  for (const f of dirs.flatMap((d) => judgmentFiles(d))) {
    const j = readJsonOrNull(f);
    if (!j) continue;
    out.files++;
    for (const r of [...(j.rubric || []), ...(j.pairwise || []), ...(j.graded || [])]) {
      const k = String(r.judge ?? 'unknown');
      out.byJudge[k] ??= empty();
      add(out.byJudge[k], r);
      add(out.total, r);
    }
  }
  return out;
}

const rate = (t) => {
  const replies = t.records - t.otherErrors;
  return replies ? `${t.firstTry} (${((100 * t.firstTry) / replies).toFixed(1)}%)` : `${t.firstTry} (n/a)`;
};
const row = (name, t) => `| ${name} | ${t.records} | ${rate(t)} | ${t.afterReask} | ${t.lost} | ${t.otherErrors} | ${t.repaired} |`;

/** A markdown table; the first-try rate is over the replies that came back (records minus other errors). */
function renderParseRates(r) {
  const L = [`Judge parse rates over ${r.files} judgments.json file(s)`, '',
    '| judge | records | first try | after the re-ask | lost after the re-ask | other errors (no reply) | read after a JSON repair |',
    '| --- | --- | --- | --- | --- | --- | --- |'];
  for (const k of Object.keys(r.byJudge).sort()) L.push(row(k, r.byJudge[k]));
  L.push(row('all', r.total));
  return `${L.join('\n')}\n`;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const dirs = args.filter((a) => a !== '--json');
  if (!dirs.length) { process.stderr.write('usage: node parse-rate.js [--json] DIR...\n'); process.exit(64); }
  const r = parseRates(dirs);
  process.stdout.write(json ? `${JSON.stringify(r, null, 2)}\n` : renderParseRates(r));
}

module.exports = { parseRates, renderParseRates, judgmentFiles };
