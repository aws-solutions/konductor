// SPDX-License-Identifier: Apache-2.0
'use strict';

// `bench.js scenarios pilot-table DIR...`: one row per pilot run (task, replicate) with the code-scored quality, time,
// credits, the task-health flags of plan section 8a and the SOP or skill loads. Reads saved run directories and the
// task files only: no model call, no credits, nothing written.
//
// Flags (plan 8a):
//   broken        the run ended in an error or a timeout, or a hidden test suite did not parse
//   throttled     the model service refused the run (a throttle), so it never reached the task: rerun it, never a
//                 task defect (counted apart from broken)
//   too-easy      code score 90 or more
//   too-hard      code score 15 or less, or the task's recorded dry run has a reference under 95
//   answer-leak   a tool call named a hidden or answer path, or an output file repeats most of the reference's own text
//   second-family fewer than 1 in 3 tasks of the batch come from a second author family
//   hand-edited, recheck missing   the task has `handEdited` set and no `review.recheck` (blocks a lock, plan section 4)
//   fix           the task file records a lazy score over 40 or pilot.decision "fix" or "drop" (owner rule; read from the current file)
//   noisy         a check gave different results in two replicates of the task, or flipped against a per-check dry run
//                 in which the reference and the stub agreed on it

const fs = require('node:fs');
const path = require('node:path');
const { loadRuns } = require('../report/load.js');
const { checksScore, qualityOfRun, DEFAULT_WEIGHTS } = require('../report/scores.js');
const { familyOf } = require('../judge/family.js');
const { toolNameOf, mcpToolNameOf, mcpInputOf, parseStream, runErrorOf } = require('../runner/lib/stream.js');
const { aggregateHidden } = require('../runner/lib/check-matcher.js');
const { lockBlockers, fixReasons } = require('./ready.js');

const PACK_DIR = __dirname;
const EASY = 90;
const HARD = 15;
const REF_MIN = 95;
const SECOND_FAMILY_SHARE = 1 / 3;
// A tool call whose input names one of these was looking for the answer, not the work.
// shortcut: a name match on the call input, so a fixture folder that is itself called hidden/ would also flag; read the
// call before acting on it, and move to the sandbox's denied-read log when the runner records one.
const LEAK_PATH = /bench\/scenarios\/|(^|[\s/'"])(hidden|solutions|answers|authoring|briefs)\/|\.bench-answer-key/;
const THROTTLE = /throttl|too many requests|rate.?limit|\b429\b/i;
const SHINGLE = 12;          // words per shingle when an output is compared with the reference
const COPY_SHARE = 0.6;      // share of the reference's own shingles (not in the fixture) found in one output file
// A file needs this many own shingles to be judged. 30, not 20: t1-ref-esm-migrate's index.js has 24, all in the one
// import block any correct ESM rewrite writes the same way (wave 5 was a false flag at 79%).
const COPY_MIN_SHINGLES = 30;

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const batchOf = (id) => (/^(t\d+)-/.exec(id) || [])[1] ?? null;

function readJsonOr(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function walkFiles(root, rel = '') {
  let ents = [];
  try { ents = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return []; }
  return ents.flatMap((e) => {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) return e.name === 'node_modules' || e.name === '.git' ? [] : walkFiles(root, r);
    return e.isFile() ? [r] : [];
  });
}

/** Task files and per-batch facts of the pack: { tasks: Map(id -> {task, dir}), families: Map(batch -> share) }. */
function loadPack(packDir = PACK_DIR) {
  const tasks = new Map();
  const families = new Map();
  for (const b of fs.readdirSync(packDir).filter((d) => /^t\d+$/.test(d)).sort()) {
    const dir = path.join(packDir, b);
    const fams = [];
    for (const f of fs.readdirSync(dir).filter((x) => /^t\d+-.*\.json$/.test(x))) {
      const task = readJsonOr(path.join(dir, f));
      if (!task?.id) continue;
      tasks.set(task.id, { task, dir });
      fams.push(familyOf(task.authorship?.model ?? '') ?? task.authorship?.family ?? 'unknown');
    }
    families.set(b, secondFamilyShare(fams));
  }
  return { tasks, families };
}

/** Share of tasks whose author family is not the batch's most common one (0 when the batch has one family). */
function secondFamilyShare(fams) {
  if (!fams.length) return null;
  const count = new Map();
  for (const f of fams) count.set(f, (count.get(f) || 0) + 1);
  const top = Math.max(...count.values());
  return (fams.length - top) / fams.length;
}

/** The code-scored quality of one run, 0..100, or null: hidden tests and substance checks, judges left out. */
// The hidden-test totals of a result; summed from its tests checks when the result predates the field.
const hiddenOf = (r) => r.hiddenTests ?? r.intendedTests ?? aggregateHidden(r.checks);

function codeScore(r) {
  const h = hiddenOf(r);
  const hidden = h && h.total > 0 ? h.passed / h.total : null;
  const q = qualityOfRun({ hidden, checks: checksScore(r.checks, DEFAULT_WEIGHTS) }, DEFAULT_WEIGHTS);
  return q ? q.score : null;
}

// True when the service refused the run: the harness flag, or, for runs saved before the flag, the stream's runError.
function throttled(r, runDir) {
  if ((r.flags || []).includes('throttled')) return true;
  if (r.status === 'success') return false;
  try { return THROTTLE.test(runErrorOf(parseStream(fs.readFileSync(path.join(runDir, 'stream.jsonl'), 'utf8')).events) ?? ''); } catch { return false; }
}

// A throttled run is reported by its own flag (see throttled), never as broken: its empty hidden result follows from it.
function brokenReasons(r, runDir) {
  const out = [];
  if (r.status !== 'success' && r.status !== 'timeout' && throttled(r, runDir)) return out;
  if (r.status === 'timeout') out.push('timeout');
  else if (r.status && r.status !== 'success') out.push(r.status);
  if (r.infraError) out.push('infra error');
  if (hiddenOf(r)?.unparsed) out.push('hidden suite did not parse');
  else if ((r.checks || []).some((c) => c.type === 'tests' && !c.tests)) out.push('hidden suite gave no result');
  return out;
}

/** Tool-call inputs from a saved stream.jsonl that name a hidden or answer path. */
// Paths the task itself names for the agent (its checks' paths and the paths in its request), such as answers/x.json
// in t8-neg-config-question: writing them is the task, not a leak.
function ownPaths(task) {
  const out = new Set((task?.checks || []).map((c) => c.path).filter((p) => typeof p === 'string' && p));
  for (const m of String(task?.prompt || '').matchAll(/[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+/g)) out.add(m[0].replace(/[.,;:]$/, ''));
  return [...out].sort((a, b) => b.length - a.length);
}

function leakedReads(runDir, task = null) {
  const own = ownPaths(task);
  let text;
  try { text = fs.readFileSync(path.join(runDir, 'stream.jsonl'), 'utf8'); } catch { return []; }
  const hits = [];
  const seen = new Set();
  for (const line of text.split('\n')) {
    if (!line.includes('tool_call')) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    const u = ev?.data?.update;
    if (ev?.type !== 'sessionUpdate' || u?.sessionUpdate !== 'tool_call') continue;
    if (u.toolCallId && seen.has(u.toolCallId)) continue;
    if (u.toolCallId) seen.add(u.toolCallId);
    const input = JSON.stringify(mcpInputOf(u.rawInput) ?? u.rawInput ?? '');
    const rest = own.reduce((t, p) => t.split(p).join(' '), input);
    if (LEAK_PATH.test(rest)) hits.push(`${toolNameOf(u) ?? mcpToolNameOf(u) ?? 'tool'}: ${input.slice(0, 120)}`);
  }
  return hits;
}

const words = (s) => s.toLowerCase().split(/\s+/).filter(Boolean);
function shingles(s) {
  const w = words(s);
  const out = new Set();
  for (let i = 0; i + SHINGLE <= w.length; i++) out.add(w.slice(i, i + SHINGLE).join(' '));
  return out;
}
const { readTextOrNull: readText } = require('../runner/lib/util.js');

// Text of `rel` on every branch of a fixture's own git repository (fixtures/<id>/dotgit), so a merge task whose branches
// already hold the answer's lines (t11-merge-pricing-branches) is not flagged for merging them. Cached per fixture.
const branchTextCache = new Map();
function branchTexts(fixDir, rel) {
  if (!fs.existsSync(path.join(fixDir, 'dotgit'))) return '';
  if (!branchTextCache.has(fixDir)) {
    const { copyFixture } = require('../runner/lib/sandbox.js');
    const { execFileSync } = require('node:child_process');
    const os = require('node:os');
    const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'pt-git-'));
    const files = new Map();
    try {
      copyFixture(fixDir, tmp);
      const git = (...a) => execFileSync('git', ['-C', tmp, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      for (const ref of git('for-each-ref', '--format=%(refname)').split('\n').filter(Boolean)) {
        for (const p of git('ls-tree', '-r', '--name-only', ref).split('\n').filter(Boolean)) {
          try { files.set(p, `${files.get(p) ?? ''}\n${git('show', `${ref}:${p}`)}`); } catch { /* binary or gone */ }
        }
      }
    } catch { /* not a usable repository: no branch text */ } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    branchTextCache.set(fixDir, files);
  }
  return branchTextCache.get(fixDir).get(rel) ?? '';
}

/**
 * Output files that repeat most of the reference's own text: for each reference file, the shingles that are not in the
 * fixture's file of the same name (on disk or on any of its branches), and the share of them found in the run's file
 * of that name.
 */
/**
 * The reference files of a solution dir and the workspace path each lands on. A played solution (PLAY.json, the T12
 * worker tasks) keeps each step's files under a step folder (MUX-1/src/inventory.js); the run's workspace holds them
 * without the step prefix (src/inventory.js), so the step folder is dropped (DEBT D-148).
 */
function referenceFiles(sol) {
  if (!fs.existsSync(path.join(sol, 'PLAY.json'))) return walkFiles(sol).map((rel) => ({ refFile: path.join(sol, rel), rel, label: '' }));
  const steps = fs.readdirSync(sol, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  return steps.flatMap((step) => walkFiles(path.join(sol, step)).map((rel) => ({ refFile: path.join(sol, step, rel), rel, label: ` (step ${step})` })));
}

function copiedReference(runDir, entry) {
  if (!entry) return [];
  const sol = path.join(entry.dir, 'solutions', entry.task.id);
  const fix = path.join(entry.dir, 'fixtures', entry.task.fixture ?? entry.task.id);
  const ws = path.join(runDir, 'workspace');
  if (!fs.existsSync(sol) || !fs.existsSync(ws)) return [];
  const out = [];
  for (const { refFile, rel, label } of referenceFiles(sol)) {
    const ref = readText(refFile);
    const got = readText(path.join(ws, rel));
    if (ref === null || got === null) continue;
    // Only text the reference ADDS counts as its own: lines that are not in the fixture's copy of the file. A fix that
    // only deletes or reorders fixture lines (t5-qa-flaky-fix's helpers.js) has no own text, so a correct answer that
    // makes the same deletion is not a copy.
    const known = `${readText(path.join(fix, rel)) ?? ''}\n${branchTexts(fix, rel)}`;
    const fixtureLines = new Set(known.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
    const added = ref.split(/\r?\n/).filter((l) => l.trim() && !fixtureLines.has(l.trim())).join('\n');
    const base = shingles(known);
    // Keep only shingles the reference really holds: joining the added lines makes shingles that span lines which are
    // not next to each other in the file. No copy can hold those, and they pulled a real copy under the bar.
    const real = shingles(ref);
    const own = [...shingles(added)].filter((s) => real.has(s) && !base.has(s));
    if (own.length < COPY_MIN_SHINGLES) continue;
    const have = shingles(got);
    const share = own.filter((s) => have.has(s)).length / own.length;
    if (share >= COPY_SHARE) out.push(`${rel} repeats ${Math.round(share * 100)}% of the reference${label}`);
  }
  return out;
}

/** Per-check results of a dry run where the reference and the stub agreed, by check index: Map(index -> passed). */
// The per-check record of the shared dry run (pilot.dryRun.checks: booleans in check order), else T2's own
// authoring/<id>/dry-run.json ("pass ..." strings).
function insensitiveChecks(entry) {
  const recorded = entry.task.pilot?.dryRun?.checks;
  const dry = recorded ? null : readJsonOr(path.join(entry.dir, 'authoring', entry.task.id, 'dry-run.json'));
  const ref = recorded?.reference ?? dry?.reference?.checks;
  const stub = recorded?.stub ?? dry?.stub?.checks;
  const out = new Map();
  if (!Array.isArray(ref) || !Array.isArray(stub) || ref.length !== stub.length) return out;
  const passed = (s) => s === true || /^pass\b/i.test(String(s));
  ref.forEach((s, i) => { if (passed(s) === passed(stub[i])) out.set(i, passed(s)); });
  return out;
}

const loadsOf = (r) => [...(r.sopsLoaded || []).map((s) => `sop:${s}`), ...(r.skillsLoaded || []).map((s) => (typeof s === 'string' ? s : s?.name ?? '?'))];

/** Rows for the runs under `dirs`, in task and replicate order. */
function pilotRows(dirs, { packDir = PACK_DIR } = {}) {
  const run = loadRuns(dirs);
  const pack = loadPack(packDir);
  const byTask = new Map();
  const rows = [];
  for (const e of run.runs) {
    // A run the budget skipped never started: a visible row with no score and no other flag, never a silent drop.
    if (e.result.status === 'budget_skipped') {
      const entry = pack.tasks.get(e.taskId) ?? null;
      rows.push({
        task: e.taskId, batch: batchOf(e.taskId), arm: e.armId, rep: e.replicate, status: 'budget_skipped', score: null, sec: null, credits: null,
        loads: [], flags: { budget_skipped: e.result.error || 'budget reached' }, skipped: true,
        handEdited: entry?.task.handEdited ? String(entry.task.handEdited.family ?? 'yes') : entry ? 'no' : 'n/a',
        singleFamily: entry?.task.authorship?.singleFamily ? 'single-family-authored' : '-', knownTask: Boolean(entry),
      });
      continue;
    }
    const k = `${e.armId}\u0000${e.taskId}`;
    if (!byTask.has(k)) byTask.set(k, []);
    byTask.get(k).push(e);
  }
  for (const group of byTask.values()) {
    // A check index whose pass/fail differs between replicates of the same task and arm.
    const flips = new Set();
    for (const e of group) (e.result.checks || []).forEach((c, i) => { if (group.some((o) => (o.result.checks || [])[i] && o.result.checks[i].passed !== c.passed)) flips.add(i); });
    for (const e of group) {
      const r = e.result;
      const entry = pack.tasks.get(e.taskId) ?? null;
      const batch = batchOf(e.taskId);
      const score = codeScore(r);
      const flags = {};
      const broken = brokenReasons(r, e.dir);
      if (broken.length) flags.broken = broken.join(', ');
      // A throttled run never reached the task, so its score raises no too-easy or too-hard flag.
      const refused = throttled(r, e.dir) && r.status !== 'success';
      if (refused) flags.throttled = `${r.status}: refused by the model service, rerun it`;
      if (!refused && finite(score) && score >= EASY) flags['too-easy'] = `score ${score.toFixed(0)}`;
      const ref = entry?.task.pilot?.dryRun?.reference;
      if (!refused && finite(score) && score <= HARD) flags['too-hard'] = `score ${score.toFixed(0)}`;
      else if (finite(ref) && ref < REF_MIN) flags['too-hard'] = `reference ${ref} in the dry run`;
      // A negative control's right answer is to change (almost) nothing, so its output matching the reference is
      // expected; only reads of hidden or answer paths count as a leak there.
      const negative = entry?.task.controlKind === 'negative';
      const leak = [...leakedReads(e.dir, entry?.task), ...(negative ? [] : copiedReference(e.dir, entry))];
      if (leak.length) flags['answer-leak'] = leak.join('; ');
      const share = pack.families.get(batch);
      // A batch the owner keeps single-family (authorship.singleFamily) reports it in its own column instead of the flag.
      const singleFamily = entry?.task.authorship?.singleFamily ? 'single-family-authored' : '-';
      if (finite(share) && share < SECOND_FAMILY_SHARE && singleFamily === '-') flags['second-family'] = `${Math.round(share * 100)}% of ${batch} from a second family`;
      const noisy = [...flips].map((i) => `check ${i + 1} differs between replicates`);
      if (entry) for (const [i, want] of insensitiveChecks(entry)) { const c = (r.checks || [])[i]; if (c && c.passed !== want) noisy.push(`check ${i + 1} flipped against the dry run`); }
      if (noisy.length) flags.noisy = noisy.join('; ');
      const fix = entry ? fixReasons(entry.task) : [];
      if (fix.length) flags.fix = fix.join('; ');
      for (const b of entry ? lockBlockers(entry.task) : []) flags[b] = 'no non-Claude re-check in review.recheck';
      // The hand-edit split of plan section 7: the editor's family, or no.
      const he = entry?.task.handEdited;
      const handEdited = he ? String(he.family ?? 'yes') : entry ? 'no' : 'n/a';
      rows.push({
        task: e.taskId, batch, arm: e.armId, rep: e.replicate, status: r.status ?? null, score,
        sec: finite(r.wallClockMs) ? r.wallClockMs / 1000 : null, credits: finite(r.creditsCharged) ? r.creditsCharged : finite(r.credits) ? r.credits : null,
        loads: loadsOf(r), flags, handEdited, singleFamily, knownTask: Boolean(entry),
      });
    }
  }
  return rows.sort((a, b) => a.task.localeCompare(b.task) || a.arm.localeCompare(b.arm) || a.rep - b.rep);
}

const fmt = (v, d = 0) => (finite(v) ? v.toFixed(d) : 'n/a');

// The lazy and alternative scores in pilot.dryRun come from a script, so the table says what they can and cannot show.
const NOTE_DRY_RUN = 'Dry-run note: the shallow (lazy) and alternative answers behind pilot.dryRun are script-made copies of the reference, not independent attempts. For T4 code tasks the shallow answer equals the empty answer, so the shallow gate says nothing there (D-102).';

const FLAG_NAMES = ['broken', 'throttled', 'too-easy', 'too-hard', 'answer-leak', 'second-family', 'noisy', 'fix', 'hand-edited, recheck missing'];

/**
 * The (task, replicate) pairs a skipped run breaks. A pair is unpaired when one arm ran and another was budget_skipped;
 * it stays out of paired analysis (pairedRows) until the skipped side is filled (bench run --resume or --fill-skipped).
 */
function unpaired(rows) {
  const groups = new Map();
  for (const r of rows) {
    const k = `${r.task}\u0000${r.rep}`;
    if (!groups.has(k)) groups.set(k, { task: r.task, rep: r.rep, ran: [], skipped: [] });
    groups.get(k)[r.skipped ? 'skipped' : 'ran'].push(r.arm);
  }
  return [...groups.values()].filter((g) => g.skipped.length)
    .sort((a, b) => a.task.localeCompare(b.task) || a.rep - b.rep);
}

/** The rows of complete pairs only: no run of a (task, replicate) that has a budget_skipped side. */
function pairedRows(rows) {
  const broken = new Set(unpaired(rows).map((g) => `${g.task}\u0000${g.rep}`));
  return rows.filter((r) => !r.skipped && !broken.has(`${r.task}\u0000${r.rep}`));
}

/**
 * Per batch: runs that ran, budget_skipped runs, distinct tasks, and for each flag the number of distinct tasks with at
 * least one flagged run.
 */
function batchSummary(rows) {
  const out = new Map();
  for (const r of rows) {
    const b = r.batch ?? 'none';
    if (!out.has(b)) out.set(b, { batch: b, runs: 0, skipped: 0, tasks: new Set(), flagged: Object.fromEntries(FLAG_NAMES.map((f) => [f, new Set()])) });
    const s = out.get(b);
    if (r.skipped) { s.skipped++; s.tasks.add(r.task); continue; }
    s.runs++;
    s.tasks.add(r.task);
    for (const f of FLAG_NAMES) if (r.flags[f]) s.flagged[f].add(r.task);
  }
  const num = (b) => (/^t(\d+)$/.exec(b) ? Number(b.slice(1)) : Infinity);
  return [...out.values()].sort((a, b) => num(a.batch) - num(b.batch) || a.batch.localeCompare(b.batch))
    .map((s) => ({ batch: s.batch, runs: s.runs, skipped: s.skipped, tasks: s.tasks.size, flagged: Object.fromEntries(FLAG_NAMES.map((f) => [f, s.flagged[f].size])) }));
}

function renderBatches(summary) {
  const L = [`| batch | runs | budget_skipped (runs) | tasks | ${FLAG_NAMES.map((f) => `${f} (tasks)`).join(' | ')} |`, `| --- | --- | --- | --- | ${FLAG_NAMES.map(() => '---').join(' | ')} |`];
  for (const s of summary) L.push(`| ${s.batch} | ${s.runs} | ${s.skipped} | ${s.tasks} | ${FLAG_NAMES.map((f) => s.flagged[f]).join(' | ')} |`);
  return L;
}

function renderTable(rows) {
  const L = ['| task | arm | rep | handEdited | singleFamily | score | time s | credits | flags | loads |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const r of rows) {
    const flags = Object.entries(r.flags).map(([k, v]) => `**${k}** (${v})`).join('<br>') || '-';
    L.push(`| ${r.task}${r.knownTask ? '' : ' (not in the pack)'} | ${r.arm} | ${r.rep} | ${r.handEdited} | ${r.singleFamily} | ${fmt(r.score)} | ${fmt(r.sec)} | ${fmt(r.credits, 2)} | ${flags.replace(/\|/g, '\\|')} | ${r.loads.join(', ') || '-'} |`);
  }
  const total = rows.reduce((n, r) => n + (finite(r.credits) ? r.credits : 0), 0);
  const count = (k) => rows.filter((r) => r.flags[k]).length;
  const rerun = [...new Set(rows.filter((r) => r.flags.noisy).map((r) => r.task))];
  const skipped = rows.filter((r) => r.skipped).length;
  L.push('', `${rows.length - skipped} run(s), ${total.toFixed(2)} credits${skipped ? `, and ${skipped} budget_skipped (never ran)` : ''}. Score is the code-scored part only (hidden tests and substance checks; no judges).`);
  const open = unpaired(rows);
  if (open.length) {
    L.push(`Unpaired, left out of paired analysis until filled (bench run --resume or --fill-skipped): ${open.map((g) => `${g.task} #${g.rep} (${g.ran.length ? `ran ${g.ran.join(', ')}; ` : ''}skipped ${g.skipped.join(', ')})`).join('; ')}.`);
  }
  L.push('', ...renderBatches(batchSummary(rows)));
  L.push(`Flagged runs: broken ${count('broken')}, throttled ${count('throttled')}, too-easy ${count('too-easy')}, too-hard ${count('too-hard')}, answer-leak ${count('answer-leak')}, second-family ${count('second-family')}, noisy ${count('noisy')}, fix ${count('fix')}, hand-edited with no re-check ${count('hand-edited, recheck missing')}.`);
  L.push(`Second run for noisy tasks: ${rerun.length ? rerun.join(',') : 'none'}`);
  L.push(NOTE_DRY_RUN);
  return `${L.join('\n')}\n`;
}

function cmdPilotTable(opts) {
  const dirs = opts._.slice(1);
  if (!dirs.length) throw new Error('scenarios pilot-table needs the wave directories: bench.js scenarios pilot-table DIR...');
  const packDir = typeof opts.pack === 'string' ? path.resolve(opts.pack) : PACK_DIR;
  const rows = pilotRows(dirs, { packDir });
  process.stdout.write(opts.json ? `${JSON.stringify(rows, null, 2)}\n` : renderTable(rows));
}

module.exports = { pilotRows, renderTable, cmdPilotTable, loadPack, secondFamilyShare, codeScore, batchSummary, unpaired, pairedRows, throttled, FLAG_NAMES };
