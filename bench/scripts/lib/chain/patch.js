// SPDX-License-Identifier: Apache-2.0
'use strict';

// P2 PATCH: apply the patches to a clean checkout in order, run the bench suite, and either make one local commit per
// patch or revert every patch (git apply -R, newest first). Nothing is pushed or force-applied.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ts, stripNl } = require('./context.js');
const { nap, runChild, newScratch, dropScratch, scratchEnv, benchProcs, pilotState, runSyncTo } = require('./proc.js');

const git = (repo, args, o = {}) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', ...o });
const gitOut = (repo, args) => String(git(repo, args).stdout || '');
const benchStatus = (repo) => gitOut(repo, ['status', '--porcelain', 'bench/']).replace(/\n+$/, '');
const head5 = (s, n = 5) => stripNl(s.split('\n').slice(0, n).join('\n'));
const patchName = (p) => path.basename(p);

/** The files a patch touches (git apply --numstat, third column). */
function patchFiles(repo, p) {
  return gitOut(repo, ['apply', '--numstat', p]).split('\n').filter(Boolean).map((l) => l.split('\t')[2]);
}

/** Whether every patch reverts cleanly, newest first. */
function revertCheck(c) {
  return [...c.patchList].reverse().every((p) => git(c.repo, ['apply', '-R', '--check', p]).status === 0);
}

/** git apply -R every patch, newest first, output to the log; false on the first failure. */
function revertAll(c) {
  return [...c.patchList].reverse().every((p) => runSyncTo(c.log, 'git', ['-C', c.repo, 'apply', '-R', p]) === 0);
}

function rollback(ctx, st) {
  const c = ctx.cfg;
  if (!st.applied) return;
  ctx.say('P2: ROLLBACK: reverting every patch with git apply -R to restore the clean tree');
  if (revertAll(c)) {
    st.applied = false;
    const dirty = benchStatus(c.repo);
    if (!dirty) ctx.say('P2: rollback complete: bench/ is clean');
    else ctx.say(`P2: WARNING rollback finished but bench/ is not clean: ${head5(dirty)}`);
  } else {
    ctx.say(`P2: WARNING: git apply -R failed; the tree may still hold the patches. Inspect with: git -C ${c.repo} status --porcelain bench/`);
  }
}

/** The commit message of a patch: <patch>.msg, else its mail header, else 'bench: apply <name>'. */
function commitMessage(c, patch) {
  if (fs.existsSync(`${patch}.msg`)) return fs.readFileSync(`${patch}.msg`, 'utf8');
  const md = fs.mkdtempSync(path.join(c.scratchParent, 'ac-tmp.mi.'));
  try {
    const info = spawnSync('git', ['mailinfo', path.join(md, 'body'), path.join(md, 'patch')], { input: fs.readFileSync(patch), encoding: 'utf8', cwd: c.repo });
    const subject = (/^Subject: (.*)$/m.exec(String(info.stdout || '')) || [])[1] || '';
    if (subject) return `${subject}\n\n${fs.readFileSync(path.join(md, 'body'), 'utf8')}`;
    return `bench: apply ${patchName(patch)}\n`;
  } finally { fs.rmSync(md, { recursive: true, force: true }); }
}

/** The first public-hygiene marker in the messages; null when none; undefined when the checkout has no scanner. */
function messageMarker(repo, messages) {
  let m;
  try { m = require(path.join(path.resolve(repo), 'bench/cap/public.js')); } catch { return undefined; }
  for (const t of messages) { const h = m.findMarker(t); if (h) return h.marker; }
  return null;
}

/** Gate 1: the study is stopped and no bench.js runs (a short grace for its last child). 0, 1 or 130. */
async function gateIdle(ctx) {
  const c = ctx.cfg;
  const ps = pilotState(ctx);
  if (ps.alive) return ctx.fail(`the capability study is still running (pid ${ps.pid}); refusing to touch the checkout`);
  for (let n = 1; n <= 10; n++) {
    const procs = benchProcs(ctx);
    if (procs.length === 0) break;
    if (n === 1) ctx.say(`P2: a bench.js process is still running; waiting up to 5 min for it to exit: ${stripNl(procs.slice(0, 2).join('\n'))}`);
    await nap(ctx, c.benchGraceS);
    if (ctx.stopping) return 130;
  }
  const procs = benchProcs(ctx);
  if (procs.length) return ctx.fail(`a bench.js process is running: ${stripNl(procs.slice(0, 2).join('\n'))}. Not touching the checkout.`);
  return 0;
}

/** The checkout is on the right branch with bench/ clean (an interrupted earlier apply is reverted first). */
function gateClean(ctx, st) {
  const c = ctx.cfg;
  const br = gitOut(c.repo, ['branch', '--show-current']).trim();
  if (!br) return { rc: ctx.fail('the checkout is on a detached HEAD; commits need a branch') };
  if (c.branch && br !== c.branch) return { rc: ctx.fail(`the checkout is on branch '${br}', expected ${c.branch}`) };
  const head = gitOut(c.repo, ['rev-parse', '--short=8', 'HEAD']).trim();
  if (benchStatus(c.repo) && revertCheck(c)) {
    ctx.say('P2: bench/ holds the patches uncommitted (an interrupted earlier run); reverting them to restore a clean tree, then redoing the phase');
    st.applied = true;
    rollback(ctx, st);
  }
  const dirty = benchStatus(c.repo);
  if (dirty) return { rc: ctx.fail(`bench/ is not clean on ${br} (${head5(dirty)}). Chain stopped; nothing was applied.`) };
  return { rc: 0, br, head };
}

/** Apply every patch after one --check pass over all of them. */
function applyAll(ctx, st, head) {
  const c = ctx.cfg;
  const checkFd = fs.openSync(c.log, 'a');
  let ok = true;
  for (const p of c.patchList) {
    if (spawnSync('git', ['apply', '--check', p], { cwd: c.repo, stdio: ['ignore', checkFd, checkFd] }).status !== 0) { ok = false; break; }
  }
  fs.closeSync(checkFd);
  if (!ok) return ctx.fail(`git apply --check failed for a patch on ${head} (see ${c.log}). Nothing was applied.`);
  ctx.say(`P2: git apply --check passed for: ${c.patchList.map(patchName).join(' ')} `);
  st.applied = true;
  for (const p of c.patchList) {
    if (runSyncTo(c.log, 'git', ['apply', p], { cwd: c.repo }) !== 0) {
      rollback(ctx, st);
      return ctx.fail(`applying ${patchName(p)} failed after the check passed (see ${c.log}); rolled back`);
    }
  }
  return 0;
}

const lastCount = (text, word) => {
  const all = [...text.matchAll(new RegExp(`^(?:# |\u2139 )${word} (\\d+)`, 'gm'))];
  return all.length ? all[all.length - 1][1] : '';
};

/** The bench suite in a scratch HOME. Returns { rc, info } or { rc: 130 }. */
async function runSuite(ctx, st) {
  const c = ctx.cfg;
  fs.writeFileSync(c.p2TestLog, '');
  let s;
  try { s = newScratch(ctx); } catch { dropScratch(ctx); rollback(ctx, st); return { rc: ctx.fail('cannot create scratch dirs') }; }
  const rc = await runChild(ctx, 'timeout', ['-s', 'TERM', '-k', '60', c.testTimeoutS, 'node', '--test', 'bench/runner/test/*.test.js'],
    { out: c.p2TestLog, cwd: c.repo, env: scratchEnv(s) });
  dropScratch(ctx);
  if (ctx.stopping) { rollback(ctx, st); return { rc: 130 }; }
  const log = fs.readFileSync(c.p2TestLog, 'utf8');
  const [total, pass, fail, skipped] = ['tests', 'pass', 'fail', 'skipped'].map((w) => lastCount(log, w));
  const info = `tests ${total || '?'}, pass ${pass || '?'}, fail ${fail || '?'}, skipped ${skipped || '?'}, exit ${rc}`;
  ctx.stSet('P2_tests', info);
  ctx.say(`P2: bench suite result: ${info}`);
  if (rc !== 0 || !total || fail !== '0' || Number(total) <= 0) {
    rollback(ctx, st);
    return { rc: ctx.fail(`the bench suite did not pass (${info}; log ${c.p2TestLog}). Every patch was reverted; the checkout is clean again.`) };
  }
  return { rc: 0, info };
}

/** One local commit per patch, in order, files staged by name. */
function commitAll(ctx, st) {
  const c = ctx.cfg;
  let msgs;
  try { msgs = c.patchList.map((p) => commitMessage(c, p)); } catch {
    rollback(ctx, st);
    return ctx.fail('cannot read the mail header of a patch');
  }
  const marker = messageMarker(c.repo, msgs);
  if (marker === undefined) ctx.say(`P2: note: bench/cap/public.js not found in ${c.repo}; the commit message hygiene check is skipped`);
  else if (marker) { rollback(ctx, st); return ctx.fail(`a commit message matches the public-hygiene marker '${marker}'; patches reverted`); }
  const mdir = fs.mkdtempSync(path.join(c.scratchParent, 'ac-tmp.msg.'));
  try {
    for (const [i, p] of c.patchList.entries()) {
      const files = patchFiles(c.repo, p);
      const undo = (why) => { git(c.repo, ['restore', '--staged', '--', '.']); if (i === 0) rollback(ctx, st); return ctx.fail(why); };
      if (git(c.repo, ['add', '--', ...files], { stdio: 'ignore' }).status !== 0) {
        if (i === 0) rollback(ctx, st);
        return ctx.fail(`git add failed for ${patchName(p)}`);
      }
      const got = gitOut(c.repo, ['diff', '--cached', '--name-only']).split('\n').filter(Boolean).sort();
      if (JSON.stringify([...files].sort()) !== JSON.stringify(got)) return undo(`the staged files differ from the files of ${patchName(p)}; unstaged`);
      const mf = path.join(mdir, `msg${i + 1}`);
      fs.writeFileSync(mf, msgs[i]);
      if (runSyncTo(c.log, 'git', ['-C', c.repo, 'commit', '-q', '-F', mf]) !== 0) return undo(`git commit failed for ${patchName(p)} (see ${c.log}); unstaged`);
      ctx.stSet(`P2_commit${i + 1}`, `${gitOut(c.repo, ['rev-parse', '--short=8', 'HEAD']).trim()} ${gitOut(c.repo, ['log', '-1', '--format=%s']).trim()}`);
      ctx.say(`P2: commit ${i + 1}: ${ctx.stGet(`P2_commit${i + 1}`)}`);
    }
  } finally { fs.rmSync(mdir, { recursive: true, force: true }); }
  st.applied = false;
  return 0;
}

/** P2 PATCH. Returns 0 (done or skipped), 1 failed, 130 stopped. */
async function p2Patch(ctx) {
  const c = ctx.cfg;
  if (c.patchList.length === 0) {
    ctx.say('P2: SKIPPED: no patches given (set PATCHES to a comma list of patch files to run this phase)');
    ctx.stSet('P2_note', 'no patches given');
    ctx.phaseResult = 'skipped';
    return 0;
  }
  if (git(c.repo, ['rev-parse', '--git-dir']).status !== 0) return ctx.fail(`not a git repository: ${c.repo}`);
  for (const p of c.patchList) if (!fs.existsSync(p)) return ctx.fail(`patch file missing: ${p}`);
  const st = { applied: false };
  ctx.p2 = st;
  let rc = await gateIdle(ctx);
  if (rc) return rc;
  const g = gateClean(ctx, st);
  if (g.rc) return g.rc;
  ctx.say(`P2: checkout ${c.repo} on ${g.br} at ${g.head}, bench/ clean, study stopped, no bench.js process`);
  if ((rc = applyAll(ctx, st, g.head))) return rc;
  ctx.stSet('P2_applied', `${ts()} on ${g.head}`);
  ctx.say(`P2: patches applied (uncommitted). Running the bench suite in a scratch HOME (log ${c.p2TestLog})`);
  const suite = await runSuite(ctx, st);
  if (suite.rc) return suite.rc;
  if ((rc = commitAll(ctx, st))) return rc;
  ctx.say(`P2: done: ${suite.info}; ${c.patchList.length} local commit(s), nothing pushed; tree status for bench/: '${head5(benchStatus(c.repo), 3)}'`);
  return 0;
}

/** Read only: whether the patches apply in order to a pristine archive of HEAD. 0 yes, 1 no, 2 could not check. */
function patchesApplyToHead(c) {
  let tmp;
  try { tmp = fs.mkdtempSync(path.join(c.scratchParent, 'ac-tmp.pristine.')); } catch { return 2; }
  try {
    const ar = spawnSync('bash', ['-c', 'set -o pipefail; git -C "$1" archive HEAD | tar -x -C "$2"', '_', c.repo, tmp], { stdio: 'ignore' });
    if (ar.status !== 0) return 2;
    for (const p of c.patchList) {
      if (spawnSync('git', ['apply', '--check', p], { cwd: tmp, stdio: 'ignore' }).status !== 0) return 1;
      if (spawnSync('git', ['apply', p], { cwd: tmp, stdio: 'ignore' }).status !== 0) return 1;
    }
    return 0;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

module.exports = { p2Patch, patchesApplyToHead, rollback, benchStatus, gitOut, git };
