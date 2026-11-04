// SPDX-License-Identifier: Apache-2.0
/**
 * Run store tests: layout, path safety, file modes, atomic writes and the strict freshness checks.
 * Offline; every test works in its own temporary directory.
 * Run: node --test bench/test/store.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const store = require('../lib/store');
const { decisionRuleSha256, digestRuleFields, decisionRuleFields } = require('../lib/decision-rule');
const { resultInputs, PROVENANCE_VERSION } = require('../lib/provenance');
const {
  SKILL,
  tempDir,
  makePair,
  expectedJudgment,
  makeJudgment,
  makeResult,
} = require('./support/records');

const HAS_MODES = process.platform !== 'win32';
const MODE_SKIP = HAS_MODES ? false : 'file modes are not enforced on this platform';
const modeOf = (file) => fs.statSync(file).mode & 0o777;

const listAll = (dir) =>
  fs
    .readdirSync(dir, { recursive: true })
    .map(String)
    .sort();

// ---- layout and path safety ----------------------------------------------------------------

test('layout: pairs, judgments and results live under the run directory', (t) => {
  const root = tempDir(t);
  const s = store.openStore(root);
  assert.equal(path.resolve(s.root), path.resolve(root));
  assert.equal(s.paths.pair(SKILL, 'task-1', 'with'), path.join(path.resolve(root), 'pairs', SKILL, 'task-1', 'with.json'));
  assert.equal(
    s.paths.judgment(SKILL, 'task-1', 'seat-a', 'with-first'),
    path.join(path.resolve(root), 'judgments', SKILL, 'task-1', 'seat-a.with-first.json'),
  );
  assert.equal(s.paths.result(SKILL), path.join(path.resolve(root), 'results', `${SKILL}.json`));
});

test('openStore needs a run directory', () => {
  for (const bad of [undefined, null, '', '  ', 7]) {
    assert.throws(() => store.openStore(bad), /run directory/, String(bad));
  }
});

const BAD_NAMES = [
  '..',
  '../x',
  'a/b',
  'a\\b',
  '/etc/passwd',
  'C:\\temp',
  '.hidden',
  'a..b',
  'Upper',
  '',
  'two words',
  'line\nbreak',
  'x'.repeat(161),
  null,
  undefined,
  7,
];

test('path safety: a skill, task id or seat that could leave the run directory is refused', (t) => {
  const s = store.openStore(tempDir(t));
  for (const bad of BAD_NAMES) {
    const shown = JSON.stringify(bad);
    assert.throws(() => s.paths.pair(bad, 'task-1', 'with'), /invalid skill/, `skill ${shown}`);
    assert.throws(() => s.paths.pair(SKILL, bad, 'with'), /invalid task id/, `task ${shown}`);
    assert.throws(() => s.paths.judgment(SKILL, bad, 'seat-a', 'with-first'), /invalid task id/);
    assert.throws(() => s.paths.judgment(SKILL, 'task-1', bad, 'with-first'), /invalid seat/, `seat ${shown}`);
    assert.throws(() => s.paths.result(bad), /invalid skill/, `result ${shown}`);
  }
});

test('path safety: an unknown arm or order is refused', (t) => {
  const s = store.openStore(tempDir(t));
  for (const arm of ['with2', 'WITH', '../with', '', undefined]) {
    assert.throws(() => s.paths.pair(SKILL, 'task-1', arm), /invalid arm/, String(arm));
  }
  for (const order of ['first', '../with-first', '', undefined]) {
    assert.throws(() => s.paths.judgment(SKILL, 'task-1', 'seat-a', order), /invalid order/, String(order));
  }
});

test('path safety: a record with a hostile identity is refused and nothing is written outside the run directory', (t) => {
  const outer = tempDir(t);
  const run = path.join(outer, 'run');
  fs.mkdirSync(run);
  const before = listAll(outer);
  const s = store.openStore(run);
  for (const bad of ['..', '../escape', 'a/b', '/tmp/abs', 'a\\b']) {
    const pair = { ...makePair(), task_id: bad };
    assert.throws(() => s.writePair(pair), /pair record/, `pair ${bad}`);
    const judgment = { ...makeJudgment(), seat: bad };
    assert.throws(() => s.writeJudgment(judgment), /judgment record/, `judgment ${bad}`);
    const skill = { ...makePair(), skill: bad };
    assert.throws(() => s.writePair(skill), /pair record/, `skill ${bad}`);
  }
  assert.deepEqual(listAll(outer), before, 'nothing was created, inside or outside the run directory');
});

test('path safety: a write through a link inside the run directory is refused', { skip: process.platform === 'win32' && 'links need privileges on this platform' }, (t) => {
  const outer = tempDir(t);
  const run = path.join(outer, 'run');
  const elsewhere = path.join(outer, 'elsewhere');
  fs.mkdirSync(run);
  fs.mkdirSync(elsewhere);
  fs.symlinkSync(elsewhere, path.join(run, 'pairs'));
  const s = store.openStore(run);
  assert.throws(() => s.writePair(makePair()), /link/);
  assert.deepEqual(fs.readdirSync(elsewhere), []);
});

// ---- writing and reading -------------------------------------------------------------------

test('a pair, a judgment and a result round-trip through the store', (t) => {
  const s = store.openStore(tempDir(t));
  const pair = makePair({ start: { 'a.md': 'one' }, final: { 'a.md': 'two' } });
  const judgment = makeJudgment();
  const inputs = resultInputs({
    skill: SKILL,
    ruleSha256: decisionRuleSha256(),
    tasks: [{ id: 'task-1', target_section: 'S1' }],
    pairs: [pair],
    judgments: [judgment],
    judges: [{ seat: 'seat-a', model: '<provider>/<model-1>' }],
  });
  const result = makeResult({ rule: decisionRuleSha256(), inputs });
  s.writePair(pair);
  s.writeJudgment(judgment);
  s.writeResult(result);
  assert.deepEqual(s.readPair(SKILL, 'task-1', 'with'), pair);
  assert.deepEqual(s.readJudgment(SKILL, 'task-1', 'seat-a', 'with-first'), judgment);
  assert.deepEqual(s.readResult(SKILL), result);
});

test('a missing, corrupt or non-file record reads as null', (t) => {
  const root = tempDir(t);
  const s = store.openStore(root);
  assert.equal(s.readPair(SKILL, 'task-1', 'with'), null);
  s.writePair(makePair());
  const file = s.paths.pair(SKILL, 'task-1', 'with');
  fs.writeFileSync(file, '{ not json');
  assert.equal(s.readPair(SKILL, 'task-1', 'with'), null);
  fs.rmSync(file);
  fs.mkdirSync(file);
  assert.equal(s.readPair(SKILL, 'task-1', 'with'), null);
});

test('writers validate the shape: a record missing a field or holding the wrong kind is refused', (t) => {
  const s = store.openStore(tempDir(t));
  for (const field of Object.keys(store.PAIR_FIELDS)) {
    const pair = makePair();
    delete pair[field];
    assert.throws(() => s.writePair(pair), new RegExp(`missing field ${field}`), field);
  }
  for (const field of Object.keys(store.JUDGMENT_FIELDS)) {
    const j = makeJudgment();
    delete j[field];
    assert.throws(() => s.writeJudgment(j), new RegExp(`missing field ${field}`), field);
  }
  assert.throws(() => s.writePair({ ...makePair(), loaded: 'yes' }), /loaded is malformed/);
  assert.throws(() => s.writePair({ ...makePair(), arm: 'with2' }), /arm is malformed/);
  assert.throws(() => s.writeJudgment({ ...makeJudgment(), status: 'maybe' }), /status is malformed/);
  assert.throws(() => s.writeJudgment({ ...makeJudgment(), nonce: 'a b' }), /nonce is malformed/);
  assert.throws(() => s.writeJudgment({ ...makeJudgment(), attempts: 0 }), /attempts is malformed/);
  assert.throws(() => s.writePair(null), /not an object/);
  assert.throws(() => s.writeResult({}), /missing field/);
});

test('listJudgments returns the readable records of one skill in path order', (t) => {
  const s = store.openStore(tempDir(t));
  assert.deepEqual(s.listJudgments(SKILL), []);
  const mk = (taskId, seat, order) => makeJudgment(expectedJudgment({ taskId, seat, order }));
  const records = [
    mk('task-2', 'seat-a', 'with-first'),
    mk('task-1', 'seat-b', 'without-first'),
    mk('task-1', 'seat-a', 'with-first'),
  ];
  records.forEach((r) => s.writeJudgment(r));
  s.writeJudgment(makeJudgment(expectedJudgment({ skill: 'other-skill' })));
  fs.writeFileSync(path.join(s.root, 'judgments', SKILL, 'task-1', 'broken.json'), 'nope');
  fs.writeFileSync(path.join(s.root, 'judgments', SKILL, 'task-1', 'notes.txt'), 'ignored');
  const listed = s.listJudgments(SKILL).map((r) => `${r.task_id}/${r.seat}.${r.order}`);
  assert.deepEqual(listed, [
    'task-1/seat-a.with-first',
    'task-1/seat-b.without-first',
    'task-2/seat-a.with-first',
  ]);
  assert.throws(() => s.listJudgments('../x'), /invalid skill/);
});

// ---- modes and atomic writes ---------------------------------------------------------------

test('directories are 0700 and files 0600, whatever the umask', { skip: MODE_SKIP }, (t) => {
  const outer = tempDir(t);
  const run = path.join(outer, 'run');
  const s = store.openStore(run);
  const previous = process.umask(0);
  try {
    s.writePair(makePair());
    s.writeJudgment(makeJudgment());
    s.writeResult(
      makeResult({
        rule: decisionRuleSha256(),
        inputs: { provenance_version: PROVENANCE_VERSION, result_input_sha256: 'c'.repeat(64) },
      }),
    );
  } finally {
    process.umask(previous);
  }
  const entries = fs.readdirSync(run, { recursive: true, withFileTypes: true });
  assert.ok(entries.length >= 6);
  assert.equal(modeOf(run), 0o700, 'the run directory the store made');
  for (const entry of entries) {
    const full = path.join(entry.parentPath ?? entry.path, entry.name);
    assert.equal(modeOf(full), entry.isDirectory() ? 0o700 : 0o600, full);
  }
});

test('a file that existed with a looser mode is tightened by a rewrite', { skip: MODE_SKIP }, (t) => {
  const s = store.openStore(tempDir(t));
  const file = s.writePair(makePair());
  fs.chmodSync(file, 0o644);
  s.writePair(makePair({ answer: 'Changed.' }));
  assert.equal(modeOf(file), 0o600);
});

test('a write leaves no temporary file behind, and a failed write keeps the old record', (t) => {
  const s = store.openStore(tempDir(t));
  const file = s.writePair(makePair());
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['with.json']);
  s.writePair(makePair({ answer: 'Second.' }));
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['with.json']);
  assert.equal(s.readPair(SKILL, 'task-1', 'with').answer, 'Second.');

  // The rename fails when the target is a directory; the old content must not be half replaced.
  const blocked = s.paths.pair(SKILL, 'task-2', 'with');
  fs.mkdirSync(blocked, { recursive: true });
  assert.throws(() => s.writePair(makePair({ taskId: 'task-2' })));
  assert.deepEqual(fs.readdirSync(path.dirname(blocked)), ['with.json'], 'no .tmp file remains');
});

// ---- freshness: pairs ----------------------------------------------------------------------

const PAIR_EXPECT = { skill: SKILL, taskId: 'task-1', arm: 'with', request: 'Add a flag.' };

test('pairCurrent: a pair is current for its own request and identity', () => {
  assert.equal(store.pairCurrent(makePair({ start: { a: 'x' }, final: { a: 'y' } }), PAIR_EXPECT), true);
  assert.equal(store.pairCurrent(makePair({ arm: 'without' }), { ...PAIR_EXPECT, arm: 'without' }), true);
});

test('pairCurrent: an edited request, identity or output makes the pair stale', () => {
  const pair = makePair();
  assert.equal(store.pairCurrent(pair, { ...PAIR_EXPECT, request: 'Add a flag!' }), false);
  assert.equal(store.pairCurrent(pair, { ...PAIR_EXPECT, taskId: 'task-2' }), false);
  assert.equal(store.pairCurrent(pair, { ...PAIR_EXPECT, arm: 'without' }), false);
  assert.equal(store.pairCurrent(pair, { ...PAIR_EXPECT, skill: 'other-skill' }), false);
  assert.equal(store.pairCurrent(pair, undefined), false);
  assert.equal(store.pairCurrent(null, PAIR_EXPECT), false);
  for (const edit of [
    { answer: 'Edited.' },
    { loaded: false },
    { runner_fingerprint: 'replay-runner@2' },
    { start: { 'a.md': 'new' } },
    { final: { 'a.md': 'new' } },
    { provenance_version: PROVENANCE_VERSION + 1 },
  ]) {
    assert.equal(store.pairCurrent({ ...pair, ...edit }, PAIR_EXPECT), false, JSON.stringify(edit));
  }
});

test('pairCurrent: a pair missing any field is not current', () => {
  for (const field of Object.keys(store.PAIR_FIELDS)) {
    const pair = makePair();
    delete pair[field];
    assert.equal(store.pairCurrent(pair, PAIR_EXPECT), false, field);
  }
  const noDigest = makePair();
  delete noDigest.inputs.pair_input_sha256;
  assert.equal(store.pairCurrent(noDigest, PAIR_EXPECT), false);
  const wrongType = { ...makePair(), loaded: 'true' };
  assert.equal(store.pairCurrent(wrongType, PAIR_EXPECT), false);
});

// ---- freshness: judgments ------------------------------------------------------------------

test('judgmentDone: current with a usable reply is done', () => {
  const expected = expectedJudgment();
  const rec = makeJudgment(expected);
  assert.equal(store.judgmentMatches(rec, expected), true);
  assert.equal(store.judgmentDone(rec, expected), true);
  assert.equal(store.judgmentSettled(rec, expected), true);
});

test('judgmentMatches: any change to what the call is made with makes the record stale', () => {
  const rec = makeJudgment(expectedJudgment());
  const base = {
    prompt: 'rendered prompt',
    request: 'Add a flag.',
    rubric: ['Names the flag.'],
  };
  const stale = [
    ['the prompt changed', { prompt: 'rendered prompt 2' }],
    ['the request changed', { request: 'Add a flag!' }],
    ['the rubric changed', { rubric: ['Names the flag.', 'More.'] }],
    ['the template sha changed', { template: { version: 2, sha256: 'c'.repeat(64) } }],
    ['the template version changed', { template: { version: 3, sha256: 'a'.repeat(64) } }],
    ['the sanitizer version changed', { sanitizer: { version: 3, hash: 'b'.repeat(64) } }],
    ['the sanitizer rules changed', { sanitizer: { version: 2, hash: 'd'.repeat(64) } }],
    ['the scale changed', { scale: 'items' }],
    ['the order changed', { order: 'without-first' }],
    ['the seat changed', { seat: 'seat-b' }],
    ['the model changed', { model: '<provider>/<model-2>' }],
    ['the task changed', { taskId: 'task-2' }],
    ['the skill changed', { skill: 'other-skill' }],
  ];
  for (const [why, change] of stale) {
    assert.equal(store.judgmentMatches(rec, expectedJudgment({ ...base, ...change })), false, why);
    assert.equal(store.judgmentDone(rec, expectedJudgment({ ...base, ...change })), false, why);
  }
});

test('judgmentMatches: a record missing any field, or holding the wrong kind, is not current', () => {
  const expected = expectedJudgment();
  for (const field of Object.keys(store.JUDGMENT_FIELDS)) {
    const rec = makeJudgment(expected);
    delete rec[field];
    assert.equal(store.judgmentMatches(rec, expected), false, field);
    assert.equal(store.judgmentDone(rec, expected), false, field);
  }
  for (const bad of [
    { attempts: '1' },
    { nonce: '' },
    { prompt_sha256: 'short' },
    { provenance_version: PROVENANCE_VERSION + 1 },
    { raw_text: 5 },
  ]) {
    assert.equal(store.judgmentMatches(makeJudgment(expected, bad), expected), false, JSON.stringify(bad));
  }
  const noDigest = makeJudgment(expected);
  delete noDigest.inputs.judge_input_sha256;
  assert.equal(store.judgmentMatches(noDigest, expected), false);
});

test('judgmentMatches: a digest copied onto a record whose other fields disagree is caught', () => {
  const expected = expectedJudgment();
  const forged = makeJudgment(expected, { prompt_sha256: 'e'.repeat(64) });
  assert.equal(store.judgmentMatches(forged, expected), false);
  const wrongInputs = makeJudgment(expected);
  wrongInputs.inputs = { ...wrongInputs.inputs, request_sha256: 'f'.repeat(64) };
  assert.equal(store.judgmentMatches(wrongInputs, expected), false);
});

test('judgmentMatches: no expected digest means nothing is current', () => {
  const rec = makeJudgment(expectedJudgment());
  assert.equal(store.judgmentMatches(rec, undefined), false);
  assert.equal(store.judgmentMatches(rec, { ...expectedJudgment(), inputs: {} }), false);
  assert.equal(store.judgmentMatches(rec, { ...expectedJudgment(), inputs: undefined }), false);
});

test('judgmentDone and judgmentSettled: only a usable reply is done; retries stop at the limit', () => {
  const expected = expectedJudgment();
  const failed = (status, attempts) =>
    makeJudgment(expected, { status, attempts, raw_text: status === 'unparsable' ? 'hmm' : null, parsed: null });
  for (const status of ['unparsable', 'refused', 'invalid', 'transient']) {
    assert.equal(store.judgmentDone(failed(status, 1), expected), false, status);
    assert.equal(store.judgmentSettled(failed(status, 1), expected), false, `${status} once`);
    assert.equal(store.judgmentSettled(failed(status, store.MAX_ATTEMPTS - 1), expected), false);
    assert.equal(store.judgmentSettled(failed(status, store.MAX_ATTEMPTS), expected), true, `${status} at the limit`);
    assert.equal(store.judgmentDone(failed(status, store.MAX_ATTEMPTS), expected), false, 'settled is not done');
  }
  assert.equal(store.judgmentSettled(failed('refused', 2), expected, 2), true, 'a custom limit');
  assert.equal(store.judgmentDone(makeJudgment(expected, { parsed: null }), expected), false);
  assert.equal(store.judgmentDone(makeJudgment(expected, { raw_text: null }), expected), false);
  const stale = expectedJudgment({ prompt: 'another prompt' });
  assert.equal(store.judgmentSettled(failed('refused', store.MAX_ATTEMPTS), stale), false, 'stale is never settled');
});

// ---- freshness: results --------------------------------------------------------------------

function resultFor(rule = decisionRuleSha256(), request = 'x') {
  const pair = makePair({ request });
  const inputs = resultInputs({
    skill: SKILL,
    ruleSha256: rule,
    tasks: [{ id: 'task-1', target_section: 'S1' }],
    pairs: [pair],
    judgments: [makeJudgment()],
    judges: [{ seat: 'seat-a', model: '<provider>/<model-1>' }],
  });
  return { inputs, record: makeResult({ rule, inputs }) };
}

test('resultCurrent: today\'s rule digest and today\'s inputs make a result current', () => {
  const { inputs, record } = resultFor();
  assert.equal(store.resultCurrent(record, inputs), true);
});

test('resultCurrent: another rule digest, other inputs, or no expected inputs is stale', () => {
  const { inputs, record } = resultFor();
  const oldRule = digestRuleFields({ ...decisionRuleFields(), KEEP_FLOOR: 0.05 });
  assert.notEqual(oldRule, decisionRuleSha256());
  const old = resultFor(oldRule);
  assert.equal(store.resultCurrent(old.record, inputs), false, 'a result made under another rule');
  assert.equal(store.resultCurrent(old.record, old.inputs), false, 'even when it matches its own old inputs');
  assert.equal(store.resultCurrent(record, old.inputs), false, 'expected inputs from another rule');
  const changed = resultFor(decisionRuleSha256(), 'a request that changed');
  assert.notEqual(changed.inputs.result_input_sha256, inputs.result_input_sha256);
  assert.equal(store.resultCurrent(record, changed.inputs), false, 'inputs that moved on');
  assert.equal(store.resultCurrent(record, { ...inputs, result_input_sha256: 'd'.repeat(64) }), false);
  assert.equal(store.resultCurrent(record, undefined), false);
  assert.equal(store.resultCurrent(record, {}), false);
});

test('resultCurrent: a result missing any field is not current', () => {
  const { inputs, record } = resultFor();
  for (const field of Object.keys(store.RESULT_FIELDS)) {
    const copy = { ...record };
    delete copy[field];
    assert.equal(store.resultCurrent(copy, inputs), false, field);
  }
  const bareInputs = { ...record, inputs: { ...record.inputs, rule_sha256: undefined } };
  assert.equal(store.resultCurrent(bareInputs, inputs), false);
  assert.equal(store.resultCurrent({ ...record, provenance_version: PROVENANCE_VERSION + 1 }, inputs), false);
});
