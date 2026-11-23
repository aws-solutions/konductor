#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// One command line for the bash scripts: node bench/scripts/lib/sh.js <command> [args...]. Each command prints the
// exact line or text its script reads, so the scripts hold no inline JavaScript. Unknown command: exit 64.

const fs = require('node:fs');
const path = require('node:path');
const study = require('./study.js');
const judgments = require('./judgments.js');
const ledger = require('./ledger.js');
const report = require('./chain-report.js');
const { writeFields } = require('./plant-seeds.js');

const COMMANDS = {
  // <dir> <nArms> <reps>: 'complete' or why not
  complete: ([dir, nArms, reps]) => study.completeState(dir, nArms, reps),
  // <dirs...>: 'runs=N askedUser=A secondTurn=S'
  astats: (dirs) => study.autonomyStats(dirs),
  // <wave dir>: comma list of budget-skipped task ids
  skipped: ([root]) => study.budgetSkippedTasks(root).join(','),
  // <dirs...>: 'runCredits runs judgeUsd judgeCalls'
  credits: (dirs) => {
    const t = ledger.studyCredits(dirs);
    return `${t.credits.toFixed(2)} ${t.runs} ${t.judgeUsd.toFixed(4)} ${t.judgeCalls}`;
  },
  // <ledger file>: one status line of its judge entries
  judgeledger: ([file]) => {
    const t = ledger.judgeLedger(file);
    return `${t.entries} ledger entries, ${t.ok} ok, live spend $${t.liveUsd.toFixed(4)}`;
  },
  // <judgments.json>: the backend, or 'unreadable'
  backend: ([file]) => judgments.backend(file) ?? 'unreadable',
  // <judgments.json>: 'errors credErrors budgetSkipped spentUsd'
  judgeinfo: ([file]) => {
    const i = judgments.errorInfo(file);
    return i ? `${i.errors} ${i.credErrors} ${i.budgetSkipped} ${i.spentUsd === null ? 0 : i.spentUsd.toFixed(4)}` : 'unreadable 0 0 0';
  },
  // <judgments.json>: 'errors budgetSkipped notJudged'
  cellerrors: ([file]) => {
    const i = judgments.errorInfo(file);
    return i ? `${i.errors} ${i.budgetSkipped} ${i.notJudged}` : 'unreadable 0 0';
  },
  // <decisions.json>: counts, one line per skill, controls
  decisions: ([file]) => report.decisionsText(file),
  // <study> <judged reports dir>: the capability judging summary
  psummary: ([V, RJ]) => report.pilotSummary(V, RJ),
  // <wave dir> <ceiling>: 'left tasks-csv' for the one throttled retry
  retry: ([dir, ceiling]) => {
    const { throttledRetry } = require('../../scenarios/wave-retry.js');
    const r = throttledRetry(dir, Number(ceiling));
    return `${r.left} ${r.tasks.join(',')}`;
  },
  // <tasks dir> <fields out> <kiro version> <kiro sha256>: writes the seeds fields file
  seeds: ([tasksDir, out, version, sha256]) => { writeFields({ tasksDir, out, version, sha256 }); return null; },
  // <repo> <files...>: the first public-hygiene marker in the files; exit 3 when the repo has no scanner
  marker: ([repo, ...files]) => {
    let m;
    try { m = require(path.join(path.resolve(repo), 'bench/cap/public.js')); } catch { process.exit(3); }
    for (const f of files) {
      const h = m.findMarker(fs.readFileSync(f, 'utf8'));
      if (h) return h.marker;
    }
    return null;
  },
};

/**
 * Run one command and return its output text (null prints nothing).
 * @param {string} cmd a key of COMMANDS
 * @param {string[]} args the command's arguments
 * @returns {string|null}
 */
function run(cmd, args) {
  const f = COMMANDS[cmd];
  if (!f) throw new Error(`unknown command: ${cmd}`);
  return f(args);
}

if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  if (!COMMANDS[cmd]) {
    process.stderr.write(`usage: node sh.js <${Object.keys(COMMANDS).join('|')}> [args...]\n`);
    process.exit(64);
  }
  const text = run(cmd, args);
  if (text !== null && text !== undefined) process.stdout.write(`${text}\n`);
}

module.exports = { run, COMMANDS };
