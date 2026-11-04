// SPDX-License-Identifier: Apache-2.0
/**
 * The markdown report: two pinned full reports (a run whose controls all pass and a run with a
 * failing control), the wording of the gate states, determinism, the stored-record form, and the
 * rule that no answer, file content, task id or other skill name reaches it.
 * Run: node --test bench/test/report.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { renderReport } = require('../lib/report');
const { runSummary, CONTROLS } = require('../lib/controls');
const { runJudging } = require('../run/judge');
const { openStore } = require('../lib/store');
const { aggregateOf, WITH_WINS, WITHOUT_WINS, NO_DIFFERENCE } = require('./support/control-results');
const { makePair, SKILL } = require('./support/records');
const { roster } = require('./support/roster');
const { taskSetOf, scriptedPlugin } = require('./support/run-fixture');

const [KEEP, PRUNE, NULL] = CONTROLS;
const passes = (total, passed) => Array.from({ length: total }, (_, i) => i < passed);

// ---- runs -----------------------------------------------------------------------------------

/** Ten tasks. The with arm passes 6 to 8 of 10 checks, the without arm 5 or 6. Agrees with the judge. */
const agreeing = () =>
  aggregateOf('style-guide', WITH_WINS, {
    wordChecks: (i) => ({ with: passes(10, 6 + (i % 3)), without: passes(10, 5 + (i % 2)) }),
  });
/** Ten tasks. The with arm passes 2 or 3 of 10 checks, the without arm 7 or 8: the gate vetoes keep. */
const disagreeing = () =>
  aggregateOf('zeta-notes', WITH_WINS, {
    wordChecks: (i) => ({ with: passes(10, 2 + (i % 2)), without: passes(10, 8 - (i % 2)) }),
  });
/** Ten tasks, three with checks: the gate is off. */
const fewChecks = () =>
  aggregateOf('few-checks', WITH_WINS, {
    wordChecks: (i) => (i < 3 ? { with: passes(4, 3), without: passes(4, 1) } : undefined),
  });
/** Ten tasks, the with run of the third did not load the skill. */
const loadFailure = () => aggregateOf('loader-trouble', WITH_WINS, { loaded: (i) => i !== 2 });

const controlResults = ({ pruneGaps = WITHOUT_WINS } = {}) => ({
  [KEEP.skill]: aggregateOf(KEEP.skill, WITH_WINS),
  [PRUNE.skill]: aggregateOf(PRUNE.skill, pruneGaps),
  [NULL.skill]: aggregateOf(NULL.skill, NO_DIFFERENCE),
});

// ---- pinned reports -------------------------------------------------------------------------

const THRESHOLDS = [
  'Provisional thresholds (decision rule paired-t/v1, word-check gate word-check-veto/v1). ' +
    'They come from a small early run and are not calibrated on this suite. A prune is a ' +
    'candidate for human approval, never an action.',
  '',
  '- keep (provisional): the 95% interval of the judge gap lies entirely above +0.10.',
  '- prune (provisional): the 99% one-sided upper bound of the judge gap lies below -0.20.',
  '- Both need at least 8 usable pairs (provisional).',
  '- Word-check gate (provisional): with at least 8 pairs with checks, a keep whose 95% ' +
    'word-check interval lies entirely below 0, or a prune whose interval lies entirely above 0, ' +
    'becomes needs human review. The gate never creates a keep or a prune.',
].join('\n');

const PASSING_REPORT = `# Benchmark report

Run status: PASS

${THRESHOLDS}

## Controls

- keep control (\`tarnwick-conventions\`): PASS. Verdict keep, expected keep.
  - Reason: keep control: keep as expected; mean score gap 2.10, 95% lower bound above +0.1; word checks off: 0 pairs with checks, need 8
- prune control (\`team-coding-notes\`): PASS. Verdict prune, expected prune.
  - Reason: prune control: prune as expected; mean score gap -2.10, 99% upper bound below -0.2; word checks off: 0 pairs with checks, need 8
- null control (\`plain-writing-habits\`): PASS. Verdict needs human review, expected needs human review.
  - Reason: null control: needs human review as expected; mean score gap 0.00, interval does not clear +0.1 or -0.2; word checks off: 0 pairs with checks, need 8

## Skills

### \`few-checks\`

- Final verdict: keep
- Judge-only verdict: keep
- Judge gap (with minus without): mean +2.10, 95% interval [+1.87, +2.33], 10 usable pairs
- Word-check gap: gate off: 3 pairs with checks, need 8
- Gate changed the verdict: no
- Trusted: yes
- Reason: mean score gap 2.10, 95% lower bound above +0.1; word checks off: 3 pairs with checks, need 8
- Pairs left out: 0 load failures, 0 treatment failures, 0 unscored

### \`loader-trouble\`

- Final verdict: needs human review
- Judge-only verdict: needs human review
- Judge gap (with minus without): not computed, 9 usable pairs
- Word-check gap: gate off: 0 pairs with checks, need 8
- Gate changed the verdict: no
- Trusted: yes
- Reason: skill did not load in 1/10 planned with runs; word checks off: 0 pairs with checks, need 8
- Pairs left out: 1 load failures, 0 treatment failures, 0 unscored

### \`style-guide\`

- Final verdict: keep
- Judge-only verdict: keep
- Judge gap (with minus without): mean +2.10, 95% interval [+1.87, +2.33], 10 usable pairs
- Word-check gap (with minus without): mean +0.14, 95% interval [+0.06, +0.22], 10 pairs with checks
- Gate changed the verdict: no
- Trusted: yes
- Reason: mean score gap 2.10, 95% lower bound above +0.1; word-check gap (with minus without) +0.14 (95% interval [+0.06, +0.22] over 10 pairs)
- Pairs left out: 0 load failures, 0 treatment failures, 0 unscored

### \`zeta-notes\`

- Final verdict: needs human review
- Judge-only verdict: keep
- Judge gap (with minus without): mean +2.10, 95% interval [+1.87, +2.33], 10 usable pairs
- Word-check gap (with minus without): mean -0.50, 95% interval [-0.58, -0.42], 10 pairs with checks
- Gate changed the verdict: yes, from keep to needs human review, because the word-check interval lies entirely below 0, so the checks say the skill is worse
- Trusted: yes
- Reason: word checks say the skill is worse: word-check gap (with minus without) -0.50 (95% interval [-0.58, -0.42] over 10 pairs); judge verdict was keep (mean score gap 2.10, 95% lower bound above +0.1)
- Pairs left out: 0 load failures, 0 treatment failures, 0 unscored
`;

const FAILING_REPORT = `# Benchmark report

Run status: FAIL

${THRESHOLDS}

## Controls

- keep control (\`tarnwick-conventions\`): PASS. Verdict keep, expected keep.
  - Reason: keep control: keep as expected; mean score gap 2.10, 95% lower bound above +0.1; word checks off: 0 pairs with checks, need 8
- prune control (\`team-coding-notes\`): FAIL. Verdict keep, expected prune.
  - Reason: prune control: expected prune, got keep; mean score gap 2.10, 95% lower bound above +0.1; word checks off: 0 pairs with checks, need 8
- null control (\`plain-writing-habits\`): PASS. Verdict needs human review, expected needs human review.
  - Reason: null control: needs human review as expected; mean score gap 0.00, interval does not clear +0.1 or -0.2; word checks off: 0 pairs with checks, need 8

## Skills

### \`style-guide\`

- Final verdict: keep
- Judge-only verdict: keep
- Judge gap (with minus without): mean +2.10, 95% interval [+1.87, +2.33], 10 usable pairs
- Word-check gap (with minus without): mean +0.14, 95% interval [+0.06, +0.22], 10 pairs with checks
- Gate changed the verdict: no
- Trusted: no
  - prune control: expected prune, got keep; mean score gap 2.10, 95% lower bound above +0.1; word checks off: 0 pairs with checks, need 8
- Reason: mean score gap 2.10, 95% lower bound above +0.1; word-check gap (with minus without) +0.14 (95% interval [+0.06, +0.22] over 10 pairs)
- Pairs left out: 0 load failures, 0 treatment failures, 0 unscored
`;

test('golden: a run whose controls all pass', () => {
  const run = runSummary({
    ...controlResults(),
    'zeta-notes': disagreeing(),
    'style-guide': agreeing(),
    'loader-trouble': loadFailure(),
    'few-checks': fewChecks(),
  });
  assert.equal(run.status, 'PASS');
  assert.equal(renderReport(run), PASSING_REPORT);
});

test('golden: a run with a failing control marks the skill untrusted and shows why', () => {
  const run = runSummary({ ...controlResults({ pruneGaps: WITH_WINS }), 'style-guide': agreeing() });
  assert.equal(run.status, 'FAIL');
  assert.equal(renderReport(run), FAILING_REPORT);
});

// ---- wording of the states ------------------------------------------------------------------

test('every threshold is introduced with the word provisional', () => {
  const text = renderReport(runSummary(controlResults()));
  const lines = text.split('\n');
  for (const needle of ['- keep ', '- prune ', '- Both need', '- Word-check gate']) {
    const line = lines.find((l) => l.startsWith(needle));
    assert.ok(line, needle);
    assert.match(line, /provisional/, needle);
  }
  assert.match(text, /\+0\.10/);
  assert.match(text, /-0\.20/);
});

test('the gate-off line names how many pairs have checks and how many are needed', () => {
  const text = renderReport(runSummary({ ...controlResults(), 'few-checks': fewChecks() }));
  assert.match(text, /gate off: 3 pairs with checks, need 8/);
});

test('a skill with the gap shown but the verdict kept says the gate changed nothing', () => {
  const kept = aggregateOf('lean-skill', WITH_WINS, {
    wordChecks: (i) => ({
      with: passes(10, [4, 6, 3, 5, 4, 7, 5, 4, 5, 5][i]),
      without: passes(10, [5, 5, 6, 5, 6, 5, 5, 5, 5, 5][i]),
    }),
  });
  assert.equal(kept.verdict.verdict, 'keep');
  assert.ok(kept.verdict.word_check.mean < 0, 'the with arm passes fewer checks');
  const text = renderReport(runSummary({ ...controlResults(), 'lean-skill': kept }));
  const block = text.slice(text.indexOf('### `lean-skill`'));
  assert.match(block, /Final verdict: keep\n/);
  assert.match(block, /Word-check gap \(with minus without\): mean -0\.\d\d, 95% interval \[-0\.\d\d, \+0\.\d\d\]/);
  assert.match(block, /Gate changed the verdict: no\n/);
});

test('a prune turned into review says the checks say the skill is better', () => {
  const vetoed = aggregateOf('prune-vetoed', WITHOUT_WINS, {
    wordChecks: (i) => ({ with: passes(10, 8 + (i % 2)), without: passes(10, 3) }),
  });
  assert.equal(vetoed.graded.verdict, 'prune');
  const text = renderReport(runSummary({ ...controlResults(), 'prune-vetoed': vetoed }));
  assert.match(text, /Gate changed the verdict: yes, from prune to needs human review, because the word-check interval lies entirely above 0, so the checks say the skill is better/);
});

test('a judge verdict of review shows the word-check numbers as context and no change', () => {
  const flat = aggregateOf('flat-skill', NO_DIFFERENCE, {
    wordChecks: () => ({ with: passes(10, 9), without: passes(10, 2) }),
  });
  const text = renderReport(runSummary({ ...controlResults(), 'flat-skill': flat }));
  const block = text.slice(text.indexOf('### `flat-skill`'));
  assert.match(block, /Final verdict: needs human review/);
  assert.match(block, /Word-check gap \(with minus without\): mean \+0\.70/);
  assert.match(block, /Gate changed the verdict: no/);
});

test('an entry without trusted or word-check data says so instead of guessing', () => {
  const plain = aggregateOf('plain-skill', WITH_WINS);
  const old = JSON.parse(JSON.stringify(plain));
  delete old.verdict.word_check;
  delete old.verdict.judge_verdict;
  const text = renderReport({ status: 'PASS', controls: [], skills: { 'plain-skill': plain, 'old-skill': old } });
  assert.match(text, /No controls were evaluated\./);
  assert.match(text, /Trusted: unknown \(the run was not summarised against its controls\)/);
  const oldBlock = text.slice(text.indexOf('### `old-skill`'));
  assert.match(oldBlock, /- Word-check gap: not recorded/);
  assert.match(oldBlock, /Judge-only verdict: keep/);
});

// ---- determinism and form -------------------------------------------------------------------

test('the same run gives the same text whatever order its keys were written in', () => {
  const entries = {
    ...controlResults(),
    'zeta-notes': disagreeing(),
    'style-guide': agreeing(),
    'few-checks': fewChecks(),
  };
  const reversed = Object.fromEntries(Object.entries(entries).reverse());
  const one = renderReport(runSummary(entries));
  assert.equal(renderReport(runSummary(reversed)), one);
  assert.equal(renderReport(runSummary(entries)), one);
  const order = [...one.matchAll(/^### `([^`]+)`$/gm)].map((m) => m[1]);
  assert.deepEqual(order, ['few-checks', 'style-guide', 'zeta-notes']);
});

test('the report module reads no clock, random source, file or environment', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'report.js'), 'utf8');
  assert.doesNotMatch(source, /\bDate\b|Math\.random|process\.|performance\.|require\('node:(fs|os|path|crypto)'\)/);
});

test('a stored result record renders like the aggregate it holds', () => {
  const aggregate = agreeing();
  const record = { skill: 'style-guide', decision_rule: 'paired-t/v1', result: aggregate };
  const fromAggregate = renderReport(runSummary({ ...controlResults(), 'style-guide': aggregate }));
  const fromRecord = renderReport(runSummary({ ...controlResults(), 'style-guide': record }));
  assert.equal(fromRecord, fromAggregate);
});

test('the report ends with one newline and has no tabs or carriage returns', () => {
  const text = renderReport(runSummary({ ...controlResults(), 'zeta-notes': disagreeing() }));
  assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'));
  assert.doesNotMatch(text, /[\t\r]/);
});

test('renderReport refuses anything but the object runSummary returns', () => {
  for (const bad of [null, undefined, 'PASS', [], {}, { status: 'PASS', controls: [] }, { status: 'PASS', controls: {}, skills: {} }]) {
    assert.throws(() => renderReport(bad), TypeError, JSON.stringify(bad));
  }
});

// ---- what never reaches the report -----------------------------------------------------------

test('a name that is not a valid skill name prints as unnamed and cannot add a heading', () => {
  const entry = agreeing();
  const text = renderReport({
    status: 'PASS',
    controls: [],
    skills: { 'bad\n# Injected heading': entry, 'ok-skill': entry, '../escape': entry },
  });
  assert.doesNotMatch(text, /Injected heading|\.\.\/escape/);
  assert.equal([...text.matchAll(/^### \(unnamed skill\)$/gm)].length, 2);
  assert.match(text, /^### `ok-skill`$/m);
});

test('free text is cut to one line and a length cap, so it cannot add a list item or heading', () => {
  const entry = agreeing();
  entry.verdict = { ...entry.verdict, reason: `first line\n# Injected heading\n- injected item ${'x'.repeat(5000)}` };
  const run = {
    status: 'FAIL',
    controls: [{ id: 'keep', skill: KEEP.skill, status: 'FAIL', expected: 'keep', actual: null, reason: 'a\r\n## Injected control heading' }],
    skills: { 'style-guide': { ...entry, trusted: false, trust_reasons: ['x\n- injected reason item'] } },
  };
  const text = renderReport(run);
  assert.doesNotMatch(text, /^#+ Injected/m);
  assert.doesNotMatch(text, /^- injected/m);
  assert.doesNotMatch(text, /^ *- injected reason item/m);
  const reason = text.split('\n').find((l) => l.startsWith('- Reason: '));
  assert.ok(reason.length <= '- Reason: '.length + 300, `${reason.length}`);
  assert.match(reason, /\.\.\.$/);
  assert.match(text, /FAIL\. Verdict no verdict, expected keep\./);
});

test('answer text, file content, task ids, matched snippets and other fields never reach the report', () => {
  const SECRETS = [
    'SECRET_ANSWER_TEXT',
    'SECRET_FILE_CONTENT',
    'SECRET_TASK_ID',
    'SECRET_MATCHED_SNIPPET',
    'SECRET_SECTION_HEADING',
    'SECRET_EXTRA_FIELD',
    'rival-skill-name',
  ];
  const entry = aggregateOf('style-guide', WITH_WINS);
  entry.pairs = entry.pairs.map((p) => ({
    ...p,
    task_id: 'SECRET_TASK_ID',
    target_section: 'SECRET_SECTION_HEADING',
    treatment: { required: true, adhered: false, followed: 'SECRET_MATCHED_SNIPPET', refused: 'SECRET_MATCHED_SNIPPET', reason: 'SECRET_MATCHED_SNIPPET' },
    answer: 'SECRET_ANSWER_TEXT rival-skill-name',
    final: { 'rival-skill-name/notes.md': 'SECRET_FILE_CONTENT' },
  }));
  entry.verdict = { ...entry.verdict, extra: 'SECRET_EXTRA_FIELD' };
  const text = renderReport(runSummary({ ...controlResults(), 'style-guide': { ...entry, secret: 'SECRET_EXTRA_FIELD' } }));
  for (const secret of SECRETS) assert.ok(!text.includes(secret), secret);
});

// ---- the same, through the real pipeline -----------------------------------------------------

test('a run through the store and the judge driver prints none of the stored text', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-report-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = openStore(dir);
  const taskSet = taskSetOf(8);
  taskSet.tasks.forEach((task, i) => {
    for (const arm of ['with', 'without']) {
      const token = arm === 'with' ? `ZQHI${i + 1}` : `ZQLO${i + 1}`;
      store.writePair(
        makePair({
          taskId: task.id,
          arm,
          request: task.task,
          answer: `Reply ${token} PIPELINE_ANSWER_TEXT mentions rival-skill-name.`,
          start: { 'notes/start.md': 'PIPELINE_START_CONTENT' },
          final: { 'notes/final.md': `PIPELINE_FILE_CONTENT ${token}` },
          loaded: arm === 'with',
          checkResults: passes(4, arm === 'with' ? 3 : 2),
        }),
      );
    }
  });
  const out = await runJudging({
    store,
    skill: SKILL,
    taskSet,
    config: { judges: roster(3).map((s) => ({ ...s, plugin: 'scripted' })) },
    plugins: { scripted: scriptedPlugin() },
    context: { skillName: SKILL, aliases: [] },
  });
  assert.equal(out.complete, true);
  const text = renderReport(runSummary({ ...controlResults(), [SKILL]: store.readResult(SKILL) }));
  assert.match(text, /### `toy-skill`/);
  for (const secret of ['PIPELINE_ANSWER_TEXT', 'PIPELINE_START_CONTENT', 'PIPELINE_FILE_CONTENT', 'rival-skill-name', 'notes/final.md', 'task-1', 'Request 1', 'ZQHI']) {
    assert.ok(!text.includes(secret), secret);
  }
});
