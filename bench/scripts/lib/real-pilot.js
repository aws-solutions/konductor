// SPDX-License-Identifier: Apache-2.0
'use strict';

// The reads run-real-pilot.sh makes of one pilot task dir (summary.json, run-config.json, credit-ledger.jsonl). They
// were an inline node -e program in the script (D-213); the outputs are the same lines it printed. Read only.

const fs = require('node:fs');
const path = require('node:path');

const rd = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }; // missing or torn: null
/** The ledger lines of `dir` (its own credit-ledger.jsonl only); torn lines are left out. */
function ledgerOf(dir) {
  let t = '';
  try { t = fs.readFileSync(path.join(dir, 'credit-ledger.jsonl'), 'utf8'); } catch { return []; }
  return t.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}
const summaryOf = (dir) => rd(path.join(dir, 'summary.json'));

/** Sorted unique arm labels of the dir's runs, comma-joined; null when there is no summary. */
function labels(dir) {
  const s = summaryOf(dir);
  return s ? [...new Set(s.results.map((r) => r.armLabel))].sort().join(',') : null;
}

/** The status counts and the null-credit, censored and infra-error run counts, or '-' with no summary. */
function stats(dir) {
  const s = summaryOf(dir);
  if (!s) return '-';
  const nullCr = s.results.filter((r) => r.credits == null && !r.creditsCensored).length;
  const cens = s.results.filter((r) => r.creditsCensored).length;
  const infra = s.results.filter((r) => r.infraError).length;
  return `${JSON.stringify(s.counts)} nullCredits=${nullCr} censored=${cens} infra=${infra}`;
}

/** Seconds from the summary's startedAt to finishedAt; null with no summary. */
function duration(dir) {
  const s = summaryOf(dir);
  return s ? Math.round((Date.parse(s.finishedAt) - Date.parse(s.startedAt)) / 1000) : null;
}

/** Epoch seconds of run-config.json startedAt; null with no run config. */
function started(dir) {
  const c = rd(path.join(dir, 'run-config.json'));
  return c ? Math.round(Date.parse(c.startedAt) / 1000) : null;
}

/** 'total runs nullCredits' over the run lines of each dir's own ledger (charged, else credits). */
function credits(dirs) {
  let tot = 0; let runs = 0; let nul = 0;
  for (const d of dirs) {
    for (const e of ledgerOf(d)) {
      if (e.kind !== 'run') continue;
      runs++;
      if (e.credits == null && !e.censored) nul++;
      tot += Number(e.charged ?? e.credits ?? 0) || 0;
    }
  }
  return `${tot.toFixed(2)} ${runs} ${nul}`;
}

/**
 * The smoke checks of one smoke run dir, as 'ok   ...' and 'FAIL ...' lines and a closing 'RESULT {json}' line.
 * `kind` (real, auton, probe, or another) adds that kind's checks; `engine` and `model` are the pinned values.
 * Returns { lines, ok }.
 */
function smoke(dir, kind, engine, model) {
  const s = summaryOf(dir);
  if (!s) return { lines: ['FAIL no summary.json'], ok: false };
  const lines = [];
  let fails = 0;
  const ok = (c, m) => { lines.push(`${c ? 'ok   ' : 'FAIL '}${m}`); if (!c) fails++; };
  const r = s.results[0] || {};
  ok(s.results.length === 1, `one run recorded (${s.results.length})`);
  ok(!s.interrupted, 'summary not interrupted');
  ok(s.isolationGate && s.isolationGate.ok === true, 'isolation gate ok (installs unchanged)');
  ok(r.agentEngine === engine && s.agentEngine === engine, `engine ${engine} (${r.agentEngine})`);
  ok(r.sessionModel === model || r.model === model, `model pinned ${model} (session ${r.sessionModel})`);
  ok(!r.infraError && !(r.flags || []).includes('modelMismatch'), `no infra error / model mismatch (status ${r.status}, flags ${JSON.stringify(r.flags)})`);
  ok(typeof r.credits === 'number' && r.credits > 0, `credits captured: ${r.credits} (censored ${r.creditsCensored})`);
  const led = ledgerOf(dir).filter((e) => e.kind === 'run');
  ok(led.length === 1 && typeof led[0].credits === 'number', `ledger line has credits: ${JSON.stringify(led[0] && led[0].credits)}`);
  ok(r.wallClockMs > 0, `wall clock ${r.wallClockMs} ms`);
  ok(Object.hasOwn(r, 'skillsLoaded') && Object.hasOwn(r, 'orch') && Object.hasOwn(r, 'sopsLoaded') && Object.hasOwn(r, 'capInvocation'), `skill/orch metric fields present (skillsLoaded=${JSON.stringify(r.skillsLoaded)}, orch=${r.orch ? 'record' : r.orch})`);
  if (kind === 'real') {
    ok(r.hiddenTests && r.hiddenTests.total > 0, `target (FAIL_TO_PASS) tests ran: ${JSON.stringify(r.hiddenTests)}`);
    ok(r.regressionTests && r.regressionTests.total > 0, `regression (PASS_TO_PASS) tests ran: ${JSON.stringify(r.regressionTests)}`);
    ok(r.contamination && Object.hasOwn(r.contamination, 'externalFetch') && Object.hasOwn(r.contamination, 'fixRecallChars'), `contamination check ran: ${JSON.stringify(r.contamination)}`);
    ok(Array.isArray(r.checks) && r.checks.length > 0, `checks recorded: ${(r.checks || []).map((c) => `${c.type}:${c.ok ?? c.passed}`).join(',')}`);
    const rc = rd(path.join(dir, 'run-config.json'));
    ok(rc && rc.real && rc.real.cache, `real cache used offline: ${rc && rc.real && rc.real.cache}`);
  }
  if (kind === 'auton' || kind === 'probe') {
    ok(Object.hasOwn(r, 'turns') && Object.hasOwn(r, 'interjections') && Object.hasOwn(r, 'questions'), 'autonomy fields present');
  }
  if (kind === 'probe') {
    ok(r.turns === 2 && r.interjections === 1, `resume exercised: turns=${r.turns} interjections=${r.interjections} sessionId=${r.sessionId}`);
    ok(Array.isArray(r.checks) && r.checks.length > 0 && r.checks.every((c) => c.passed === true), 'resumed turn kept context (hello.txt check passed)');
    const sid = new Set();
    for (const n of [1, 2]) {
      let text = '';
      try { text = fs.readFileSync(path.join(dir, r.armId || 'vanilla', r.taskId, '1', `stream-${n}.jsonl`), 'utf8'); } catch { /* a missing turn stream holds no id */ }
      for (const l of text.split('\n')) { const m = l.match(/"sessionId":"(sess_[^"]+)"/); if (m) sid.add(m[1]); }
    }
    ok(sid.size === 1, `same session id on both turns (${[...sid].join(',')})`);
  }
  const keys = ['status', 'credits', 'wallClockMs', 'hiddenTests', 'regressionTests', 'askedUser', 'turns', 'interjections', 'questionsAsked', 'unmatchedQuestions', 'autonomous', 'completedWithoutHelp', 'intendedTests', 'invariantTests', 'contamination', 'flags'];
  lines.push(`RESULT ${JSON.stringify(Object.fromEntries(keys.map((k) => [k, r[k]])))}`);
  return { lines, ok: fails === 0 };
}

module.exports = { labels, stats, duration, started, credits, smoke };
