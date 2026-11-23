// SPDX-License-Identifier: Apache-2.0
'use strict';

// Credit ledger sums the bash chains print. Read only.
// shortcut: these are the two sums the bash scripts used to hold inline; FW-2 folds them into the one spend guard.

const fs = require('node:fs');
const path = require('node:path');

const LEDGER = 'credit-ledger.jsonl';

/**
 * Parsed JSON lines of a ledger file; bad lines are left out, a missing file reads as none.
 * @param {string} file ledger path
 * @returns {object[]}
 */
function ledgerLines(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const l of text.split('\n')) {
    if (!l) continue;
    try { out.push(JSON.parse(l)); } catch { /* a torn last line is not an entry */ }
  }
  return out;
}

/**
 * Every credit-ledger.jsonl under root, at any depth.
 * @param {string} root dir to walk
 * @param {string[]} [acc] collector
 * @returns {string[]}
 */
function ledgerFiles(root, acc = []) {
  let ents;
  try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) ledgerFiles(p, acc);
    else if (e.name === LEDGER) acc.push(p);
  }
  return acc;
}

/**
 * Run credits and live judge spend over every ledger under the dirs.
 * @param {string[]} dirs study or task dirs
 * @returns {{credits:number, runs:number, judgeUsd:number, judgeCalls:number}}
 */
function studyCredits(dirs) {
  const t = { credits: 0, runs: 0, judgeUsd: 0, judgeCalls: 0 };
  for (const d of dirs) {
    for (const f of ledgerFiles(d)) {
      for (const e of ledgerLines(f)) {
        if (e.kind === 'run') { t.runs++; t.credits += Number(e.charged ?? e.credits ?? 0) || 0; }
        else if (e.kind === 'judge' && !e.cached && typeof e.usd === 'number') { t.judgeUsd += e.usd; t.judgeCalls++; }
      }
    }
  }
  return t;
}

/**
 * Judge entries of one ledger file.
 * @param {string} file ledger path
 * @returns {{entries:number, ok:number, liveUsd:number}}
 */
function judgeLedger(file) {
  const t = { entries: 0, ok: 0, liveUsd: 0 };
  for (const r of ledgerLines(file)) {
    if (r.kind !== 'judge') continue;
    t.entries++;
    if (r.ok) t.ok++;
    if (!r.cached && typeof r.usd === 'number') t.liveUsd += r.usd;
  }
  return t;
}

module.exports = { ledgerLines, ledgerFiles, studyCredits, judgeLedger, LEDGER };
