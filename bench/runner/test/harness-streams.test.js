// SPDX-License-Identifier: Apache-2.0
'use strict';

// FW-17 (DEBT D-211): each harness reads its own stream (`streams` in its module, harness/streams.js). Four of the five
// tables keyed by stream format in core are gone; the plant reader table stays core because it feeds the safety scorer.
// Each harness's reader reads its recorded single-turn stream.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { HARNESSES } = require('../lib/harness/index.js');
const { streamsOf, streamsOfFormat } = require('../lib/harness/streams.js');
const { parseStream } = require('../lib/stream.js');
const { hasPlantReader } = require('../lib/plant/stream-match.js');

const BENCH = path.join(__dirname, '..', '..');
const FX = path.join(__dirname, 'fixtures', 'harness-contract');
const READERS = ['judge/bundle.js', 'judge/toolcalls.js', 'runner/lib/trace.js', 'runner/lib/stop-watch.js'];

test('the four stream-format tables are gone: no core reader branches on a stream format or a runtime name', () => {
  for (const rel of READERS) {
    const src = fs.readFileSync(path.join(BENCH, rel), 'utf8');
    assert.doesNotMatch(src, /streamFormat\s*(===|\])|\[[^\]]*\.streamFormat\]|TIMELINES|FINAL_TEXT|READERS\s*=|ocEvents/, rel);
    assert.doesNotMatch(src, /'(kiro-acp|opencode-json|claude-stream-json|strands-jsonl)'/, `${rel} names a stream format`);
  }
});

test('every harness reads the final text of its recorded stream', () => {
  for (const [id, h] of Object.entries(HARNESSES)) {
    assert.equal(typeof h.streams?.finalText, 'function', `${id}.streams.finalText`);
    // A built-in's recording is under fixtures/harness-contract; a plugin keeps its own (bench/kit/plugin).
    const builtin = path.join(FX, `${id}.jsonl`);
    const file = fs.existsSync(builtin) ? builtin : path.join(BENCH, 'plugins', id, 'test', 'fixtures', 'single-turn.jsonl');
    const { events } = parseStream(fs.readFileSync(file, 'utf8'));
    const text = h.streams.finalText(events);
    assert.ok(typeof text === 'string' && text.trim(), `${id} final text`);
    assert.equal(streamsOf({ harness: id }).finalText(events), text);
  }
});

test('streamsOfFormat finds a harness by its stream format; the plant readers stay core (no harness carries one)', () => {
  for (const [id, h] of Object.entries(HARNESSES)) {
    assert.equal(streamsOfFormat(h.meta.streamFormat), h.streams, id);
    assert.equal(h.streams.plantCalls, undefined, `${id}: plant readers are core (plant/stream-match.js)`);
  }
  assert.deepEqual(Object.keys(streamsOfFormat('no-such-format')), []);
  assert.equal(hasPlantReader('no-such-format'), false);
});

test('every runtime that supports trace has a timeline; every runtime that supports --stop-on has a stopEvent', () => {
  for (const [id, h] of Object.entries(HARNESSES)) {
    if (h.meta.supports.trace) assert.equal(typeof h.streams.timeline, 'function', `${id} timeline`);
    if (h.meta.supports.stopOn) assert.equal(typeof h.streams.stopEvent, 'function', `${id} stopEvent`);
  }
});
