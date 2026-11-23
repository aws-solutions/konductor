// SPDX-License-Identifier: Apache-2.0
'use strict';

// The capability study's task dirs as the chain sees them, and the credit line it logs after each phase.

const fs = require('node:fs');
const path = require('node:path');
const { readTrim } = require('./proc.js');
const { studyCredits } = require('../ledger.js');

/** A shell glob (*, ?, [...]) as an anchored regular expression. */
function globRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else if (ch === '[') { const j = glob.indexOf(']', i + 1); if (j < 0) re += '\\['; else { re += `[${glob.slice(i + 1, j).replace(/^!/, '^')}]`; i = j; } }
    else re += ch.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** The study dir named in the pilot's study file, when it exists. */
function studyDir(c) {
  const v = readTrim(c.pilotStudyfile);
  try { return v && fs.statSync(v).isDirectory() ? v : null; } catch { return null; }
}

/** Task dirs (real-* and pilot-*) of the study that hold a summary.json, sorted. */
function capDirs(V) {
  let names = [];
  try { names = fs.readdirSync(V); } catch { return []; }
  return names.filter((n) => /^(real|pilot)-/.test(n))
    .map((n) => path.join(V, n))
    .filter((d) => { try { return fs.statSync(d).isDirectory() && fs.existsSync(path.join(d, 'summary.json')); } catch { return false; } })
    .sort();
}

/** capDirs of one kind, by dir name: 'real', 'pilot' or 'autonomy' (the autonomy glob). */
function capDirsKind(c, V, kind) {
  const re = globRe(c.autonGlob);
  return capDirs(V).filter((d) => {
    const b = path.basename(d);
    return kind === 'real' ? b.startsWith('real-') : kind === 'pilot' ? b.startsWith('pilot-') : re.test(b);
  });
}

/** Entries of dir whose name matches the glob, as paths, sorted. */
function globIn(dir, glob) {
  const re = globRe(glob);
  try { return fs.readdirSync(dir).filter((n) => re.test(n)).sort().map((n) => path.join(dir, n)); } catch { return []; }
}

const creditLine = (dirs) => {
  const t = studyCredits(dirs);
  return [t.credits.toFixed(2), t.runs, t.judgeUsd.toFixed(4), t.judgeCalls];
};

/** Log the credits and judge spend so far for the capability study and the skill bench. */
function logCredits(ctx) {
  const c = ctx.cfg;
  const V = studyDir(c);
  if (!V) return;
  const [cr, runs, usd, jc] = creditLine([V]);
  ctx.say(`credits so far (no cap set): capability study ${cr} credits over ${runs} runs; capability judge USD ${usd} over ${jc} live calls`);
  const sbv = readTrim(c.sbStudyfile);
  if (sbv) {
    const [scr, sruns, scu, sjc] = creditLine([sbv]);
    ctx.say(`credits so far: skill bench ${scr} credits over ${sruns} runs; skill bench judge USD ${scu} over ${sjc} live calls`);
  }
}

module.exports = { globRe, studyDir, capDirs, capDirsKind, globIn, logCredits };
