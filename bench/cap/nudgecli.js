// SPDX-License-Identifier: Apache-2.0
'use strict';

// `cap nudge-preview` and `cap nudge-check`, both free and read-only.
//   nudge-preview  what the frozen nudge hook prints for each named task, with the rank-1 margin, for a person's leak check
//   nudge-check    the code-read outcome of finished hook-arm runs: did the hook fire, what loaded, what loaded in full

const fs = require('node:fs');
const path = require('node:path');
const nudge = require('./nudge.js');
const { parseStream } = require('../runner/lib/stream.js');
const { extractSkills } = require('../runner/lib/skills.js');
const { STUDY_RUNTIME } = require('./runtimes.js');
const { isSelfKill } = require('../runner/lib/self-kill.js');

const list = (v) => (v === undefined || v === true ? [] : String(v).split(',').map((s) => s.trim()).filter(Boolean));

/** The task JSON `<id>.json` directly under one of `dirs`. */
function taskPrompt(dirs, id) {
  for (const d of dirs) {
    const f = path.join(d, `${id}.json`);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')).prompt;
  }
  throw new Error(`task ${id} is not in ${dirs.join(', ')}`);
}

/**
 * Hook text per task for the arm tree `tree`. The index comes from the tree (what the hook carries); the prompts are
 * only matched here, never written into the arm. Returns [{ task, hits, margin, text }].
 */
function previewTasks({ tree, taskDirs, tasks }) {
  const index = nudge.buildIndex(tree);
  return tasks.map((task) => ({ task, ...nudge.preview(index, taskPrompt(taskDirs, task)) }));
}

function cmdNudgePreview(opts) {
  const tree = opts.tree && opts.tree !== true ? path.resolve(opts.tree) : null;
  if (!tree) throw new Error('--tree DIR (the built nudge arm tree) is required');
  const rows = previewTasks({ tree, taskDirs: list(opts['extra-tasks']), tasks: list(opts.tasks) });
  if (opts.json) { console.log(JSON.stringify(rows, null, 2)); return; }
  for (const r of rows) console.log(`## ${r.task} (rank-1 margin ${r.margin ?? 'n/a'})\n\n${r.text}`);
}

const readLines = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };

// The hook fired when its first line is in the run's session record (the agent's context) or, failing that, its stream.
function hookSeen(dir, header) {
  const sess = path.join(dir, 'session');
  const texts = [];
  try { for (const s of fs.readdirSync(sess)) texts.push(readLines(path.join(sess, s, 'messages.jsonl'))); } catch { /* no session record */ }
  texts.push(readLines(path.join(dir, 'stream.jsonl')));
  // The header followed by a real line break: the printed text. The hook's own source (if a record ever holds the agent
  // config) has the header inside a string literal, followed by a quote or an escaped "\n", so it does not match.
  const printed = `${header}\n`;
  const escaped = JSON.stringify(printed).slice(1, -1);
  return texts.some((t) => t.includes(printed) || t.includes(escaped));
}

// result.json files under `root`, at any depth (a run dir holds <arm>/<task>/<replicate>/result.json).
function resultDirs(root) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory() && e.name !== 'workspace' && e.name !== 'session') walk(path.join(d, e.name));
      else if (e.name === 'result.json') out.push(d);
    }
  };
  walk(root);
  return out.sort();
}

const NO_SKILL_RE = /no skill fits/i;

/** Whether an errored run killed itself (runner/lib/self-kill.js, D-243). `dir` is one run's folder. */
function selfKill(dir) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
  return r.agentSelfKill === true || isSelfKill(dir, r.status);
}

/** One row per finished run under `runs`: the hook check and the skill outcome, full loads apart from preview-only ones. */
function checkRuns(runs) {
  const rows = [];
  for (const root of runs) {
    for (const dir of resultDirs(root)) {
      const r = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8'));
      const events = parseStream(readLines(path.join(dir, 'stream.jsonl'))).events;
      const x = extractSkills(events, STUDY_RUNTIME);
      // A cell the runner skipped (budget) or that left no stream and no session record never reached the agent, so
      // there was no prompt for the hook to fire on: not run, never "hook missing".
      const ran = r.status !== 'budget_skipped' && (fs.existsSync(path.join(dir, 'stream.jsonl')) || fs.existsSync(path.join(dir, 'session')));
      // Only the hook arms carry a header to look for; any other arm reports null.
      const header = /filler/.test(r.armId) ? nudge.FILLER_HEADER : /list/.test(r.armId) ? nudge.LIST_HEADER : /nudge/.test(r.armId) ? nudge.NUDGE_HEADER : null;
      rows.push({
        armId: r.armId, taskId: r.taskId, replicate: r.replicate, status: r.status, ran, selfKill: ran && selfKill(dir), credits: r.credits ?? null, toolCalls: r.toolCalls ?? null,
        hookSeen: header && ran ? hookSeen(dir, header) : null,
        skillsLoaded: x.skillsLoaded.map((s) => s.name), skillsLoadedFull: x.skillsLoadedFull.map((s) => s.name), skillLoadsPreview: x.skillLoadsPreview,
        findSkillsCalls: x.findSkillsCalls, saidNoSkillFits: NO_SKILL_RE.test(String(r.finalText ?? '')),
      });
    }
  }
  return rows;
}

function cmdNudgeCheck(opts) {
  const runs = list(opts.run).map((p) => path.resolve(p));
  if (!runs.length) throw new Error('--run DIR[,DIR] is required');
  const rows = checkRuns(runs);
  if (opts.json) { console.log(JSON.stringify(rows, null, 2)); return; }
  console.log('| arm | task | rep | status | hook seen | loaded | loaded in full | preview only | find_skills | said no skill fits | credits |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) console.log(`| ${r.armId} | ${r.taskId} | ${r.replicate} | ${r.selfKill ? 'agent self-kill' : r.ran ? r.status : `not run (${r.status})`} | ${r.hookSeen ?? '-'} | ${r.skillsLoaded.join(' ') || '-'} | ${r.skillsLoadedFull.join(' ') || '-'} | ${r.skillLoadsPreview} | ${r.findSkillsCalls} | ${r.saidNoSkillFits} | ${r.credits ?? '-'} |`);
  // Exit 1 when a hook arm ran without its hook text in the record: the arm did not get its treatment.
  if (rows.some((r) => r.hookSeen === false)) process.exitCode = 1;
}

module.exports = { cmdNudgePreview, cmdNudgeCheck, previewTasks, checkRuns, hookSeen, selfKill };
