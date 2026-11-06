// SPDX-License-Identifier: Apache-2.0
'use strict';

// The evidence-quote rule in reports: lenient is the default, strict is selectable and reproduces the earlier numbers, every
// page names the rule, and the strict view is shown beside the default. In-process; no bench.js, no model.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench, makeRun } = require('./helpers.js');
const { fixtureRun, mk, TASKS6 } = require('./verdict-fixtures.js');
const { loadScoring, quoteRuleOf } = require('../../report/scores.js');
const { loadRuns, loadRun } = require('../../report/load.js');
const { generateRunReport, generateContrast, analyze, quoteSensitivity } = require('../../report/generate.js');
const { buildVerdict } = require('../../report/verdict.js');
const { buildOrchestratorPass } = require('../../report/orchpass.js');
const { generateVerdict } = require('../../report/verdictgen.js');
const { platformSensitivity } = require('../../report/quotes.js');
const { verdictSensitivityBlocks, ruleBlocks } = require('../../report/quotedoc.js');
const { toMarkdown } = require('../../report/doc.js');
const { contrastRun } = require('../../report/contrast.js');
const { loadTasks } = require('../lib/tasks.js');
const { dualCriteria, dualScores, matchersFor } = require('../../judge/views.js');
const { qualityBlocks, PACK_QUOTE_LINE } = require('../../report/quality.js');

const PROFILES = path.join(__dirname, '..', '..', 'profiles');
const cleanup = (root) => fs.rmSync(root, { recursive: true, force: true });
const LENIENT_LINE = 'Evidence-quote rule: lenient (tightened: quotes with 20 or more unsupported letters are rejected). Strict sensitivity:';
const STRICT_LINE = 'Evidence-quote rule: strict (every segment between ellipses must appear in the output, in order). Lenient sensitivity:';

// ---- the scoring key ----

test('lenient is the default; strict is selectable and the loaded object carries it only for strict', () => {
  const defaults = loadScoring();
  assert.equal(defaults.quoteMode, undefined);
  assert.equal(quoteRuleOf(defaults), 'lenient');
  for (const f of ['scoring.json', 'scoring-fractional.json', 'scoring-quality.json', 'scoring-quality-fractional.json', 'scoring-lenient-quotes.json']) {
    assert.equal(quoteRuleOf(loadScoring(path.join(PROFILES, f), { allowPack: true })), 'lenient', f);
  }
  const strict = loadScoring(path.join(PROFILES, 'scoring-strict-quotes.json'));
  assert.equal(strict.quoteMode, 'strict');
  assert.equal(quoteRuleOf(strict), 'strict');
  assert.deepEqual({ ...strict, quoteMode: undefined }, { ...defaults, quoteMode: undefined }, 'the strict profile has the default weights');
  assert.deepEqual(loadScoring(path.join(PROFILES, 'scoring-lenient-quotes.json')), defaults);
  const root = tmp();
  try {
    write(path.join(root, 'bad.json'), JSON.stringify({ weights: { rubric: 1 }, quotes: 'sloppy' }));
    assert.throws(() => loadScoring(path.join(root, 'bad.json')), /"quotes" must be one of "strict", "lenient"/);
  } finally { cleanup(root); }
});

// ---- a judged run with both views ----

/**
 * Judgments for every run of runDir: judge j1 (and j2 when two) record c1 pass and c2 pass raw. For runs where lower(arm, task, rep)
 * is true the strict rule lowers c2 to partial (the lenient rule keeps it); `old` writes the record as it was before the dual view.
 */
function writeJudged(runDir, { lower, judges = ['j1', 'j2'], old = false }) {
  const run = loadRun(runDir);
  const rubric = [];
  for (const e of run.runs) {
    for (const judge of judges) {
      const strictLow = lower(e.armId, e.taskId, e.replicate);
      const raw = [{ id: 'c1', verdict: 'pass', evidence: 'alpha' }, { id: 'c2', verdict: 'pass', evidence: 'bravo' }];
      // Matchers that say what the fixture wants: c2's quote is found by lenient only when strictLow.
      const found = (quote) => (quote === 'bravo' && strictLow ? { strict: false, lenient: true } : { strict: true, lenient: true });
      const stub = { strict: (q) => found(q).strict, lenient: (q) => found(q).lenient };
      const criteria = dualCriteria(raw, stub, 'lenient');
      const views = dualScores([{ id: 'c1', weight: 1 }, { id: 'c2', weight: 3 }], criteria);
      const base = { kind: 'rubric', judge, armId: e.armId, taskId: e.taskId, replicate: e.replicate, taskRevision: null, scoreRaw: 1, judgeError: null, parseFailures: 0, calls: [{ credits: 0.1, latencyMs: 1, cached: false, ok: true }], redactionsFired: {} };
      if (old) {
        rubric.push({ ...base, score: views.strict, criteria: criteria.map((c) => ({ id: c.id, verdict: c.verdictStrict, verdictRaw: c.verdictRaw, verdictScored: c.verdictStrict, evidence: c.evidence, evidenceFound: c.quoteFound.strict, ...(c.quoteFound.strict ? {} : { evidenceDowngraded: true }) })) });
      } else {
        rubric.push({ ...base, quoteRule: 'lenient', score: views.lenient, scoreStrict: views.strict, scoreLenient: views.lenient, criteria });
      }
    }
  }
  write(path.join(runDir, 'judgments.json'), JSON.stringify({ schemaVersion: 1, baseline: 'vanilla', judges, modes: ['rubric'], limits: { maxFileChars: 6000, maxBundleChars: 24000 }, rubric, pairwise: [] }));
}

function judgedRun({ old = false } = {}) {
  const root = mk();
  const { dir, benchDir } = fixtureRun(root, 'r', {
    arms: { vanilla: { hidden: [8, 9, 8, 9, 8] }, head: { hidden: [8, 9, 8, 9, 8] } }, reps: 3, tasks: ['t1', 't2'],
  });
  // The strict rule lowers every head run; vanilla is untouched.
  writeJudged(dir, { lower: (arm) => arm === 'head', old });
  return { root, dir, benchDir };
}

test('a report under the default rule names it and shows the strict view beside it', () => {
  const { root, dir, benchDir } = judgedRun();
  try {
    const tasks = loadTasks(benchDir);
    const out = path.join(root, 'out');
    const res = generateRunReport({ run: loadRuns([dir]), tasks, baseline: 'vanilla', out, detail: 'full', format: 'md', defaultDir: out });
    const md = fs.readFileSync(path.join(out, 'report.md'), 'utf8');
    assert.ok(md.startsWith('# Benchmark report'), 'the title stays first');
    assert.ok(md.includes(LENIENT_LINE), 'the rule line is on the page');
    assert.match(md, /## Quote-rule sensitivity/);
    assert.match(md, /evidence quotes lowered, lenient rule: j1 0% \(strict 25%\)/, 'the scorecard shows the strict rate beside the default one');
    assert.match(md, /Mean rubric \(0 to 1\) and quality \(0 to 100\) per arm under both rules/);
    assert.equal(res.json.quoteRule.requested, 'lenient');
    assert.equal(res.json.quoteSensitivity.available, true);
    const head = res.json.quoteSensitivity.arms.find((a) => a.arm === 'head');
    assert.ok(head.rubric > head.otherRubric, 'lenient rubric is above strict for the arm the strict rule lowers');
    assert.ok(head.quality > head.otherQuality);
    const j1 = res.json.quoteSensitivity.judges.find((j) => j.judge === 'j1');
    assert.equal(j1.rate, 0);
    assert.ok(j1.otherRate > 0);
    const quick = generateRunReport({ run: loadRuns([dir]), tasks, baseline: 'vanilla', out: path.join(root, 'q'), detail: 'quick', format: 'md', defaultDir: out });
    const qmd = fs.readFileSync(path.join(root, 'q', 'report.md'), 'utf8');
    assert.ok(qmd.includes(LENIENT_LINE));
    assert.match(qmd, /mean quality per arm, lenient to strict: /);
    assert.ok(quick.json.quoteSensitivity);
  } finally { cleanup(root); }
});

test('the strict profile gives the strict view numbers, and the default view sees them as its sensitivity', () => {
  const { root, dir, benchDir } = judgedRun();
  try {
    const tasks = loadTasks(benchDir);
    const strictFile = path.join(PROFILES, 'scoring-strict-quotes.json');
    const lenient = analyze({ run: loadRuns([dir]), tasks, baseline: 'vanilla' });
    const strict = analyze({ run: loadRuns([dir]), tasks, baseline: 'vanilla', scoringFile: strictFile });
    const sens = quoteSensitivity({ run: loadRuns([dir]), tasks, baseline: 'vanilla', primary: lenient });
    for (const arm of ['vanilla', 'head']) {
      assert.equal(sens.arms.find((a) => a.arm === arm).otherQuality, strict.scores.arms[arm].overall.quality.value, `${arm}: the sensitivity equals a strict report`);
      assert.equal(sens.arms.find((a) => a.arm === arm).quality, lenient.scores.arms[arm].overall.quality.value);
    }
    assert.equal(strict.quote.requested, 'strict');
    const out = path.join(root, 'out');
    generateRunReport({ run: loadRuns([dir]), tasks, baseline: 'vanilla', out, detail: 'full', format: 'md', scoringFile: strictFile, defaultDir: out });
    const md = fs.readFileSync(path.join(out, 'report.md'), 'utf8');
    assert.ok(md.includes(STRICT_LINE));
    assert.equal(strict.weights.quoteMode, 'strict');
  } finally { cleanup(root); }
});

test('rank flips and an order warning appear when the rules order the arms differently', () => {
  const root = mk();
  try {
    const { dir, benchDir } = fixtureRun(root, 'r', { arms: { vanilla: { hidden: [9, 9, 9, 9, 9] }, head: { hidden: [8, 8, 8, 8, 8] } }, reps: 3, tasks: ['t1', 't2'] });
    // Vanilla scores higher under the lenient rule; the strict rule lowers every vanilla run, which puts head first.
    writeJudged(dir, { lower: (arm) => arm === 'vanilla' });
    const tasks = loadTasks(benchDir);
    const a = analyze({ run: loadRuns([dir]), tasks, baseline: 'vanilla' });
    const sens = quoteSensitivity({ run: loadRuns([dir]), tasks, baseline: 'vanilla', primary: a });
    assert.equal(sens.orderDiffers, true);
    assert.match(sens.warning, /arm order by quality differs between the rules/);
    assert.ok(sens.arms.some((x) => x.flip));
    const md = toMarkdown(ruleBlocks(a.quote, sens, { tables: 'arms' }));
    assert.match(md, /\*\*FLIP\*\*/);
    assert.match(md, /Warning|differs between the rules/);
  } finally { cleanup(root); }
});

test('an old record gets its lenient view from the saved output; without the output the report says strict only and does not throw', () => {
  const { root, dir, benchDir } = judgedRun({ old: true });
  try {
    const tasks = loadTasks(benchDir);
    const stored = fs.readFileSync(path.join(dir, 'judgments.json'), 'utf8');
    const strictOnly = analyze({ run: loadRuns([dir]), tasks, baseline: 'vanilla', scoringFile: path.join(PROFILES, 'scoring-strict-quotes.json') });
    assert.equal(strictOnly.quote.state, 'full', 'strict reads old records as stored');
    // The fixture's made-up quotes are not in the output, so the rebuilt lenient view lowers them too and nothing is "found": the view is built, not copied.
    const lenient = analyze({ run: loadRuns([dir]), tasks, baseline: 'vanilla' });
    assert.equal(lenient.quote.rebuilt > 0 || lenient.quote.missing > 0, true);
    assert.equal(fs.readFileSync(path.join(dir, 'judgments.json'), 'utf8'), stored, 'judgments.json is not written');
    assert.equal(fs.existsSync(path.join(dir, 'judgments-lenient.json')), false, 'no extra file is written');
    for (const e of loadRun(dir).runs) fs.rmSync(path.join(e.dir, 'workspace'), { recursive: true, force: true });
    const out = path.join(root, 'out');
    const res = generateRunReport({ run: loadRuns([dir]), tasks, baseline: 'vanilla', out, detail: 'full', format: 'md', defaultDir: out });
    const md = fs.readFileSync(path.join(out, 'report.md'), 'utf8');
    assert.match(md, /strict only: lenient view needs judge --rescore-quotes/);
    assert.equal(res.json.quoteRule.state, 'strict-only');
    assert.equal(res.json.quoteSensitivity.available, false);
  } finally { cleanup(root); }
});

test('contrast carries the rule line and the arm table', () => {
  const { root, dir, benchDir } = judgedRun();
  try {
    const tasks = loadTasks(benchDir);
    const run = loadRuns([dir]);
    const a = analyze({ run, tasks, baseline: 'vanilla' });
    const c = contrastRun({ run, tasks, base: 'vanilla', heads: ['head'], minRel: 0.15, rule: 'both', by: 'class' });
    const out = path.join(root, 'o');
    generateContrast({ run, tasks, c, out, detail: 'quick', format: 'md', defaultDir: out });
    const md = fs.readFileSync(path.join(out, 'contrast.md'), 'utf8');
    assert.ok(md.includes(LENIENT_LINE));
    assert.match(md, /Mean rubric \(0 to 1\) and quality/);
    assert.equal(a.quote.requested, 'lenient');
  } finally { cleanup(root); }
});

// ---- verdicts ----

test('report --verdict platform accepts either rule and records the strict view as a sensitivity', () => {
  const root = mk();
  try {
    const { dir, benchDir } = fixtureRun(root, 'v', {
      arms: { vanilla: { sha: 'a', hidden: [8, 9, 8, 9, 8] }, head: { sha: 'b', hidden: [9, 9, 9, 9, 9] } }, reps: 5, tasks: TASKS6.slice(0, 5),
    });
    writeJudged(dir, { lower: (arm) => arm === 'head' });
    const strictFile = path.join(PROFILES, 'scoring-strict-quotes.json');
    const v = buildVerdict({ dirs: [dir], benchDir, baseline: 'vanilla' });
    assert.equal(v.quote.requested, 'lenient');
    assert.equal(v.sensitivity.available, true);
    assert.equal(v.sensitivity.other, 'strict');
    const w = buildVerdict({ dirs: [dir], benchDir, baseline: 'vanilla', scoringFile: strictFile });
    assert.equal(w.quote.requested, 'strict', 'a strict scoring file is no longer refused');
    assert.equal(w.sensitivity.other, 'lenient');
    const a = v.sensitivity.arms.find((x) => x.label.startsWith('head'));
    const b = w.arms.find((x) => x.label.startsWith('head'));
    assert.equal(a.delta, b.quality.delta, 'the sensitivity of the default is the strict verdict');
    const out = path.join(root, 'out');
    const res = generateVerdict({ kind: 'platform', dirs: [dir], benchDir, baseline: 'vanilla', out, format: 'md' });
    const md = fs.readFileSync(path.join(out, 'verdict.md'), 'utf8');
    assert.ok(md.includes(LENIENT_LINE));
    assert.match(md, /## Sensitivity: strict quote rule/);
    assert.match(md, /(same call|DIFFERENT CALL)/);
    assert.ok(res.v.sensitivity);
  } finally { cleanup(root); }
});

test('the orchestrator pass accepts either rule, names it, and shows the strict sensitivity', () => {
  const root = mk();
  try {
    const { dir, benchDir } = fixtureRun(root, 'o', {
      arms: { vanilla: { sha: 'a', hidden: [8, 9, 8, 9, 8] }, head: { sha: 'b', hidden: [9, 9, 9, 9, 9] } }, reps: 3, tasks: TASKS6.slice(0, 5),
    });
    writeJudged(dir, { lower: (arm) => arm === 'head' });
    const v = buildOrchestratorPass({ dirs: [dir], benchDir, baseline: 'vanilla' });
    assert.equal(v.quote.requested, 'lenient');
    assert.equal(v.sensitivity.available, true);
    const w = buildOrchestratorPass({ dirs: [dir], benchDir, baseline: 'vanilla', scoringFile: path.join(PROFILES, 'scoring-strict-quotes.json') });
    assert.equal(w.quote.requested, 'strict');
    const out = path.join(root, 'out');
    generateVerdict({ kind: 'orchestrator-pass', dirs: [dir], benchDir, baseline: 'vanilla', out, format: 'md' });
    const md = fs.readFileSync(path.join(out, 'orchestrator-pass.md'), 'utf8');
    assert.ok(md.includes(LENIENT_LINE));
    assert.match(md, /## Sensitivity: strict quote rule/);
  } finally { cleanup(root); }
});

test('the sensitivity block marks a changed call as DIFFERENT CALL and an unchanged one as same call', () => {
  const v = { quote: { requested: 'lenient', state: 'full' }, arms: [{ label: 'a', verdict: 'KEEP', quality: { delta: 6, deltaCiLow: 1, deltaCiHigh: 11 } }, { label: 'b', verdict: 'NOT ENOUGH EVIDENCE', quality: { delta: 1 } }] };
  const o = { quote: { requested: 'strict', state: 'full' }, arms: [{ label: 'a', verdict: 'NOT ENOUGH EVIDENCE', reason: 'inside the noise', quality: { delta: 3.2, deltaCiLow: -1, deltaCiHigh: 7.4, level: 0.95 }, noise: { available: true, pts: 5 } }, { label: 'b', verdict: 'NOT ENOUGH EVIDENCE', quality: { delta: 0.5, deltaCiLow: -3, deltaCiHigh: 4, level: 0.95 }, noise: { available: true, pts: 5 } }] };
  const sens = platformSensitivity(v, o);
  assert.equal(sens.anyDifferent, true);
  assert.deepEqual(sens.arms.map((a) => a.same), [false, true]);
  const md = toMarkdown(verdictSensitivityBlocks(sens));
  assert.match(md, /## Sensitivity: strict quote rule/);
  assert.match(md, /\*\*DIFFERENT CALL\*\*/);
  assert.match(md, /same call/);
  assert.match(md, /\+3\.2 \[-1\.0, 7\.4\] at 95\.0%/);
  assert.match(md, /5\.0 points/);
  assert.match(toMarkdown(verdictSensitivityBlocks({ available: false, rule: 'lenient', other: 'strict', reason: 'x' })), /Not available: x/);
});

// ---- the pack ----

test('the quality-pack tables are labelled strict and say the rubric rule does not apply to them', () => {
  const s = {
    pack: { id: 'quality', revision: 'r1' }, indicative: true, disagreeScore: 0.2, dimensions: [{ id: 'd', label: 'Dim' }], groups: [{ id: 'g', label: 'G', runs: 1, judges: ['j1'], dimensions: { d: { score: 80, n: 1, na: 0, naReasons: [], disagree: false } } }],
    judges: ['j1'], backend: 'kiro', spend: { credits: 1, usd: null }, process: [], stale: 0, staleBy: { pack: 0, task: 0 }, staleRevisions: [], usable: 1, errors: 0, note: 'n',
  };
  let md;
  try { md = toMarkdown(qualityBlocks(s)); } catch (e) { md = null; assert.fail(`qualityBlocks threw: ${e.message}`); }
  assert.ok(md.includes(PACK_QUOTE_LINE));
  assert.match(md, /quality pack quotes: strict/);
});
