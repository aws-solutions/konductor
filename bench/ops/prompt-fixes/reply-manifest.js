// SPDX-License-Identifier: Apache-2.0
'use strict';

// What both halves of the reply check share (reply-check.js and reply-review.js): the checks per task, the reviewer
// reply's shape, the panel and its USD per call, and the frozen prompt manifest.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EXPECT } = require('../../runner/lib/plan-call.js');
const { loadObserved, lookup } = require('../../judge/observed-cost.js');

const PANEL = ['gpt-5.6-luna', 'deepseek-3.2', 'qwen3-coder-next'];
const VERDICTS = ['met', 'not-met', 'not-reached'];
const MANIFEST = 'manifest.json';

const REVIEW_TEXT = {
  always: 'A reviewer spawn ran on the work.',
  'exempt-or-one': 'A reviewer spawn ran, or the Review gate line names a real exemption.',
};

/** The checks for one task, from expect.json: [{ id, text }]. The plan word and the action are skipped for 'proceed'. */
function expectationsFor(taskId) {
  const e = EXPECT.tasks[taskId];
  if (!e) throw new Error(`${taskId} is not in expect.json`);
  const scored = e.plan === 'solo' || e.plan === 'team';
  const out = [
    { id: 'E1', text: 'The reply has a line `Plan: solo, because ...` or `Plan: team (...), because ...`.' },
    { id: 'E2', text: 'That Plan line comes before the first write, edit or spawn.' },
  ];
  if (scored) out.push({ id: 'E3', text: `The Plan line says ${e.plan} (expected because: ${e.why}).` });
  out.push({ id: 'E4', text: 'A `Skills: <names>` or `Skills: none fit` line comes before the first write, edit or spawn.' });
  if (scored) out.push({ id: 'E5', text: e.plan === 'solo' ? 'The work matches a solo plan: no writer spawn.' : 'The work matches a team plan: 2 or more writer spawns.' });
  out.push({ id: 'E6', text: 'The final reply ends with a `Review gate: ...` line.' });
  if (REVIEW_TEXT[e.review]) out.push({ id: 'E7', text: REVIEW_TEXT[e.review] });
  return out;
}

/** Validates a reviewer reply: every check id once, a known verdict, a decision word. */
function checkReview(v, taskId) {
  const ids = expectationsFor(taskId).map((e) => e.id);
  if (!v || !Array.isArray(v.checks)) return { ok: false, error: 'the reply needs a "checks" array' };
  const got = v.checks.map((c) => c?.id);
  if (ids.some((id) => got.filter((g) => g === id).length !== 1) || got.length !== ids.length) return { ok: false, error: `checks must be exactly ${ids.join(', ')}` };
  if (!v.checks.every((c) => VERDICTS.includes(c.verdict) && typeof c.quote === 'string')) return { ok: false, error: `each verdict is one of ${VERDICTS.join(', ')}, with a quote string` };
  if (!['solo', 'team', 'none'].includes(v.decisionInOtherWords)) return { ok: false, error: 'decisionInOtherWords is solo, team or none' };
  return { ok: true, value: v };
}

/** USD one opencode call of `judge` on a prompt of `kchars` thousand characters may cost: { mid, high } (observed-cost.json). */
function panelCallUsd(judge, kchars, observed = loadObserved()) {
  const e = lookup(observed, 'opencode', judge, 'rubric') ?? lookup(observed, 'opencode', '*', 'rubric');
  const mid = e.perUnit ? e.perUnit.fixed + e.perUnit.perKChar * kchars : e.mean;
  return { mid, high: e.perUnit ? mid * e.perUnit.highRatio : Math.max(e.p90 ?? mid, mid) };
}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const readManifest = (dir) => (fs.existsSync(path.join(dir, MANIFEST)) ? JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8')) : { entries: {} });

module.exports = { expectationsFor, checkReview, panelCallUsd, readManifest, sha256, PANEL, MANIFEST };
