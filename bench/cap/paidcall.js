// SPDX-License-Identifier: Apache-2.0
'use strict';

// One spend-checked model call for the paid keep-or-prune steps (writing a unit baseline, and the pilot run): a
// one-turn `kiro-cli chat` with no tools, in a scratch HOME with only the sign-in copied in (no steering, skills, MCP
// or rules). The owner's spend rule: every call counts at the larger of 15 credits and its real credits, and the
// ledger is read before every call, which is refused when spent plus 15 would pass the cap. A call stopped before it
// reported credits counts at 15. Calls are saved by their output prefix, so a rerun reads a finished call back free.
// The read, the check and the reservation run under a lock on the ledger, so parallel callers cannot both pass the cap.
// kiro-cli gets the runner's env allowlist (runner/lib/env.js), never the host env; BENCH_PAID_ENV_KEEP adds names.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseStream, aggregateStream } = require('../runner/lib/stream.js');
const sb = require('../runner/lib/sandbox.js');
const { buildChildEnv } = require('../runner/lib/env.js');
const { withFileLock } = require('../runner/lib/file-lock.js');

/** The owner's rule: the credits each paid call is counted at, at least. */
const WORST_PER_CALL = 15;
const TIMEOUT_MS = 25 * 60 * 1000;

class PaidCallRefused extends Error {}

/** Credits counted so far in the ledger (one JSON line per call, field `counted`); 0 when the file does not exist. */
function ledgerSpent(file) {
  if (!fs.existsSync(file)) return 0;
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).reduce((s, l) => s + Number(JSON.parse(l).counted), 0);
}

/** Throws unless `dir` is absolute and outside the home folder (work dirs hold sign-in copies and scratch homes). */
function assertOutsideHome(dir, home = os.homedir()) {
  // The real path of the nearest existing folder, so a link such as /home/me -> /local/home/me cannot hide the home.
  const real = (p) => { let a = path.resolve(p); const rest = []; while (!fs.existsSync(a)) { rest.unshift(path.basename(a)); a = path.dirname(a); } return path.join(fs.realpathSync(a), ...rest); };
  const inside = (h) => !path.relative(real(h), real(dir)).startsWith('..');
  if (!path.isAbsolute(dir) || inside(home)) throw new Error(`work dir ${dir} must be an absolute path outside ${home} (for example under /var/tmp)`);
}

const CREDENTIAL_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|COOKIE|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|AUTH|SESSION)/i;

/** The env of one paid call: the agent allowlist, plus BENCH_PAID_ENV_KEEP names. Throws on a credential-like name. */
function paidEnv(baseEnv, home, tmpdir) {
  const keep = (baseEnv.BENCH_PAID_ENV_KEEP || '').split(',').map((n) => n.trim()).filter(Boolean);
  const bad = keep.filter((n) => CREDENTIAL_NAME.test(n));
  if (bad.length) throw new Error(`BENCH_PAID_ENV_KEEP names ${bad.join(', ')}, which looks like a credential; it is never passed to a paid call`);
  const { env } = buildChildEnv(baseEnv, { home, tmpdir, agentEngine: baseEnv.KIRO_AGENT_ENGINE, keep, konductor: false });
  if (env.KIRO_AGENT_ENGINE === undefined) delete env.KIRO_AGENT_ENGINE;
  return env;
}

/** The counted credits of one call: the larger of 15 and the real credits, or 15 when the call never reported them. */
const countedOf = (real, finished) => (finished && Number.isFinite(real) ? Math.max(WORST_PER_CALL, real) : WORST_PER_CALL);

/**
 * Makes one call, or reads it back when `<out>.json` exists. Returns { model, text, real, counted, resumed }.
 * @param {object} o
 * @param {string} o.model the kiro-cli model id
 * @param {string} o.prompt the whole prompt
 * @param {string} o.out output prefix: `<out>.json` (the reply), `.stream.jsonl`, `.err`, and `.refused` on a refusal
 * @param {string} o.ledger the spend ledger file; a line is appended for every call made
 * @param {number} o.cap the hard cap in credits: a call is refused when spent + 15 would pass it
 * @param {string} o.workDir where the scratch HOME goes, outside the home folder
 * @param {string} [o.bin] the kiro-cli binary (tests point it at a stub)
 * @param {string} [o.authDb] the sign-in database copied into the scratch HOME
 * @param {string} [o.label] a name for the ledger line
 * Throws PaidCallRefused on the cap, and Error when the call ran (and was counted) but gave no finished reply.
 */
function paidCall({ model, prompt, out, ledger, cap, workDir, bin = 'kiro-cli', authDb = sb.defaultAuthDb(), label = path.basename(out), timeoutMs = TIMEOUT_MS }) {
  const done = `${out}.json`;
  if (fs.existsSync(done)) return { ...JSON.parse(fs.readFileSync(done, 'utf8')), resumed: true };
  if (!(cap > 0)) throw new Error('a paid call needs a cap in credits (--cap N)');
  assertOutsideHome(workDir);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  paidEnv(process.env, workDir, workDir); // refuses a bad BENCH_PAID_ENV_KEEP before anything is reserved
  fs.mkdirSync(workDir, { recursive: true });
  // The reservation is written before the call, so a kill during it (Ctrl-C, SIGKILL, a reboot) still leaves the call
  // counted at 15; the settle line after it adds the real credits above 15. The ledger never under-counts.
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  const at = new Date().toISOString();
  withFileLock(`${ledger}.lock`, () => {
    const spent = ledgerSpent(ledger);
    if (spent + WORST_PER_CALL > cap) {
      const why = `refused before calling ${model}: spent ${spent} + worst ${WORST_PER_CALL} would pass the cap ${cap}`;
      fs.writeFileSync(`${out}.refused`, `${why}\n`);
      throw new PaidCallRefused(why);
    }
    fs.appendFileSync(ledger, `${JSON.stringify({ label, model, counted: WORST_PER_CALL, reserved: true, at })}\n`);
  });
  const home = fs.mkdtempSync(path.join(workDir, 'home-'));
  const cwd = path.join(home, 'cwd');
  const tmpdir = path.join(home, 'tmp');
  let r;
  try {
    for (const d of [cwd, tmpdir]) fs.mkdirSync(d, { recursive: true });
    sb.emptyKiroHome(home);
    sb.copyAuthDb(authDb, home);
    r = spawnSync(bin, ['chat', '--no-interactive', '--trust-tools=', '--model', model, '--output-format', 'stream-json', prompt], {
      cwd, env: paidEnv(process.env, home, tmpdir), encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024,
    });
  } finally {
    sb.removeAuthCopy(home);
    fs.rmSync(home, { recursive: true, force: true });
  }
  fs.writeFileSync(`${out}.stream.jsonl`, r.stdout ?? '');
  fs.writeFileSync(`${out}.err`, `${r.stderr ?? ''}${r.error ? `\n${r.error.message}\n` : ''}`);
  const agg = aggregateStream(parseStream(r.stdout ?? '').events);
  const finished = agg.runFinishedStatus === 'success' && agg.meteringEntries > 0;
  const counted = countedOf(agg.credits, finished);
  fs.appendFileSync(ledger, `${JSON.stringify({ label, model, counted: counted - WORST_PER_CALL, settles: at, callCounted: counted, real: agg.meteringEntries ? agg.credits : null, rc: r.status, finished, at: new Date().toISOString() })}\n`);
  if (!finished || !agg.finalText) throw new Error(`${label}: ${model} gave no finished reply (exit ${r.status}); counted ${counted} credits, see ${out}.err`);
  const reply = { model, text: agg.finalText, real: agg.credits, counted };
  fs.writeFileSync(done, `${JSON.stringify(reply, null, 2)}\n`);
  return { ...reply, resumed: false };
}

/** The first {...} of a reply, parsed; throws when there is none. */
function jsonOf(text) {
  const m = /\{[\s\S]*\}/.exec(String(text));
  if (!m) throw new Error(`no JSON object in the reply: ${String(text).slice(0, 200)}`);
  return JSON.parse(m[0]);
}

/** A reply that ran (and was counted) but could not be read; its saved file was moved aside, so a re-ask makes a new call. */
class ReplyUnreadable extends Error {}

/**
 * paidCall, then `parse(json)` of the reply. When the reply cannot be read, its saved file is moved aside
 * (`<out>.bad-<n>.json`), so a rerun asks again (and counts again), and the error is thrown.
 */
function paidJson(o, parse) {
  const r = paidCall(o);
  try {
    return { ...r, value: parse(jsonOf(r.text)) };
  } catch (e) {
    let n = 1;
    while (fs.existsSync(`${o.out}.bad-${n}.json`)) n += 1;
    fs.renameSync(`${o.out}.json`, `${o.out}.bad-${n}.json`);
    throw new ReplyUnreadable(`${path.basename(o.out)}: the reply of ${o.model} could not be read (${e.message}); kept as ${path.basename(o.out)}.bad-${n}.json, a rerun asks again`);
  }
}

module.exports = { WORST_PER_CALL, PaidCallRefused, ReplyUnreadable, ledgerSpent, assertOutsideHome, countedOf, paidCall, jsonOf, paidJson };
