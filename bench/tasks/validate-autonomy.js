// SPDX-License-Identifier: Apache-2.0
'use strict';

// Rules for tasks of class "autonomy", used by validate-tasks.js. Pure functions over a task object and
// the scores measured by the caller, so they can be tested without a fixture on disk.

const fs = require('node:fs');
const path = require('node:path');

// The sentence every other class ends with. An autonomy prompt must leave the agent free to ask.
const NO_QUESTIONS = 'Do not ask me questions; if something is unclear, make a reasonable assumption, list your assumptions in your final message, and finish the work.';
const PROCESS_CRITERIA = ['asks-only-needed', 'states-assumptions', 'no-destructive-before-answer'];
const MAX_CLARIFICATIONS = 4;
const MIN_TIMEOUT = 600;
const MAX_TIMEOUT = 900;
const MIN_PARTIALS = 2;
const HIDDEN_MAX_SECONDS = 60;
// The prompt must not hint at the evaluation, the scripted user, or whether anyone can answer.
const PROMPT_BANNED = /\b(clarif\w*|scripted|hidden|graders?|graded|grading|reviewers?|agents?|subagents?|skills?|benchmarks?|acceptance tests?|answer key|unavailable|available|reachable)\b|\b(do not|don't|no need to|never) ask\b|\bask me\b|\bask (any )?questions?\b|\bI(?:'m| am| will be|'ll be) (?:out|away|offline|online|around|here|on call|in a meeting)\b/i;
const isInt = Number.isInteger;

function compile(keyword) {
  try { return new RegExp(keyword, 'i'); } catch { return null; }
}

// Problems with the task definition itself. opts.hiddenRoot: the tasks/hidden directory.
function shapeProblems(t, { hiddenRoot }) {
  const out = [];
  const bad = (msg) => out.push(msg);
  if (t.class !== 'autonomy') bad('class must be "autonomy" for a task with an autonomy block');
  if (!t.autonomy || typeof t.autonomy !== 'object') {
    bad('an autonomy task needs an autonomy block');
    return out;
  }
  if (!Array.isArray(t.tiers) || !t.tiers.includes('autonomy') || t.tiers.some((x) => x !== 'autonomy' && x !== 'pilot')) bad('tiers must be ["autonomy"] (and optionally "pilot")');
  if (!(isInt(t.timeoutSec) && t.timeoutSec >= MIN_TIMEOUT && t.timeoutSec <= MAX_TIMEOUT)) bad(`timeoutSec must be from ${MIN_TIMEOUT} to ${MAX_TIMEOUT}`);
  if (typeof t.prompt === 'string') {
    if (t.prompt.includes(NO_QUESTIONS)) bad('the prompt must not contain the no-questions sentence');
    const m = t.prompt.match(PROMPT_BANNED);
    if (m) bad(`the prompt mentions "${m[0]}": it must not say whether the user can answer, nor mention clarifications, scripted answers, grading, agents, skills or benchmarks`);
  }
  const ids = new Set((t.rubric || []).map((r) => r.id));
  for (const id of PROCESS_CRITERIA) if (!ids.has(id)) bad(`the rubric needs the process criterion "${id}"`);

  const a = t.autonomy;
  const cl = a.clarifications || [];
  if (cl.length > MAX_CLARIFICATIONS) bad(`at most ${MAX_CLARIFICATIONS} clarifications per task, found ${cl.length}`);
  if (a.noQuestionNeeded === true && cl.length) bad('a noQuestionNeeded task has no clarifications');
  if (a.noQuestionNeeded !== true && !cl.length) bad('a task that needs a question needs at least one clarification');
  const seen = new Set();
  const compiled = [];
  for (const c of cl) {
    if (seen.has(c.id)) bad(`duplicate clarification id "${c.id}"`);
    seen.add(c.id);
    const res = (c.keywords || []).map((k) => ({ k, re: compile(k) }));
    for (const r of res) if (!r.re) bad(`clarification "${c.id}": keyword "${r.k}" does not compile`);
    compiled.push({ id: c.id, res: res.filter((r) => r.re).map((r) => r.re) });
  }
  const examples = t.exampleQuestions;
  if (!Array.isArray(examples) || (cl.length && !examples.length)) {
    bad('exampleQuestions is required: realistic questions an agent would ask, used to test the keywords');
  } else {
    for (const c of compiled) {
      if (!examples.some((q) => c.res.some((re) => re.test(q)))) bad(`clarification "${c.id}" matches none of the example questions`);
    }
    if (a.noQuestionNeeded !== true) {
      for (const q of examples) {
        if (!compiled.some((c) => c.res.some((re) => re.test(q)))) bad(`example question "${q}" matches no clarification`);
      }
    }
  }

  const checks = t.checks || [];
  for (const c of checks) {
    if (c.type === 'tests' && !c.group) bad('every tests check of an autonomy task needs a group (intended or invariant)');
    if (c.type !== 'tests' && c.group !== undefined) bad('group applies to tests checks only');
  }
  for (const group of ['intended', 'invariant']) {
    if (!checks.some((c) => c.type === 'tests' && c.group === group)) bad(`needs a tests check in the ${group} group`);
  }
  const dir = path.join(hiddenRoot, t.hidden || '?');
  for (const sub of ['intended', 'invariants']) {
    const d = path.join(dir, sub);
    const ok = fs.existsSync(d) && fs.readdirSync(d).some((f) => f.endsWith('.test.js'));
    if (!ok) bad(`tasks/hidden/${t.hidden}/${sub}/ needs at least one *.test.js file`);
  }
  return out;
}

const readable = (s) => s && !s.unparsed && Number.isInteger(s.total) && s.total > 0;
const fmt = (s) => (readable(s) ? `${s.passed}/${s.total}` : 'unreadable');

/**
 * Problems with the measured evidence. `scores` = {reference, again, fixture, partials: [{name, intended, invariant}]};
 * each score is {intended: {passed, total}, invariant: {passed, total}} (a group may be {unparsed: true}).
 */
function evidenceProblems(t, scores) {
  const out = [];
  const bad = (msg) => out.push(msg);
  const declared = (group) => (t.checks || []).filter((c) => c.type === 'tests' && c.group === group).reduce((n, c) => n + (c.min || 0), 0);
  const { reference, again, fixture, partials = [] } = scores;
  for (const group of ['intended', 'invariant']) {
    const r = reference[group];
    if (!readable(r) || r.passed !== r.total) bad(`reference solution passes ${fmt(r)} ${group} tests, expected all`);
    else if (r.total !== declared(group)) bad(`${group} tests checks declare min ${declared(group)} but the reference run has ${r.total} tests`);
    const a = again?.[group];
    if (a && readable(r) && (!readable(a) || a.passed !== r.passed || a.total !== r.total)) bad(`${group} tests are not deterministic (${fmt(r)} then ${fmt(a)})`);
  }
  if (reference.seconds !== undefined && reference.seconds >= HIDDEN_MAX_SECONDS) bad(`hidden tests took ${reference.seconds.toFixed(1)} s, limit ${HIDDEN_MAX_SECONDS} s`);
  if (!readable(fixture.intended)) bad('the untouched fixture gives no readable intended test result');
  else if (fixture.intended.passed === fixture.intended.total) bad('the untouched fixture passes all intended tests; the task could be passed by doing nothing');
  if (partials.length < MIN_PARTIALS) bad(`needs at least ${MIN_PARTIALS} partial solutions (alternative interpretations), found ${partials.length}`);
  for (const p of partials) {
    if (!readable(p.intended)) bad(`partial "${p.name}": intended result is unreadable`);
    else if (p.intended.passed === p.intended.total) bad(`partial "${p.name}" passes every intended test; a wrong guess must fail at least one`);
    if (!readable(p.invariant)) bad(`partial "${p.name}": invariant result is unreadable`);
    else if (p.invariant.passed !== p.invariant.total) bad(`partial "${p.name}" fails invariant tests (${fmt(p.invariant)}); an alternative reading must still hold every invariant`);
  }
  return out;
}

module.exports = { shapeProblems, evidenceProblems, NO_QUESTIONS, PROCESS_CRITERIA, MAX_CLARIFICATIONS, MIN_PARTIALS, PROMPT_BANNED };
