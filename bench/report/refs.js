// SPDX-License-Identifier: Apache-2.0
'use strict';

// Scores the references-read runs from stream.jsonl (bench/REFERENCES-READ.md). A skill that keeps detail in
// references/*.md is loaded through get_skill, which returns only the SKILL.md body and its path. The agent then has
// to read the reference file itself, from the skills root outside its workspace. For each run this records whether the
// skill loaded, whether the agent tried to read a reference file, what happened to the read (succeeded, refused, error)
// and whether the planted fact from the reference reached the answer. Reads files only: no model, no network, and
// no writes except --out.

const fs = require('node:fs');
const path = require('node:path');
const { kiroTimeline } = require('../runner/lib/trace.js');
const { wilson } = require('../cap/score.js');

const BENCH = path.resolve(__dirname, '..');
const MANIFEST_FILE = path.join(BENCH, 'suites', 'references-read.manifest.json');

// Fixed before any data. A change needs a new study, not a re-read of the old one.
const THRESHOLDS = Object.freeze({
  minLoaded: 3, // runs in the reference arms that loaded the skill; fewer cannot support a decision
  refusedAny: 1, // refused reads (in any usable reference-arm run) that make the decision "refused"
  worksReadShare: 0.5, // share of loaded runs with a successful reference read
  worksUsedShare: 0.5, // share of those readers whose answer carries the planted fact
  noAttemptShare: 0.5, // share of loaded runs that never tried a reference read
  controlUsedMin: 0.5, // share of loaded forced-control runs that carry the fact, below which a miss cannot be put on the reference
  refusalChars: 400, // characters of a tool result inspected for refusal wording
  smallResult: 600, // a result shorter than this that carries refusal wording is a refusal, not a file
});

const OUTCOMES = ['not-loaded', 'no-attempt', 'refused', 'error', 'read-ok'];
const READ_TOOLS = /^(read|read_file|fs_read|Read|view_file)$/;
const SHELL_TOOLS = /^(execute_bash|shell|Bash|bash|execute)$/;
const REFUSAL = /outside (?:of )?(?:the |your |this )?(?:workspace|working directory|project|allowed|current)|not (?:allowed|permitted|within|inside|in) (?:the |to |your )?(?:workspace|read|access|working|allowed)|(?:workspace|sandbox|path|directory) (?:boundary|restriction|policy)|permission denied|access (?:is )?denied|denied|refus|forbidden|unauthori[sz]ed|not authori[sz]ed|blocked|EACCES|EPERM|operation not permitted|not trusted|untrusted|reject(?:ed)? by|rejected|declined|not approved|(?:requires?|needs?) (?:user )?approval|approval (?:is )?required|trusted (?:paths?|directories|folders?)/i;
const ERRNO = /function not implemented|\berror 38\b|errno[ :=]*38\b|\bENOSYS\b/i;

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const readJsonl = (f) => {
  const text = readText(f);
  if (text == null) return null;
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn last line */ }
  }
  return out;
};
const loadManifest = (file = MANIFEST_FILE) => JSON.parse(fs.readFileSync(file, 'utf8'));
const clip = (s, n = 160) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

function stringsOf(value, out = []) {
  if (value == null) return out;
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => stringsOf(v, out));
  else if (typeof value === 'object') Object.values(value).forEach((v) => stringsOf(v, out));
  return out;
}

// ---- skill loads ----

const isSchemaLoad = (e) => e.kind === 'tool' && /^tool::konductor-skills::(get_skill|find_skills)$/.test(String(e.input?.id ?? ''));
const isLoadResource = (e) => e.kind === 'tool' && (e.tool === 'load_resource' || e.tool === 'Load Resource') && typeof e.input?.id === 'string';
const tryJson = (s) => { try { return JSON.parse(s); } catch { return null; } };

function lookupFailed(l) {
  if (l.failedRaw) return true;
  const r = String(l.result ?? '');
  const j = tryJson(r.trim());
  if (l.tool === 'load_resource') {
    if (j && Array.isArray(j.not_found) && j.not_found.length) return true;
    if (j && Array.isArray(j.loaded) && j.loaded.length === 0) return true;
    return /\b(not found|error|refused|cannot|invalid)\b/i.test(r.slice(0, 300)) && !(j && Array.isArray(j.loaded) && j.loaded.length);
  }
  if (l.tool === 'get_skill') return !/"content"|^---|\bname:/.test(r);
  return false;
}

/** Skill loads in a timeline, in the three forms the stream shows: the skills server, load_resource(skill::*), and a read of SKILL.md. */
function skillLoads(entries) {
  const schemaSeen = new Set();
  const anySchema = entries.some(isSchemaLoad);
  const out = [];
  for (const e of entries) {
    if (isSchemaLoad(e)) { schemaSeen.add(e.agent); continue; }
    let l = null;
    if (e.kind === 'skill-load') {
      const name = e.input?.name ?? e.input?.skill ?? null;
      l = { form: 'get_skill', tool: 'get_skill', name: typeof name === 'string' ? name : null, deferred: Boolean(e.deferred) };
    } else if (isLoadResource(e)) {
      const m = /^skill::([^:\s]+)$/.exec(e.input.id);
      if (m) l = { form: 'load_resource', tool: 'load_resource', name: m[1], deferred: false };
    } else if (e.kind === 'tool' && READ_TOOLS.test(String(e.tool))) {
      const p = pathsOf(e.input).find((x) => /(?:^|\/)([^/]+)\/SKILL\.md$/.test(x));
      if (p) l = { form: 'read-skill-md', tool: 'read', name: /(?:^|\/)([^/]+)\/SKILL\.md$/.exec(p)[1], deferred: false };
    }
    if (!l) continue;
    l = { ...l, n: e.n, agent: e.agent, failedRaw: Boolean(e.failed), result: e.result ?? '', beforeSchema: anySchema && !schemaSeen.has(e.agent) };
    l.failed = lookupFailed(l) || (l.form === 'get_skill' && (l.deferred || l.beforeSchema));
    out.push(l);
  }
  return out;
}

// ---- reference reads ----

function pathsOf(input) {
  if (!input || typeof input !== 'object') return [];
  const out = [];
  for (const k of ['path', 'file_path', 'filePath', 'filename']) if (typeof input[k] === 'string') out.push(input[k]);
  if (Array.isArray(input.paths)) out.push(...input.paths.filter((p) => typeof p === 'string'));
  for (const k of ['operations', 'files', 'reads']) {
    if (!Array.isArray(input[k])) continue;
    for (const o of input[k]) { if (typeof o === 'string') out.push(o); else if (o && typeof o.path === 'string') out.push(o.path); else if (o && typeof o.file_path === 'string') out.push(o.file_path); }
  }
  return out;
}

const SKILLS_REF = /\/skills\/([^/\s"']+)\/references\/[^\s"'`;|&)]+/;
const WORKSPACE_PATH = /\/r-[A-Za-z0-9]+\/work(?:\/|$)/;
const REL_REF = /^(?:\.\/)?references\/[^\s"']+$/;

/** Where a reference path points: the skills root (outside the workspace), the workspace, or somewhere else. */
function locate(p, skills) {
  const m = SKILLS_REF.exec(p);
  if (m && (!skills || skills.includes(m[1]))) return { where: WORKSPACE_PATH.test(p) ? 'workspace' : 'skills-root', skill: m[1] };
  if (REL_REF.test(p)) return { where: 'workspace', skill: null };
  if (/(?:^|\/)references\/[^/]+\.md$/.test(p) && WORKSPACE_PATH.test(p)) return { where: 'workspace', skill: null };
  return null;
}

function resultText(e) {
  return String(e.result ?? '');
}

/**
 * The outcome of one read. A refusal is wording from the permission or workspace boundary: an error result, or a short
 * result that carries it. Any other error (no such file, a bad range) is "error". Everything else is a read.
 */
function classifyRead(e, T = THRESHOLDS) {
  const text = resultText(e);
  const head = text.slice(0, T.refusalChars);
  const refusalWords = REFUSAL.test(head);
  const failed = Boolean(e.failed) || e.status === 'failed';
  if (refusalWords && (failed || text.length < T.smallResult)) return 'refused';
  if (failed) return 'error';
  if (!text.trim()) return 'error';
  return 'succeeded';
}

function referenceReads(entries, skills, T = THRESHOLDS) {
  const out = [];
  for (const e of entries) {
    if (e.kind !== 'tool') continue;
    let via = null;
    let paths = [];
    if (READ_TOOLS.test(String(e.tool))) {
      via = 'read';
      paths = pathsOf(e.input);
    } else if (SHELL_TOOLS.test(String(e.tool))) {
      const cmd = String(e.input?.command ?? e.input?.cmd ?? '');
      const hits = cmd.match(new RegExp(SKILLS_REF.source, 'g')) || [];
      if (/\b(cat|head|tail|sed|less|more|awk|grep|rg|bat|nl)\b/.test(cmd) && hits.length) { via = 'shell'; paths = hits; }
    }
    if (!via) continue;
    for (const p of paths) {
      if (/\/SKILL\.md$/.test(p)) continue;
      const loc = locate(p, skills);
      if (!loc) continue;
      out.push({ n: e.n, agent: e.agent, via, path: p, ...loc, outcome: classifyRead(e, T), text: clip(resultText(e), 400) });
    }
  }
  return out;
}

// ---- errno ----

function errnoHits({ runDir, events, result }) {
  const hits = [];
  const check = (source, text) => { const m = ERRNO.exec(String(text ?? '')); if (m) hits.push({ source, match: m[0] }); };
  check('stderr.txt', readText(path.join(runDir, 'stderr.txt')));
  check('result.error', result?.error);
  check('result.infraError', typeof result?.infraError === 'string' ? result.infraError : JSON.stringify(result?.infraError ?? ''));
  for (const ev of events) {
    const u = ev.data?.update;
    if (u && (u.sessionUpdate === 'tool_call_update' || u.sessionUpdate === 'tool_call')) check('tool result', stringsOf([u.rawOutput, u.content]).join('\n'));
  }
  return hits.slice(0, 5);
}

// ---- planted facts ----

/** Does `text` carry the fact? A fact is one regex, or a list of regexes that all match, tested on the whole text (`near` windows are in the pattern). */
function factPresent(fact, text) {
  const t = String(text ?? '');
  const patterns = Array.isArray(fact.all) ? fact.all : [fact.pattern];
  return patterns.every((p) => new RegExp(p, fact.flags ?? 'i').test(t));
}

function plantedOf(spec, text) {
  const out = {};
  for (const f of spec.planted || []) out[f.id] = factPresent(f, text);
  const primary = (spec.planted || []).find((f) => f.primary);
  return { facts: out, used: primary ? out[primary.id] : false };
}

// ---- one run ----

function runDirsUnder(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 7) return;
    if (fs.existsSync(path.join(dir, 'result.json'))) { out.push(dir); return; }
    let names;
    try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of names) if (e.isDirectory() && !['workspace', 'session', 'node_modules', '.git'].includes(e.name)) walk(path.join(dir, e.name), depth + 1);
  };
  walk(path.resolve(root), 0);
  return out.sort();
}

function groupConfigOf(runDir) {
  let dir = path.dirname(runDir);
  for (let i = 0; i < 5; i++) {
    const f = path.join(dir, 'run-config.json');
    if (fs.existsSync(f)) return readJson(f);
    dir = path.dirname(dir);
  }
  return null;
}

/** Everything the report needs from one run directory. Never throws on a thin or partial run: it records what is missing. */
function scoreRun(runDir, ctx) {
  const { manifest, T = THRESHOLDS } = ctx;
  const result = readJson(path.join(runDir, 'result.json')) || {};
  const events = readJsonl(path.join(runDir, 'stream.jsonl'));
  const config = groupConfigOf(runDir);
  const armId = result.armId ?? path.basename(path.dirname(path.dirname(runDir)));
  const taskId = result.taskId ?? path.basename(path.dirname(runDir));
  const spec = manifest.tasks[taskId];
  const armDef = manifest.arms[armId];
  const row = {
    dir: runDir, arm: armId, task: taskId, rep: result.replicate ?? Number(path.basename(runDir)), role: armDef?.role ?? null,
    entryAgent: result.agent ?? config?.armAgent?.[armId] ?? spec?.owner ?? null, status: result.status ?? null,
    credits: result.creditsCharged ?? result.credits ?? null, creditsCensored: Boolean(result.creditsCensored), wallMs: result.wallClockMs ?? null,
    problems: [], streamMissing: events == null,
  };
  if (!spec) { row.problems.push('task is not in the manifest'); row.usable = false; row.excludedReason = 'unknown-task'; return row; }
  if (!armDef) row.problems.push('arm is not in the manifest');
  if (events == null) { row.problems.push('no stream.jsonl'); row.usable = false; row.excludedReason = 'no-stream'; return row; }

  const entries = kiroTimeline(events);
  const hits = errnoHits({ runDir, events, result });
  row.sandboxErrno = hits.length > 0;
  row.errnoHits = hits;

  const skills = [spec.skill, ...(spec.controlSkills || [])];
  const loads = skillLoads(entries).filter((l) => skills.includes(l.name));
  const good = loads.filter((l) => !l.failed);
  const reads = referenceReads(entries, skills, T);
  const count = (o) => reads.filter((r) => r.outcome === o).length;
  row.skill = {
    expected: spec.skill, names: [...new Set(loads.map((l) => l.name))], loaded: good.length > 0, attemptedLoad: loads.length > 0, forms: [...new Set(good.map((l) => l.form))],
    failedLoads: loads.filter((l) => l.failed).length, firstLoadAt: good.length ? good[0].n : null,
  };
  row.reads = reads;
  row.readAttempts = reads.length;
  row.readSucceeded = count('succeeded');
  row.readRefused = count('refused');
  row.readErrored = count('error');
  row.refusals = reads.filter((r) => r.outcome === 'refused').map((r) => ({ n: r.n, path: r.path, message: r.text }));
  row.readWhere = [...new Set(reads.map((r) => r.where))];

  const artifact = readText(path.join(runDir, 'workspace', spec.artifact));
  const finalText = entries.filter((e) => e.kind === 'final').map((e) => e.text).pop() ?? '';
  const planted = plantedOf(spec, artifact ?? '');
  const plantedFinal = plantedOf(spec, finalText);
  row.artifactWritten = artifact != null;
  row.planted = planted.facts;
  row.usedReference = planted.used;
  row.usedInFinalOnly = !planted.used && plantedFinal.used;

  row.outcome = reads.length ? (row.readSucceeded ? 'read-ok' : row.readRefused ? 'refused' : 'error') : row.skill.loaded ? 'no-attempt' : 'not-loaded';
  const finished = result.status === 'success' || finalText.length > 0 || artifact != null;
  row.usable = finished && !row.sandboxErrno;
  row.excludedReason = row.sandboxErrno ? 'sandboxErrno' : !finished ? 'unfinished' : null;
  if (!finished) row.problems.push('run did not finish');
  return row;
}

// ---- aggregation ----

function loadRows(runRoots, ctx) {
  const rows = [];
  for (const root of runRoots) for (const dir of runDirsUnder(root)) rows.push(scoreRun(dir, ctx));
  return rows;
}

const ARM_ORDER = (manifest) => Object.keys(manifest.arms);

function armTable(rows, manifest) {
  const out = [];
  const names = [...new Set([...ARM_ORDER(manifest), ...rows.map((r) => r.arm)])];
  for (const arm of names) {
    const mine = rows.filter((r) => r.arm === arm);
    if (!mine.length) continue;
    const use = mine.filter((r) => r.usable);
    const excluded = mine.filter((r) => !r.usable);
    const c = {};
    for (const o of OUTCOMES) c[o] = use.filter((r) => r.outcome === o).length;
    const loaded = use.filter((r) => r.skill?.loaded);
    out.push({
      arm, role: manifest.arms[arm]?.role ?? null, runs: mine.length, usable: use.length, excluded: excluded.length, outcomes: c, loaded: loaded.length,
      attempted: use.filter((r) => r.readAttempts > 0).length, refusedAny: use.filter((r) => r.readRefused > 0).length,
      used: use.filter((r) => r.usedReference).length, usedAmongLoaded: loaded.filter((r) => r.usedReference).length,
      readOk: use.filter((r) => r.readSucceeded > 0).length,
      credits: use.reduce((n, r) => n + (r.credits ?? 0), 0), wallS: use.reduce((n, r) => n + (r.wallMs ?? 0), 0) / 1000,
    });
  }
  return out;
}

/** The decision from the reference-arm runs only, with the counts behind it. */
function decide(rows, T = THRESHOLDS) {
  const ref = rows.filter((r) => r.role === 'reference' && r.usable);
  const loaded = ref.filter((r) => r.skill?.loaded);
  const refused = ref.filter((r) => r.readRefused > 0);
  const readOk = loaded.filter((r) => r.readSucceeded > 0);
  const noAttempt = loaded.filter((r) => r.readAttempts === 0);
  const readOkUsed = readOk.filter((r) => r.usedReference);
  const counts = { referenceRuns: ref.length, loaded: loaded.length, refused: refused.length, readOk: readOk.length, readOkUsed: readOkUsed.length, noAttempt: noAttempt.length };
  const share = (a, b) => (b ? a / b : null);
  let key;
  let text;
  if (refused.length >= T.refusedAny) {
    key = 'refused';
    text = `REFUSED: ${refused.length} reference-arm run(s) had a reference read refused. The install must grant read access to the skills root.`;
  } else if (loaded.length < T.minLoaded) {
    key = 'inconclusive';
    text = `INCONCLUSIVE: the skill loaded in ${loaded.length} of ${ref.length} usable reference-arm runs (need ${T.minLoaded}). Not loaded, so nothing can be said about the read.`;
  } else if (share(readOk.length, loaded.length) >= T.worksReadShare && share(readOkUsed.length, readOk.length) >= T.worksUsedShare) {
    key = 'works';
    text = `WORKS: ${readOk.length} of ${loaded.length} loaded runs read a reference file, and ${readOkUsed.length} of those carry the planted fact.`;
  } else if (share(noAttempt.length, loaded.length) >= T.noAttemptShare) {
    key = 'no-follow';
    text = `AGENT DOES NOT FOLLOW THE POINTER: ${noAttempt.length} of ${loaded.length} loaded runs never tried a reference read. This is a description or pointer wording issue, not an access issue.`;
  } else {
    key = 'mixed';
    text = `MIXED: of ${loaded.length} loaded runs, ${readOk.length} read a reference file (${readOkUsed.length} used the fact) and ${noAttempt.length} never tried. No rule of the decision table is met.`;
  }
  const refusals = refused.flatMap((r) => r.refusals.map((x) => ({ arm: r.arm, task: r.task, rep: r.rep, ...x })));
  return { key, text, counts, refusals };
}

/** The forced control: does the fact reach the answer when the skill body carries it inline? */
function controlCheck(rows, T = THRESHOLDS) {
  const ctl = rows.filter((r) => r.role === 'control' && r.usable);
  const loaded = ctl.filter((r) => r.skill?.loaded);
  const used = loaded.filter((r) => r.usedReference);
  const share = loaded.length ? used.length / loaded.length : null;
  return { runs: ctl.length, loaded: loaded.length, used: used.length, share, valid: share !== null && share >= T.controlUsedMin };
}

/** The readable positive control: reads that worked inside the workspace. */
function readableCheck(rows) {
  const r = rows.filter((x) => x.role === 'readable' && x.usable);
  return { runs: r.length, attempted: r.filter((x) => x.readAttempts > 0).length, readOk: r.filter((x) => x.readSucceeded > 0).length, used: r.filter((x) => x.usedReference).length };
}

// ---- report ----

const pct = (k, n) => (n ? `${Math.round((100 * k) / n)}%` : 'n/a');
const wil = (k, n) => {
  if (!n) return 'n/a';
  const w = wilson(k, n);
  return `${k}/${n} (${Math.round(w.lo * 100)}-${Math.round(w.hi * 100)}%)`;
};
const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);

function renderReport({ rows, table, decision, control, readable, manifest, T = THRESHOLDS }) {
  const L = [];
  L.push('# References read: can a Kiro agent read a skill reference file?', '');
  L.push(`Runs scored: ${rows.length}. Usable: ${rows.filter((r) => r.usable).length}. Excluded: ${rows.filter((r) => !r.usable).length}. Counts below are over usable runs; intervals are Wilson 95%.`, '');
  L.push('## Arm by outcome', '');
  L.push('| arm | role | usable | not loaded | loaded, no read attempt | read refused | read error | read ok | planted fact in answer | credits | time (s) |');
  L.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const a of table) {
    const o = a.outcomes;
    L.push(`| ${a.arm} | ${a.role ?? '?'} | ${a.usable}${a.excluded ? ` (+${a.excluded} excluded)` : ''} | ${wil(o['not-loaded'], a.usable)} | ${wil(o['no-attempt'], a.usable)} | ${wil(o.refused, a.usable)} | ${wil(o.error, a.usable)} | ${wil(o['read-ok'], a.usable)} | ${wil(a.used, a.usable)} | ${f1(a.credits)} | ${f1(a.wallS)} |`);
  }
  L.push('', 'An outcome is the last stage a run reached: not loaded, loaded but no read attempt, a read that was refused, a read that failed for another reason, or a read that returned the file. A run with a refused read and a good read counts as read ok here and as refused in the decision.', '');

  L.push('## Controls', '');
  L.push(`- Forced control (skill body inline): ${control.loaded} loaded runs, ${wil(control.used, control.loaded)} carry the planted fact. ${control.valid ? 'The control is valid.' : `The control is weak (below ${Math.round(T.controlUsedMin * 100)}%): a miss in a reference arm cannot be put on the reference alone.`}`);
  L.push(`- Readable control (reference text inside the workspace): ${readable.runs} runs, ${readable.attempted} tried to read it, ${readable.readOk} read it, ${readable.used} carry the fact.`, '');

  L.push('## DECISION', '');
  L.push(decision.text, '');
  const c = decision.counts;
  L.push(`Counts: ${c.referenceRuns} usable reference-arm runs; ${c.loaded} loaded the skill; ${c.refused} had a refused read; ${c.readOk} read a reference file; ${c.readOkUsed} of those used the fact; ${c.noAttempt} loaded and never tried.`, '');
  L.push('Pre-registered rules, applied in this order:', '');
  L.push(`1. Any refused reference read (${T.refusedAny} or more runs) means: the install must grant read access to the skills root.`);
  L.push(`2. Fewer than ${T.minLoaded} loaded runs in the reference arms means: inconclusive (not loaded).`);
  L.push(`3. At least ${Math.round(T.worksReadShare * 100)}% of loaded runs read a reference file and at least ${Math.round(T.worksUsedShare * 100)}% of those carry the planted fact means: works.`);
  L.push(`4. At least ${Math.round(T.noAttemptShare * 100)}% of loaded runs never tried a read means: the agent does not follow the pointer (description or pointer wording).`);
  L.push('5. Anything else is reported as mixed.', '');
  if (readable.runs) {
    L.push(decision.key === 'refused' && readable.readOk > 0
      ? 'The readable control read its file while the reference arms were refused, so the refusal comes from the path outside the workspace.'
      : decision.key === 'no-follow' && readable.attempted === 0
        ? 'The readable control did not try either, so the pointer is not followed even when the file is inside the workspace.'
        : 'The readable control is reported above; read it next to the decision.', '');
  }

  L.push('## Refusal messages (verbatim)', '');
  if (!decision.refusals.length) L.push('None.', '');
  for (const r of decision.refusals) L.push(`- ${r.arm} / ${r.task} #${r.rep}, step ${r.n}, \`${r.path}\`:`, '', '  ```', `  ${r.message}`, '  ```', '');

  const read = rows.filter((r) => r.readAttempts > 0);
  L.push('## Read attempts', '');
  if (!read.length) L.push('None.', '');
  else {
    L.push('| arm | task | rep | step | tool | where | outcome | path |', '|---|---|---:|---:|---|---|---|---|');
    for (const r of read) for (const x of r.reads) L.push(`| ${r.arm} | ${r.task} | ${r.rep} | ${x.n} | ${x.via} | ${x.where} | ${x.outcome} | \`${x.path}\` |`);
    L.push('');
  }

  const ex = rows.filter((r) => !r.usable);
  L.push('## Excluded runs', '');
  if (!ex.length) L.push('None.', '');
  for (const r of ex) L.push(`- ${r.arm} / ${r.task} #${r.rep}: ${r.excludedReason}${r.errnoHits?.length ? ` (${r.errnoHits.map((h) => `${h.source}: ${h.match}`).join('; ')})` : ''}. Sandbox errno 38 runs are listed here and counted in no rate.`);
  L.push('', '## Runs', '', '| arm | task | rep | outcome | skill | attempts | ok | refused | error | fact | credits |', '|---|---|---:|---|---|---:|---:|---:|---:|---|---:|');
  for (const r of rows.filter((x) => x.usable)) L.push(`| ${r.arm} | ${r.task} | ${r.rep} | ${r.outcome} | ${r.skill?.loaded ? r.skill.forms.join('+') : 'no'} | ${r.readAttempts} | ${r.readSucceeded} | ${r.readRefused} | ${r.readErrored} | ${r.usedReference ? 'yes' : 'no'} | ${r.credits == null ? 'n/a' : f1(r.credits)} |`);
  L.push('', `Manifest: ${manifest.suiteFile}. Thresholds are in bench/report/refs.js and bench/REFERENCES-READ.md.`, '');
  return L.join('\n');
}

function analyze(runRoots, { manifest = loadManifest(), T = THRESHOLDS } = {}) {
  const rows = loadRows(runRoots, { manifest, T });
  const table = armTable(rows, manifest);
  const decision = decide(rows, T);
  const control = controlCheck(rows, T);
  const readable = readableCheck(rows);
  return { rows, table, decision, control, readable, manifest, thresholds: T };
}

function cmdRefsReport(opts) {
  const runs = [].concat(opts.run === undefined || opts.run === true ? [] : opts.run).flatMap((r) => String(r).split(',')).filter(Boolean);
  if (!runs.length) { console.error('refs-report: --run DIR[,DIR...] is required'); process.exitCode = 2; return; }
  if (!opts.out || opts.out === true) { console.error('refs-report: --out DIR is required'); process.exitCode = 2; return; }
  for (const r of runs) if (!fs.existsSync(r)) { console.error(`refs-report: run directory not found: ${r}`); process.exitCode = 2; return; }
  const a = analyze(runs);
  const out = path.resolve(opts.out);
  fs.mkdirSync(out, { recursive: true });
  const md = renderReport(a);
  fs.writeFileSync(path.join(out, 'refs-report.md'), md);
  fs.writeFileSync(path.join(out, 'refs-report.json'), `${JSON.stringify({ decision: a.decision, control: a.control, readable: a.readable, table: a.table, thresholds: a.thresholds }, null, 2)}\n`);
  fs.writeFileSync(path.join(out, 'refs-runs.jsonl'), `${a.rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  console.log(`refs-report: ${a.rows.length} runs; ${a.decision.text}`);
  console.log(`wrote ${path.join(out, 'refs-report.md')}`);
}

module.exports = {
  THRESHOLDS, OUTCOMES, scoreRun, analyze, decide, controlCheck, readableCheck, armTable, renderReport, cmdRefsReport, classifyRead, referenceReads, skillLoads,
  factPresent, plantedOf, locate, pathsOf, runDirsUnder, loadManifest, errnoHits,
};
