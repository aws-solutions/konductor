// SPDX-License-Identifier: Apache-2.0
/**
 * Replay plugin tests: stored replies are served by judge input digest, a missing key is an error,
 * and the plugin touches no network, process or credential. Offline.
 * Run: node --test bench/test/replay.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createReplayPlugin, replayFromStore, REPLAY_PLUGIN_ID, MISSING_REPLY } = require('../plugins/replay');
const { openStore } = require('../lib/store');
const { SKILL, tempDir, expectedJudgment, makeJudgment } = require('./support/records');

const RAW = '{"winner":"B","score_a":2,"score_b":4,"reason":"b is better"}';

const record = (change = {}, fields = {}) => makeJudgment(expectedJudgment(change), { raw_text: RAW, ...fields });
const digestOf = (rec) => rec.inputs.judge_input_sha256;

test('serves the stored raw text for the digest, exactly', () => {
  const rec = record();
  const plugin = createReplayPlugin({ records: [rec] });
  assert.equal(plugin.id, REPLAY_PLUGIN_ID);
  assert.equal(plugin.size, 1);
  assert.deepEqual(plugin.runGrader({ input_sha256: digestOf(rec) }), {
    status: 'ok',
    raw_text: RAW,
    usage: null,
    cost: { usd: 0 },
  });
});

test('the prompt, the marker id, the model and the seed do not matter, only the digest', () => {
  const rec = record();
  const plugin = createReplayPlugin({ records: [rec] });
  const a = plugin.runGrader({ input_sha256: digestOf(rec), prompt: 'one', model: 'x', seed: 1 });
  const b = plugin.runGrader({ input_sha256: digestOf(rec), prompt: 'two with another id', model: 'y', seed: 99 });
  assert.deepEqual(a, b);
});

test('each digest finds its own reply', () => {
  const first = record({ seat: 'seat-a' }, { raw_text: 'first' });
  const second = record({ seat: 'seat-b' }, { raw_text: 'second' });
  const plugin = createReplayPlugin({ records: [first, second] });
  assert.equal(plugin.runGrader({ input_sha256: digestOf(first) }).raw_text, 'first');
  assert.equal(plugin.runGrader({ input_sha256: digestOf(second) }).raw_text, 'second');
});

test('a missing key is an error that names the digest, never a made-up reply', () => {
  const plugin = createReplayPlugin({ records: [record()] });
  const absent = digestOf(record({ prompt: 'a prompt nobody stored' }));
  assert.equal(plugin.canServe(absent), false);
  assert.throws(
    () => plugin.runGrader({ input_sha256: absent }),
    (err) => err.code === MISSING_REPLY && err.message.includes(absent),
  );
  assert.throws(() => createReplayPlugin({ records: [] }).runGrader({ input_sha256: absent }), /no stored reply/);
});

test('a call without a usable digest is refused', () => {
  const plugin = createReplayPlugin({ records: [record()] });
  for (const call of [undefined, {}, { input_sha256: 'short' }, { input_sha256: null }, { prompt: 'x' }]) {
    assert.throws(() => plugin.runGrader(call), /input_sha256/, JSON.stringify(call));
  }
  assert.equal(plugin.canServe(undefined), false);
  assert.equal(plugin.canServe('nope'), false);
});

test('an unreadable stored reply is served as text; one that never had a reply keeps its status', () => {
  const bad = record({ seat: 'seat-a' }, { status: 'unparsable', raw_text: 'not json', parsed: null });
  const refused = record({ seat: 'seat-b' }, { status: 'refused', raw_text: null, parsed: null });
  const transient = record({ seat: 'seat-c' }, { status: 'transient', raw_text: null, parsed: null });
  const plugin = createReplayPlugin({ records: [bad, refused, transient] });
  assert.deepEqual(plugin.runGrader({ input_sha256: digestOf(bad) }).raw_text, 'not json');
  assert.equal(plugin.runGrader({ input_sha256: digestOf(bad) }).status, 'ok');
  assert.deepEqual(plugin.runGrader({ input_sha256: digestOf(refused) }), {
    status: 'refused',
    raw_text: null,
    usage: null,
    cost: { usd: 0 },
  });
  assert.equal(plugin.runGrader({ input_sha256: digestOf(transient) }).status, 'transient');
});

test('two stored judgments that share a digest but disagree are an error', () => {
  const one = record({}, { raw_text: 'one' });
  const two = record({}, { raw_text: 'two' });
  const plugin = createReplayPlugin({ records: [one, two] });
  assert.equal(plugin.canServe(digestOf(one)), false);
  assert.throws(() => plugin.runGrader({ input_sha256: digestOf(one) }), /disagree/);
  const same = createReplayPlugin({ records: [one, { ...one }] });
  assert.equal(same.runGrader({ input_sha256: digestOf(one) }).raw_text, 'one');
});

test('records without a usable digest or status are ignored', () => {
  const rec = record();
  const noDigest = { ...record({ seat: 'seat-b' }), inputs: {} };
  const noStatus = { ...record({ seat: 'seat-c' }), status: undefined };
  const plugin = createReplayPlugin({ records: [null, undefined, 7, {}, noDigest, noStatus, rec] });
  assert.equal(plugin.size, 1);
  assert.equal(createReplayPlugin({}).size, 0);
});

test('replayFromStore reads the judgments of the named skills from a run store', (t) => {
  const store = openStore(tempDir(t));
  const mine = record({ skill: SKILL, seat: 'seat-a' }, { raw_text: 'mine' });
  const other = record({ skill: 'other-skill', seat: 'seat-b' }, { raw_text: 'other' });
  store.writeJudgment(mine);
  store.writeJudgment(other);
  const only = replayFromStore(store, SKILL);
  assert.equal(only.size, 1);
  assert.equal(only.runGrader({ input_sha256: digestOf(mine) }).raw_text, 'mine');
  assert.equal(only.canServe(digestOf(other)), false);
  assert.equal(replayFromStore(store, [SKILL, 'other-skill']).size, 2);
});

test('the plugin has no network, process, credential or clock access', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'replay.js'), 'utf8');
  const modules = [...source.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
  assert.deepEqual(modules, ['../lib/provenance']);
  assert.doesNotMatch(source, /process\.env|fetch\(|child_process|XMLHttpRequest|Date\.now|new Date/);
});
