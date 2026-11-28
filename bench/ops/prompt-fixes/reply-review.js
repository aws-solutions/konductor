// SPDX-License-Identifier: Apache-2.0
'use strict';

// The paid half of the reply check (reply-check.js review and compare): the Claude reviewer and the non-Claude panel
// read the same frozen prompts, each call checked against its ledger first, and the side-by-side report.

const fs = require('node:fs');
const path = require('node:path');
const { loadObserved } = require('../../judge/observed-cost.js');
const { paidJson, ledgerSpent, PaidCallRefused, WORST_PER_CALL } = require('../../cap/paidcall.js');
const { readJsonl } = require('../../core/spend.js');
const { spent: runsSpent } = require('./study.js');
const { expectationsFor, checkReview, panelCallUsd, readManifest, sha256, PANEL, MANIFEST } = require('./reply-manifest.js');

class Refused extends Error {}

/** The highest real credits one call in a Claude ledger cost, or 0. */
function highestReal(file) {
  return readJsonl(file).entries.reduce((m, e) => (Number.isFinite(e.real) && e.real > m ? e.real : m), 0);
}

const validated = (taskId) => (v) => {
  const c = checkReview(v, taskId);
  if (!c.ok) throw new Error(c.error);
  return c.value;
};

/**
 * The paid review of every prompt in `promptsDir` (its manifest), in name order: one Claude call (`claudeModel`, kiro-cli
 * through paidJson, counted at max(15, real)), then one call per `panel` judge through `panelCaller` ({model, prompt} ->
 * {text, usd, error}). Before each Claude call, the runs' spend under `runsDir` plus the Claude ledger plus the call's
 * worst case (15, or the highest real cost so far) must stay within `capCredits`. Before each panel call, the panel
 * ledger plus that call's high estimate must stay within `capUsd`; the estimate is reserved in the ledger and settled
 * at the real USD after the call (the estimate stays when the call reported none). A reply that cannot be read is asked
 * once more; after the second miss the output gets a `.failed` file and the next one goes on. A refusal throws
 * Refused; a rerun reads finished calls back and calls nothing for them. A prompt whose bytes differ from its manifest
 * sha256 stops the review.
 */
async function review({ promptsDir, out, claudeModel, capCredits, runsDir, capUsd, workDir, kiroBin, authDb, panelCaller, panel = PANEL, observed = loadObserved(), log = console.log }) {
  if (/claude|anthropic/i.test(panel.join(' '))) throw new Error('the panel must not hold a Claude model');
  if (!/claude/i.test(claudeModel)) throw new Error(`--claude ${claudeModel} is not a Claude model`);
  const m = readManifest(promptsDir);
  const names = Object.keys(m.entries).sort();
  if (!names.length) throw new Error(`no prompts in ${promptsDir}`);
  const cl = path.join(out, 'claude-ledger.jsonl');
  const pl = path.join(out, 'panel-ledger.jsonl');
  fs.mkdirSync(out, { recursive: true });
  const usdSpent = () => Math.round(readJsonl(pl).entries.reduce((a, e) => a + Number(e.usd ?? 0), 0) * 1e6) / 1e6;
  const done = { claude: 0, panel: 0, failed: 0 };
  for (const name of names) {
    const e = m.entries[name];
    const prompt = fs.readFileSync(path.join(promptsDir, e.file), 'utf8');
    if (sha256(prompt) !== e.sha256) throw new Error(`${e.file} changed since it was frozen (sha256 differs from ${MANIFEST})`);
    const prefix = path.join(out, claudeModel, name);
    for (let attempt = 1; attempt <= 2 && !fs.existsSync(`${prefix}.json`) && !fs.existsSync(`${prefix}.failed`); attempt++) {
      const r = runsSpent(runsDir);
      if (r.unknown) throw new Refused(`REFUSED Claude ${name}: the run ledgers have ${r.unknown} entr(y/ies) of unknown cost`);
      const spent = Math.round((r.credits + ledgerSpent(cl)) * 100) / 100;
      const worst = Math.max(WORST_PER_CALL, highestReal(cl));
      if (spent + worst > capCredits) throw new Refused(`REFUSED Claude ${name}: ${spent} spent of the ${capCredits} cap leaves no room for its worst case ${worst}`);
      try {
        paidJson({ model: claudeModel, prompt, out: prefix, ledger: cl, cap: capCredits - r.credits, workDir, bin: kiroBin, authDb, label: `claude ${name}` }, validated(e.taskId));
        done.claude++;
        log(`Claude ${name}: ok (${spent} spent before it)`);
      } catch (err) {
        if (err instanceof PaidCallRefused) throw new Refused(`REFUSED Claude ${name}: ${err.message}`);
        log(`Claude ${name}: try ${attempt} failed: ${err.message}`);
        if (attempt === 2) { fs.writeFileSync(`${prefix}.failed`, `${err.message}\n`); done.failed++; }
      }
    }
    for (const judge of panel) {
      const f = path.join(out, judge, `${name}.json`);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      const high = panelCallUsd(judge, e.kchars, observed).high;
      for (let attempt = 1; attempt <= 2 && !fs.existsSync(f) && !fs.existsSync(`${f.slice(0, -5)}.failed`); attempt++) {
        const spent = usdSpent();
        if (spent + high > capUsd) throw new Refused(`REFUSED ${judge} ${name}: USD ${spent} spent of ${capUsd} leaves no room for its high estimate ${high.toFixed(6)}`);
        const at = new Date().toISOString();
        fs.appendFileSync(pl, `${JSON.stringify({ label: `${judge} ${name}`, model: judge, usd: high, reserved: true, at })}\n`);
        let res;
        try { res = await panelCaller({ model: judge, prompt }); } catch (err) { res = { error: err.message }; }
        const real = Number.isFinite(res?.usd) ? res.usd : high;
        fs.appendFileSync(pl, `${JSON.stringify({ label: `${judge} ${name}`, model: judge, usd: real - high, settles: at, real: Number.isFinite(res?.usd) ? res.usd : null, error: res?.error ?? null })}\n`);
        let value = null;
        let why = res?.error ?? null;
        if (!why) { try { value = validated(e.taskId)(jsonOf(res.text)); } catch (err) { why = err.message; } }
        if (value) { fs.writeFileSync(f, `${JSON.stringify({ model: judge, text: res.text, usd: real, value }, null, 2)}\n`); done.panel++; continue; }
        log(`${judge} ${name}: try ${attempt} failed: ${why}`);
        if (attempt === 2) { fs.writeFileSync(`${f.slice(0, -5)}.failed`, `${why}\n`); done.failed++; }
      }
    }
  }
  log(`review: ${done.claude} Claude and ${done.panel} panel replies this run, ${done.failed} failed; credits ${Math.round((runsSpent(runsDir).credits + ledgerSpent(cl)) * 100) / 100} of ${capCredits}, USD ${usdSpent()} of ${capUsd}`);
  return done;
}

function jsonOf(text) {
  const m = /\{[\s\S]*\}/.exec(String(text ?? ''));
  if (!m) throw new Error('no JSON object in the reply');
  return JSON.parse(m[0]);
}

/** One reviewer's verdicts for an output: { E1: 'met', ..., decision } or null when it has none. */
function verdictsIn(file, taskId) {
  if (!fs.existsSync(file)) return null;
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  let v = j.value;
  if (!v) { try { v = jsonOf(j.text); } catch { return null; } }
  if (!checkReview(v, taskId).ok) return null;
  return { ...Object.fromEntries(v.checks.map((c) => [c.id, c.verdict])), decision: v.decisionInOtherWords };
}

/** The verdict two or more of `votes` share, else 'split' (or '-' when no judge answered). */
function majority(votes) {
  const got = votes.filter(Boolean);
  if (!got.length) return '-';
  for (const v of new Set(got)) if (got.filter((x) => x === v).length >= 2) return v;
  return 'split';
}

/**
 * The side-by-side report: per output and check, the deterministic score, the Claude reviewer, each panel judge and the
 * panel majority (the verdict), with a flag where Claude or the score differs from the majority, or the panel splits.
 * Then per check the met counts. The Claude reviewer is the one model folder under `reviewsDir` named claude-*.
 */
function compare({ promptsDir, reviewsDir, panel = PANEL }) {
  const m = readManifest(promptsDir);
  const claude = fs.readdirSync(reviewsDir).find((d) => /^claude/.test(d) && fs.statSync(path.join(reviewsDir, d)).isDirectory()) ?? null;
  const rows = [`| output | check | score | ${claude ?? 'Claude'} | ${panel.join(' | ')} | panel | flag |`, `|---|---|---|---|${panel.map(() => '---').join('|')}|---|---|`];
  const sum = {};
  const decisions = ['| output | Claude says | panel says |', '|---|---|---|'];
  for (const name of Object.keys(m.entries).sort()) {
    const e = m.entries[name];
    const c = claude ? verdictsIn(path.join(reviewsDir, claude, `${name}.json`), e.taskId) : null;
    const p = panel.map((j) => verdictsIn(path.join(reviewsDir, j, `${name}.json`), e.taskId));
    for (const { id } of expectationsFor(e.taskId)) {
      const votes = p.map((x) => x?.[id] ?? null);
      const maj = majority(votes);
      const flags = [];
      if (maj === 'split') flags.push('panel split');
      if (c && maj !== 'split' && maj !== '-' && c[id] !== maj) flags.push('Claude differs');
      if (e.score?.[id] && maj !== 'split' && maj !== '-' && e.score[id] !== maj) flags.push('score differs');
      rows.push(`| ${name} | ${id} | ${e.score?.[id] ?? '-'} | ${c?.[id] ?? '-'} | ${votes.map((v) => v ?? '-').join(' | ')} | ${maj} | ${flags.join(', ')} |`);
      const s = (sum[id] ??= { panel: 0, claude: 0, score: 0, n: 0, flagged: 0 });
      s.n++;
      if (maj === 'met') s.panel++;
      if (c?.[id] === 'met') s.claude++;
      if (e.score?.[id] === 'met') s.score++;
      if (flags.length) s.flagged++;
    }
    decisions.push(`| ${name} | ${c?.decision ?? '-'} | ${majority(p.map((x) => x?.decision ?? null))} |`);
  }
  const totals = ['| check | panel met (verdict) | Claude met | score met | flagged |', '|---|---|---|---|---|'];
  for (const [id, s] of Object.entries(sum).sort()) totals.push(`| ${id} | ${s.panel} of ${s.n} | ${s.claude} of ${s.n} | ${s.score} of ${s.n} | ${s.flagged} |`);
  return `# Reply check: both reviewers side by side\n\nThe panel majority is the verdict. Claude and the deterministic score are shown beside it; a flag marks each disagreement.\n\n${totals.join('\n')}\n\n## Each output\n\n${rows.join('\n')}\n\n## The decision in the agent's own words\n\n${decisions.join('\n')}\n`;
}

/** The panel caller: --panel-module F (a test stub exporting makeCaller), else the opencode judge backend on Bedrock. */
function panelCallerOf(opts) {
  const entry = opts['panel-module'] ? path.resolve(opts['panel-module']) : (() => {
    const { backendRegistry, OPENCODE_BACKEND } = require('../../judge/backends.js');
    return backendRegistry().part(OPENCODE_BACKEND).entry;
  })();
  const flags = { 'aws-export-profile': opts['aws-export-profile'] ?? 'default', ...(opts.cache ? { cache: opts.cache } : {}) };
  return require(entry).makeCaller({ timeoutMs: 600000, flags, log: console.log });
}

module.exports = { review, compare, majority, panelCallerOf, Refused };
