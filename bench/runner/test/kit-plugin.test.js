// SPDX-License-Identifier: Apache-2.0
// The harness plugin kit's four checks (FW-16, DEBT D-210): contract, fake-run, plant-kind and golden. Strands and the
// kit's template folder pass all four; a plugin broken in one way fails that check by name. No model call.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { mkScratch } = require('./scratch.js');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { checkHarnessPlugin, checksOf, CHECKS } = require('../../kit/plugin/check.js');

const BENCH = path.join(__dirname, '..', '..');
const STRANDS = path.join(BENCH, 'plugins', 'strands');
const TEMPLATE = path.join(BENCH, 'kit', 'plugin-template');
const CHECK = path.join(BENCH, 'kit', 'plugin', 'check.js');

/** A copy of the template under a new name in a temp dir; `edit(dir)` breaks it. */
function brokenTemplate(t, edit) {
  const root = mkScratch('kit-plugin-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // The copy sits two levels below a link to bench/sdk, as a plugin under bench/plugins/<name>/ does (B-013).
  fs.symlinkSync(path.join(BENCH, 'sdk'), path.join(root, 'sdk'));
  const dir = path.join(root, 'plugins', 'plugin-template');
  fs.mkdirSync(path.dirname(dir));
  fs.cpSync(TEMPLATE, dir, { recursive: true });
  edit(dir);
  return dir;
}
const replaceIn = (file, from, to) => fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(from, to));
const failed = (dir) => Object.entries(checksOf(dir)).filter(([, p]) => p.length).map(([k]) => k);

test('the kit has the four checks the plan names', () => {
  assert.deepEqual(CHECKS, ['contract', 'fake-run', 'plant-kind', 'golden']);
});

test('Strands passes all four checks', () => {
  assert.deepEqual(checksOf(STRANDS), { contract: [], 'fake-run': [], 'plant-kind': [], golden: [] });
});

test('the template passes all four checks, and the CLI prints one line per check', () => {
  assert.deepEqual(checkHarnessPlugin(TEMPLATE), []);
  const r = spawnSync(process.execPath, [CHECK, STRANDS, TEMPLATE], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const c of CHECKS) assert.match(r.stdout, new RegExp(`^  PASS ${c}$`, 'm'));
  assert.match(r.stdout, /^PASS .*plugins\/strands$/m);
  assert.match(r.stdout, /^PASS .*kit\/plugin-template$/m);
});

test('fake-run: an env() that copies the host env leaks the canary and fails', (t) => {
  const dir = brokenTemplate(t, (d) => replaceIn(path.join(d, 'harness.js'), 'PATH: \'/usr/bin:/bin\',', '...process.env,'));
  assert.deepEqual(failed(dir), ['fake-run']);
  assert.ok(checksOf(dir)['fake-run'].some((p) => /host variable reached the agent/.test(p)));
});

test('fake-run: a buildCommand that drops the prompt fails', (t) => {
  const dir = brokenTemplate(t, (d) => replaceIn(path.join(d, 'harness.js'), 'promptFor(arm, task)]', "'no prompt']"));
  assert.ok(checksOf(dir)['fake-run'].some((p) => /prompt must reach the agent/.test(p)));
});

test('plant-kind: a plant mount the runner does not know fails', (t) => {
  const dir = brokenTemplate(t, (d) => replaceIn(path.join(d, 'meta.js'), 'plant: null,', "plant: Object.freeze({ mount: 'telepathy', pinKey: 'template' }),"));
  const problems = checksOf(dir)['plant-kind'];
  assert.ok(problems.some((p) => /plant\.mount "telepathy"/.test(p)), problems.join(' | '));
  assert.ok(problems.some((p) => /no plant stream reader for template-jsonl/.test(p)), problems.join(' | '));
});

test('golden: a parser change shows as a golden diff; --record writes the new golden', (t) => {
  const dir = brokenTemplate(t, (d) => replaceIn(path.join(d, 'harness.js'), 'toolCalls: uses.length, workToolCalls: uses.length,', 'toolCalls: uses.length + 1, workToolCalls: uses.length + 1,'));
  assert.deepEqual(failed(dir), ['golden']);
  assert.ok(checksOf(dir).golden.some((p) => /agg\.toolCalls: golden 1, now 2/.test(p)), checksOf(dir).golden.join(' | '));
  const r = spawnSync(process.execPath, [CHECK, '--record', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /wrote .*test\/golden\.json/);
  assert.deepEqual(failed(dir), []);
});

test('golden: a missing golden file fails and says how to write one', (t) => {
  const dir = brokenTemplate(t, (d) => fs.rmSync(path.join(d, 'test', 'golden.json')));
  assert.ok(checksOf(dir).golden.some((p) => /--record/.test(p)));
});

test('the template is not loaded as a harness: it lives outside bench/plugins', () => {
  const { REGISTRY } = require('../lib/harness/descriptors.js');
  assert.ok(!REGISTRY.parts('harness').some((p) => p.name === 'plugin-template'));
});
