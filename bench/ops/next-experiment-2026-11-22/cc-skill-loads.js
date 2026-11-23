#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Free, read-only: which skills each Claude Code run of run-cc-compare.sh loaded, and whether in full. The Claude Code
// twin of the stream reading in analysis-forced.py (whole, partial, missing per must-load unit of prefixes/manifest.json),
// so "did Claude Code load the skills?" is answered the way the Kiro arms were.
//
//   node cc-skill-loads.js RUNS MANIFEST R SKILLS
//
// RUNS      run-cc-compare.sh's runs dir (<task>/<arm>/<task>/<rep>/stream.jsonl)
// MANIFEST  prefixes/manifest.json (the must-load units per task: skill:<name> or sop:<name>)
// R         the frozen bench worktree; its own Claude Code stream reader (claude-code-parse.js skillCalls) is used
// SKILLS    the installed skill tree of the konductor arm (<cache>/claude-<sha12>-*/src/dist/claude/skills), for sizes
//
// A load is one Skill tool call, a Read of <name>/SKILL.md, or a shell read of it (the frozen reader's three ways).
// States, best first: whole (the text that reached the model is at least COVER of the SKILL.md body), partial (less),
// preload (a sub-agent's Skill call answered "Launching skill" with no body: the skill was preloaded into that agent, so
// its text is not in the stream), failed (every call errored), missing (never requested). A konductor SOP is installed
// as the skill sop-<name>. Prints markdown. Writes nothing. No model call.

const fs = require('node:fs');
const path = require('node:path');

const COVER = 0.9;
const RANK = ['whole', 'partial', 'preload', 'failed', 'missing'];

/** The SKILL.md text without its front matter (Claude Code shows the body only). */
function bodyOf(text) {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

/** Body bytes of the installed SKILL.md of `name` under `skillsDir`, or null when it is not installed there. */
function bodyBytes(skillsDir, name) {
  try { return Buffer.byteLength(bodyOf(fs.readFileSync(path.join(skillsDir, name, 'SKILL.md'), 'utf8'))); } catch { return null; }
}

/** One call's state. `size` null: whole when any text came back. */
function callState(c, size) {
  if (c.status !== 'ok') return 'failed';
  if (c.via === 'skill-tool' && !c.bodySeen) return 'preload';
  const bytes = Buffer.byteLength(c.text ?? '');
  if (bytes === 0) return 'failed';
  return size == null || bytes >= size * COVER ? 'whole' : 'partial';
}

/** Best state per skill name over `calls`: Map name -> { state, scope, via, calls }. */
function loadsOf(calls, skillsDir) {
  const out = new Map();
  for (const c of calls) {
    const name = String(c.input?.name ?? '').toLowerCase();
    if (!name) continue;
    const s = callState(c, bodyBytes(skillsDir, name));
    const cur = out.get(name);
    if (!cur) out.set(name, { state: s, scope: c.scope, via: c.via, calls: 1 });
    else {
      cur.calls++;
      if (RANK.indexOf(s) < RANK.indexOf(cur.state)) Object.assign(cur, { state: s, scope: c.scope, via: c.via });
    }
  }
  return out;
}

const unitName = (u) => { const [kind, name] = u.split(':'); return kind === 'sop' ? `sop-${name}` : name; };

/** Every run dir under RUNS: [{ task, arm, rep, dir }]. */
function runDirs(runs) {
  const out = [];
  const ls = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };
  for (const t of ls(runs)) for (const arm of ls(path.join(runs, t))) for (const rep of ls(path.join(runs, t, arm, t))) {
    const dir = path.join(runs, t, arm, t, rep);
    if (fs.existsSync(path.join(dir, 'stream.jsonl'))) out.push({ task: t, arm, rep: Number(rep), dir });
  }
  return out.sort((a, b) => a.task.localeCompare(b.task) || a.arm.localeCompare(b.arm) || a.rep - b.rep);
}

/** The report rows: per run its loads and the state of each must-load unit. */
function analyse({ runs, manifest, R, skills }) {
  const { skillCalls } = require(path.join(R, 'bench/runner/lib/harness/claude-code-parse.js'));
  const { parseStream } = require(path.join(R, 'bench/runner/lib/stream.js'));
  const must = JSON.parse(fs.readFileSync(manifest, 'utf8')).tasks;
  return runDirs(runs).map((r) => {
    const { events } = parseStream(fs.readFileSync(path.join(r.dir, 'stream.jsonl'), 'utf8'));
    const loads = loadsOf(skillCalls(events), skills);
    const units = (must[r.task]?.units ?? []).map((u) => ({ unit: u, ...(loads.get(unitName(u)) ?? { state: 'missing', scope: null }) }));
    return { ...r, loads, units };
  });
}

function render(rows) {
  const lines = ['### Skill loads per Claude Code run\n', '| task | arm | rep | skills loaded (state, scope) | must-load units whole |', '| --- | --- | --- | --- | --- |'];
  for (const r of rows) {
    const all = [...r.loads].map(([n, l]) => `${n} (${l.state}, ${l.scope})`).join('; ') || 'none';
    lines.push(`| ${r.task} | ${r.arm} | ${r.rep} | ${all} | ${r.units.filter((u) => u.state === 'whole').length} of ${r.units.length} |`);
  }
  lines.push('', '### Must-load units per arm (prefixes/manifest.json)\n', `| arm | runs | runs with any skill load | ${RANK.join(' | ')} |`, `| --- | --- | --- | ${RANK.map(() => '---').join(' | ')} |`);
  for (const arm of [...new Set(rows.map((r) => r.arm))]) {
    const mine = rows.filter((r) => r.arm === arm);
    const n = Object.fromEntries(RANK.map((s) => [s, 0]));
    for (const r of mine) for (const u of r.units) n[u.state]++;
    lines.push(`| ${arm} | ${mine.length} | ${mine.filter((r) => r.loads.size).length} | ${RANK.map((s) => n[s]).join(' | ')} |`);
  }
  return lines.join('\n') + '\n';
}

if (require.main === module) {
  const [runs, manifest, R, skills] = process.argv.slice(2);
  if (!runs || !manifest || !R || !skills) { console.error('usage: node cc-skill-loads.js RUNS MANIFEST R SKILLS'); process.exit(64); }
  process.stdout.write(render(analyse({ runs, manifest, R, skills })));
}

module.exports = { bodyOf, callState, loadsOf, analyse, render, unitName };
