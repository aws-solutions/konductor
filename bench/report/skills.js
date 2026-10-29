// SPDX-License-Identifier: Apache-2.0
'use strict';

// "Skills actually used": which skills and SOPs the runs loaded, summed per arm, task class and task.
// Rows come from result.json fields (report) or are recomputed from stream.jsonl (`bench.js skills`).

const fs = require('node:fs');
const path = require('node:path');
const { median, mean } = require('./stats.js');
const { parseStream } = require('../runner/lib/stream.js');
const { runtimeOf } = require('../runner/lib/harness/runtime.js');
const { SKILL_FIELDS, extractSkills, resultFields, catalogFrom, listCatalogDir, startupKiro, builtinStartup } = require('../runner/lib/skills.js');

const CLASS_ORDER = ['simple', 'sop', 'orchestration', 'review', 'design'];
const share = (n, d) => (d ? n / d : null);
const pct = (v) => (v === null || v === undefined ? 'n/a' : `${(v * 100).toFixed(0)}%`);
const int = (v) => (v === null || v === undefined ? 'n/a' : Math.round(v).toLocaleString('en-US'));
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const fraction = (n, d) => (d ? `${pct(n / d)} (${n}/${d})` : 'n/a');

function cellOf(rows) {
  const f = rows.map((r) => r.fields);
  const targeted = f.filter((x) => x.targetLoaded !== null && x.targetLoaded !== undefined);
  const bytes = f.map((x) => x.skillBytesLoaded ?? 0);
  return {
    runs: rows.length,
    anySkill: f.filter((x) => x.skillsLoaded.length > 0).length,
    sopRuns: f.filter((x) => x.sopsLoaded.length > 0).length,
    targetRuns: targeted.length,
    targetLoaded: targeted.filter((x) => x.targetLoaded).length,
    targetAttempted: targeted.filter((x) => x.targetAttempted).length,
    targetReachable: targeted.filter((x) => x.targetReachable === true).length,
    targetReachableKnown: targeted.filter((x) => x.targetReachable !== null && x.targetReachable !== undefined).length,
    bytesMean: bytes.length ? mean(bytes) : null,
    bytesMedian: bytes.length ? median(bytes) : null,
    callsFailed: f.reduce((n, x) => n + (x.skillCallsFailed ?? 0), 0),
    findCalls: f.reduce((n, x) => n + (x.findSkillsCalls ?? 0), 0),
    findEmpty: f.reduce((n, x) => n + (x.findSkillsEmpty ?? 0), 0),
  };
}

function topSkills(rows, limit = 5) {
  const counts = new Map();
  for (const r of rows) for (const s of r.fields.skillsLoaded) counts.set(s.name, (counts.get(s.name) || 0) + s.count);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([name, loads]) => ({ name, loads }));
}

/**
 * rows: [{armId, taskId, taskClass, target, fields}] where `fields` holds the skill fields or is null when the
 * run did not record them. startup: {armId: startup record}. Arms keep the order of `armOrder`.
 */
function summarizeSkills(rows, { armOrder = [], startup = {} } = {}) {
  const recorded = rows.filter((r) => r.fields);
  const armIds = [...new Set([...armOrder, ...rows.map((r) => r.armId)])].filter((a) => rows.some((r) => r.armId === a));
  const classes = [...new Set(recorded.map((r) => r.taskClass))].sort((a, b) => (CLASS_ORDER.indexOf(a) + 1 || 99) - (CLASS_ORDER.indexOf(b) + 1 || 99));
  const arms = {};
  for (const arm of armIds) {
    const mine = recorded.filter((r) => r.armId === arm);
    const tasks = {};
    for (const id of [...new Set(mine.map((r) => r.taskId))].sort()) {
      const t = mine.filter((r) => r.taskId === id);
      tasks[id] = { ...cellOf(t), target: t[0].target ?? null, class: t[0].taskClass };
    }
    const st = startup[arm] ?? null;
    arms[arm] = {
      overall: cellOf(mine),
      byClass: Object.fromEntries(classes.filter((c) => mine.some((r) => r.taskClass === c)).map((c) => [c, cellOf(mine.filter((r) => r.taskClass === c))])),
      tasks,
      topSkills: topSkills(mine),
      notRecorded: rows.filter((r) => r.armId === arm && !r.fields).length,
      startup: st ? { builtin: Boolean(st.builtin), count: st.count ?? null, totalBytes: st.totalBytes ?? null, unknownSizes: st.unknownSizes ?? null, approxSizes: st.approxSizes ?? 0 } : null,
      scopes: [...new Set(mine.map((r) => r.fields.skillsScope).filter(Boolean))],
      sopNameSources: [...new Set(mine.map((r) => r.fields.sopNameSource).filter(Boolean))],
    };
  }
  return { recorded: recorded.length, notRecorded: rows.length - recorded.length, arms };
}

function startupText(s) {
  if (!s) return 'n/a';
  if (s.builtin) return 'n/a (built-in agent)';
  const unknown = s.unknownSizes ? `, ${s.unknownSizes} unsized` : '';
  const approx = s.approxSizes ? `, ${s.approxSizes} sized from the repo copy` : '';
  return `${s.count} entries, ${int(s.totalBytes)} B${unknown}${approx}`;
}

const targetText = (c) => (c.targetRuns ? `${fraction(c.targetLoaded, c.targetRuns)}${c.targetAttempted ? `; tried ${c.targetAttempted}` : ''}` : 'n/a');

function renderSkillsMarkdown(sum, { title = '## Skills actually used' } = {}) {
  const out = [title, ''];
  out.push('Read from the event stream (passive, nothing was added to the runs). kiro-cli: calls to the `konductor-skills` server (`get_skill`, `find_skills`) in every session, subagents included. opencode: the `skill` tool in the parent session only; subagent sessions are not in the stream. A load counts when the call returned text; errors and empty results are counted as failed calls. Bytes are the text the tool returned, so they approximate the context a load adds. SOP names come from a listing of `agent-sops/` when one was available, else the installed agent filter, else the `sop-`, `k-`, `kiro-` naming convention (`sopNameSources` in the JSON output says which). "target loaded" covers tasks whose target is a skill or SOP; tasks that target an agent are left out. "reachable" says whether the arm exposes the target to a tool call at all.', '');
  if (!sum.recorded) {
    out.push('No run recorded skill fields. Runs made before skill tracking can be read with `bench.js skills --run DIR`.', '');
    return out.join('\n');
  }
  if (sum.notRecorded) out.push(`${sum.notRecorded} run(s) have no skill fields and are left out.`, '');
  const arms = Object.entries(sum.arms).filter(([, a]) => a.overall.runs);

  out.push('### By task class', '', table(
    ['arm', 'class', 'runs', 'loaded a skill', 'SOP activated', 'target loaded', 'skill bytes mean / median', 'failed calls', 'find_skills empty', 'startup resources'],
    arms.flatMap(([arm, a]) => Object.entries({ overall: a.overall, ...a.byClass }).map(([cls, c]) => [
      arm, cls, c.runs, fraction(c.anySkill, c.runs), fraction(c.sopRuns, c.runs), targetText(c), `${int(c.bytesMean)} / ${int(c.bytesMedian)}`, c.callsFailed,
      c.findCalls ? `${c.findEmpty}/${c.findCalls}` : '-', cls === 'overall' ? startupText(a.startup) : '',
    ])),
  ), '');

  out.push('### By task', '', table(
    ['arm', 'task', 'target', 'runs', 'loaded a skill', 'SOP activated', 'target loaded', 'target reachable'],
    arms.flatMap(([arm, a]) => Object.entries(a.tasks).map(([id, c]) => [
      arm, id, c.target ?? '-', c.runs, fraction(c.anySkill, c.runs), fraction(c.sopRuns, c.runs), targetText(c),
      c.targetReachableKnown ? fraction(c.targetReachable, c.targetReachableKnown) : 'n/a',
    ])),
  ), '');

  out.push('### Top skills by load count', '', table(
    ['arm', 'top 5 (loads)'],
    arms.map(([arm, a]) => [arm, a.topSkills.length ? a.topSkills.map((s) => `${s.name} (${s.loads})`).join(', ') : 'none']),
  ), '');

  const vanilla = arms.filter(([arm]) => /(^|-)vanilla$/.test(arm)).map(([arm]) => arm);
  if (vanilla.length) {
    out.push(`Vanilla arms (${vanilla.join(', ')}) install no konductor skills, SOPs or rule files. Their startup resources are the CLI's built-in agent, which is not visible in the run artifacts, so no size is recorded. A built-in skill of the CLI would still show up above if the agent loaded one.`, '');
  }
  return out.join('\n');
}

// ---- recompute from a run directory (no result.json needed, nothing is written) ----

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const subdirs = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { return []; } };

function armContext({ runDir, armId, config, repoRoot, runtime, vanilla }) {
  const rec = (config?.arms ?? []).find((a) => a.id === armId);
  const lists = listCatalogDir(repoRoot);
  let agent = null;
  for (const task of subdirs(path.join(runDir, armId))) {
    for (const rep of subdirs(path.join(runDir, armId, task))) agent = agent ?? readJson(path.join(runDir, armId, task, rep, 'installed-agent.json'));
  }
  let startup = null;
  if (vanilla) startup = builtinStartup(runtime);
  else if (rec?.startupResources) startup = rec.startupResources;
  else if (agent) startup = startupKiro(agent, { contextDirs: repoRoot ? [path.join(repoRoot, 'context')] : [] });
  return { info: vanilla ? null : { catalog: catalogFrom(lists, agent), startup }, startup };
}

/**
 * Skill rows for every run directory with a stream.jsonl under `runDir` (layout `<arm>/<task>/<replicate>/`).
 * A run without result.json is still in progress: it is returned with `complete: false`.
 */
function collectRows(runDir, { tasks = new Map(), repoRoot = null } = {}) {
  const dir = path.resolve(runDir);
  if (!fs.existsSync(dir)) throw new Error(`run directory not found: ${runDir}`);
  const config = readJson(path.join(dir, 'run-config.json')) ?? {};
  const rows = [];
  const startup = {};
  for (const armId of subdirs(dir)) {
    const ctxCache = {};
    for (const taskId of subdirs(path.join(dir, armId))) {
      for (const rep of subdirs(path.join(dir, armId, taskId))) {
        const runPath = path.join(dir, armId, taskId, rep);
        const streamFile = path.join(runPath, 'stream.jsonl');
        if (!fs.existsSync(streamFile)) continue;
        const result = readJson(path.join(runPath, 'result.json'));
        const rec = (config.arms ?? []).find((a) => a.id === armId);
        const runtime = result ? runtimeOf(result) : armId.startsWith('oc-') ? 'opencode' : 'kiro-cli';
        const vanilla = rec ? rec.ref == null : /(^|-)vanilla$/.test(armId);
        ctxCache.v ??= armContext({ runDir: dir, armId, config, repoRoot, runtime, vanilla });
        const task = tasks.get(taskId) ?? { target: null, class: 'unknown' };
        const { events } = parseStream(fs.readFileSync(streamFile, 'utf8'));
        const fields = resultFields({ extraction: extractSkills(events, runtime), info: ctxCache.v.info, task, arm: { vanilla } });
        rows.push({ armId, taskId, replicate: Number(rep), taskClass: task.class, target: task.target ?? null, fields, complete: Boolean(result) });
        startup[armId] = ctxCache.v.startup;
      }
    }
  }
  return { rows, startup, armOrder: config.armIds ?? [] };
}

/** Rows from the skill fields stored in result.json; runs without them have `fields: null`. */
function rowsFromResults(runs, classOf, targetOf) {
  return runs.map((r) => ({
    armId: r.armId, taskId: r.taskId, replicate: r.replicate, taskClass: classOf(r.taskId), target: targetOf(r.taskId),
    fields: r.result.skillsLoaded == null ? null : {
      ...Object.fromEntries(SKILL_FIELDS.map((k) => [k, r.result[k] ?? null])),
      skillsLoaded: r.result.skillsLoaded, sopsLoaded: r.result.sopsLoaded ?? [],
    },
  }));
}

module.exports = { summarizeSkills, renderSkillsMarkdown, collectRows, rowsFromResults };
