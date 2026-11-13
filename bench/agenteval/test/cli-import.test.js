// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SAMPLE, RULES, TOOLS, tmpDir, cleanup, cli } = require('./cli-helpers.js');

const STATUSES = ['ok', 'needs-edit', 'reject'];
const QUALITIES = ['clean', 'structured', 'extracted', 'none'];

// The shape documented in the README, section "Candidate record".
function assertCandidatesShape(doc) {
  assert.equal(doc.schemaVersion, 1);
  assert.deepEqual(Object.keys(doc.source).sort(), ['contextSha256', 'experiment', 'generation', 'model', 'taskDescription', 'version']);
  assert.ok(Array.isArray(doc.tools) && doc.tools.every((t) => typeof t === 'string'));
  assert.deepEqual(Object.keys(doc.summary).sort(), ['byQuality', 'byReason', 'byStatus', 'total']);
  assert.equal(doc.summary.total, doc.candidates.length);
  assert.ok(doc.rubricHint === null || typeof doc.rubricHint === 'string');
  const ids = new Set();
  for (const c of doc.candidates) {
    assert.equal(typeof c.id, 'string');
    assert.ok(!ids.has(c.id), `duplicate id ${c.id}`);
    ids.add(c.id);
    assert.equal(typeof c.input, 'string');
    assert.equal(typeof c.inputNormalized, 'boolean');
    assert.ok(c.expectedOutputText === null || typeof c.expectedOutputText === 'string');
    assert.ok(Array.isArray(c.proposedTools) && c.proposedTools.every((t) => doc.tools.includes(t)));
    assert.ok(QUALITIES.includes(c.trajectoryQuality));
    assert.ok(Array.isArray(c.trajectoryNotes) && Array.isArray(c.undeclaredTools));
    assert.equal(typeof c.multiTurn, 'boolean');
    assert.equal(typeof c.placeholderOutput, 'boolean');
    assert.ok(c.duplicateOf === null || typeof c.duplicateOf === 'string');
    assert.ok(STATUSES.includes(c.status));
    assert.ok(c.reasons.every((r) => typeof r.code === 'string' && typeof r.text === 'string'));
    assert.equal(c.source.generator, 'strands-evals');
    assert.equal(typeof c.source.caseIndex, 'number');
    assert.ok('generatorTrajectory' in c && 'generatorMetadata' in c);
  }
  for (const c of doc.candidates) if (c.duplicateOf) assert.ok(ids.has(c.duplicateOf));
}

const base = (out) => ['import-strands', '--experiment', SAMPLE, '--tools', path.join(path.dirname(out), 'tools.json'), '--out', out];
function setup() {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'tools.json'), JSON.stringify(TOOLS));
  return { dir, out: path.join(dir, 'out') };
}

test('import-strands on the sample writes candidates.json and review.md and prints one summary line', () => {
  const { dir, out } = setup();
  try {
    const r = cli([...base(out), '--rules', RULES, '--batches', '2']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim().split('\n').length, 1);
    assert.match(r.stdout, /14 candidates: ok 3, needs-edit 8, reject 3/);
    const doc = JSON.parse(fs.readFileSync(path.join(out, 'candidates.json'), 'utf8'));
    assertCandidatesShape(doc);
    assert.deepEqual(doc.summary.byStatus, { ok: 3, 'needs-edit': 8, reject: 3 });
    assert.equal(doc.source.experiment, 'strands-sample.json');
    assert.equal(doc.candidates[0].source.sourceFile, 'strands-sample.json');
    assert.equal(doc.candidates[13].batchIndex, 1);
    assert.deepEqual(fs.readdirSync(out).sort(), ['candidates.json', 'review.md']);
  } finally { cleanup(dir); }
});

test('review.md carries the counts, the warning, the coverage note and one row per candidate', () => {
  const { dir, out } = setup();
  fs.writeFileSync(path.join(dir, 'tools.json'), JSON.stringify({ tools: [...TOOLS.map((name) => ({ name, description: 'x' })), { name: 'cancel_order' }] }));
  try {
    assert.equal(cli([...base(out), '--rules', RULES]).code, 0);
    const md = fs.readFileSync(path.join(out, 'review.md'), 'utf8');
    assert.match(md, /By status: ok 3, needs-edit 8, reject 3/);
    assert.match(md, /By reason code: .*trajectory:not-clean 7/);
    assert.match(md, /By trajectory quality: clean 1, structured 2, extracted 7, none 4/);
    assert.match(md, /Declared tools that never appear in any proposed trajectory: cancel_order$/m);
    assert.match(md, /proposals only/);
    assert.doesNotMatch(md, /no candidate proposes a tool call/);
    assert.match(md, /Provenance: not recorded \(no --generation file was given\)/);
    const rows = md.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| id') && !l.startsWith('| ---'));
    assert.equal(rows.length, 14);
    assert.match(rows[11], /^\| basic-order-status-inquiry-11 \| reject \| duplicate, .* \| simple-order-status-check-3 \|$/);
    assert.ok(rows.every((r) => r.split(/(?<!\\)\|/).length === 9), 'each row has seven cells');
  } finally { cleanup(dir); }
});

test('an input is cut to 100 characters in the table and a pipe in it does not break the row', () => {
  const { dir, out } = setup();
  const exp = path.join(dir, 'exp.json');
  const input = `Hi there | I need help with order #ORD-1 ${'because it is late '.repeat(10)}`;
  fs.writeFileSync(exp, JSON.stringify({ cases: [{ name: 'n', input, expected_output: 'ok', expected_trajectory: ['lookup_order(1)'] }] }));
  try {
    assert.equal(cli(['import-strands', '--experiment', exp, '--tools', path.join(dir, 'tools.json'), '--out', out]).code, 0);
    const row = fs.readFileSync(path.join(out, 'review.md'), 'utf8').split('\n').find((l) => l.startsWith('| n-0'));
    assert.ok(row.includes(`${input.slice(0, 100).replace('|', '\\|')}...`));
    assert.equal(row.split(/(?<!\\)\|/).length, 9);
  } finally { cleanup(dir); }
});

test('an existing OUT is refused without --force and replaced with it', () => {
  const { dir, out } = setup();
  try {
    assert.equal(cli(base(out)).code, 0);
    fs.writeFileSync(path.join(out, 'candidates.json'), 'KEEP');
    const refused = cli(base(out));
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /already exists; pass --force/);
    assert.equal(fs.readFileSync(path.join(out, 'candidates.json'), 'utf8'), 'KEEP');
    const forced = cli([...base(out), '--force']);
    assert.equal(forced.code, 0, forced.stderr);
    assertCandidatesShape(JSON.parse(fs.readFileSync(path.join(out, 'candidates.json'), 'utf8')));
    fs.writeFileSync(path.join(dir, 'afile'), 'x');
    assert.equal(cli([...base(path.join(dir, 'afile')), '--force']).code, 1);
  } finally { cleanup(dir); }
});

test('usage errors exit 2 and print the usage', () => {
  const { dir, out } = setup();
  const tools = path.join(dir, 'tools.json');
  const good = ['import-strands', '--experiment', SAMPLE, '--tools', tools, '--out', out];
  try {
    const bad = [
      [[...good, '--bogus', '1'], /unknown flag --bogus/],
      [[...good, '--batches'], /--batches needs a value/],
      [[...good, '--batches', '0'], /--batches must be a positive integer/],
      [[...good, '--batches', 'two'], /--batches must be a positive integer/],
      [[...good, '--duplicate-threshold', '1.5'], /--duplicate-threshold must be/],
      [[...good, '--force=yes'], /--force does not take a value/],
      [[...good, '--out', out], /given more than once/],
      [[...good, 'stray'], /unexpected argument stray/],
      [['import-strands', '--tools', tools, '--out', out], /--experiment is required/],
      [['import-strands', '--experiment', SAMPLE, '--tools', tools], /--out is required/],
      [['import-strands', '--experiment', SAMPLE, '--out', out], /one of --tools or --tools-from-text is required/],
      [[...good, '--tools-from-text', tools], /only one of --tools and --tools-from-text/],
      [['nonsense'], /unknown command nonsense/],
      [[], /usage: agenteval.js/],
    ];
    for (const [args, pattern] of bad) {
      const r = cli(args);
      assert.equal(r.code, 2, args.join(' '));
      assert.match(r.stderr, pattern, args.join(' '));
    }
    assert.match(cli([...good, '--bogus', '1']).stderr, /usage: agenteval.js import-strands/);
    assert.equal(fs.existsSync(out), false);
  } finally { cleanup(dir); }
});

test('--help prints usage on stdout and exits 0', () => {
  for (const args of [['--help'], ['import-strands', '--help']]) {
    const r = cli(args);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /usage: agenteval.js/);
  }
  assert.match(cli(['import-strands', '--help']).stdout, /--tools-from-text FILE/);
});

test('missing or unreadable inputs exit 1 with a message and write nothing', () => {
  const { dir, out } = setup();
  const tools = path.join(dir, 'tools.json');
  const missing = path.join(dir, 'nope.json');
  const withRules = path.join(dir, 'bad-rules.json');
  const emptyTools = path.join(dir, 'empty.json');
  fs.writeFileSync(emptyTools, '[]');
  fs.writeFileSync(withRules, JSON.stringify([{ before: ['lookup_order', 'unknown_tool'] }]));
  const run = (flags) => cli(['import-strands', '--out', out, ...flags]);
  try {
    const cases = [
      [['--experiment', SAMPLE, '--tools', missing], /cannot read tools file/],
      [['--experiment', SAMPLE, '--tools', emptyTools], /lists no tools/],
      [['--experiment', missing, '--tools', tools], /cannot read experiment file/],
      [['--experiment', SAMPLE, '--tools', tools, '--rules', missing], /cannot read rules file/],
      [['--experiment', SAMPLE, '--tools', tools, '--rules', withRules], /not a declared tool/],
      [['--experiment', SAMPLE, '--tools', tools, '--generation', missing], /cannot read generation file/],
      [['--experiment', SAMPLE, '--tools-from-text', missing], /cannot read context file/],
      [['--experiment', tools, '--tools', tools], /must be a JSON object with a "cases" array/],
    ];
    for (const [flags, pattern] of cases) {
      const r = run(flags);
      assert.equal(r.code, 1, flags.join(' '));
      assert.match(r.stderr, pattern);
    }
    assert.equal(fs.existsSync(out), false);
  } finally { cleanup(dir); }
});

test('--tools-from-text reads bullet lines, reports the names, and matches --tools', () => {
  const { dir, out } = setup();
  const ctx = path.join(dir, 'context.md');
  fs.writeFileSync(ctx, [
    '# Customer service agent',
    'You help with orders. Tools:',
    '- lookup_order(order_id: str) -> dict',
    '* `check_refund_policy`(order_id: str) -> str',
    '1. issue_refund(order_id: str, amount: float)',
    '  - send_email(to: str, body: str)',
    '- escalate_to_human(summary: str)',
    '- lookup_order(order_id: str) -> dict',
    'Not a tool line: call lookup_order(x) first.',
    '- not a tool because there is no paren',
  ].join('\n'));
  try {
    const args = ['import-strands', '--experiment', SAMPLE, '--tools-from-text', ctx, '--out', out];
    const r = cli(args);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stderr, /declared tools found in context.md: lookup_order, check_refund_policy, issue_refund, send_email, escalate_to_human$/m);
    const fromText = JSON.parse(fs.readFileSync(path.join(out, 'candidates.json'), 'utf8'));
    assert.deepEqual(fromText.tools, TOOLS);
    const out2 = path.join(dir, 'out2');
    assert.equal(cli(base(out2)).code, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out2, 'candidates.json'), 'utf8')).candidates, fromText.candidates);
    fs.writeFileSync(ctx, 'No tools are listed here.\n- just a bullet\n');
    const none = cli(['import-strands', '--experiment', SAMPLE, '--tools-from-text', ctx, '--out', path.join(dir, 'out3')]);
    assert.equal(none.code, 1);
    assert.match(none.stderr, /no tool names found in/);
  } finally { cleanup(dir); }
});

test('--generation fills the provenance, and a bad sidecar is an error', () => {
  const { dir, out } = setup();
  const gen = path.join(dir, 'exp.generation.json');
  fs.writeFileSync(gen, JSON.stringify({ schemaVersion: 1, tool: 'strands-evals', toolVersion: '1.9.0', model: 'some-model', contextSha256: 'abc123', taskDescription: 'Customer service assistant', numCases: 14 }));
  try {
    const r = cli([...base(out), '--generation', gen]);
    assert.equal(r.code, 0, r.stderr);
    const doc = JSON.parse(fs.readFileSync(path.join(out, 'candidates.json'), 'utf8'));
    assert.deepEqual(doc.source, { experiment: 'strands-sample.json', generation: 'exp.generation.json', version: '1.9.0', model: 'some-model', contextSha256: 'abc123', taskDescription: 'Customer service assistant' });
    assert.equal(doc.candidates[0].source.version, '1.9.0');
    assert.equal(doc.candidates[0].source.contextSha256, 'abc123');
    const md = fs.readFileSync(path.join(out, 'review.md'), 'utf8');
    assert.match(md, /generator version: 1.9.0/);
    assert.match(md, /model: some-model/);
    assert.doesNotMatch(md, /not recorded/);
    fs.writeFileSync(gen, JSON.stringify({ schemaVersion: 2 }));
    const bad = cli([...base(path.join(dir, 'out-bad')), '--generation', gen]);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /not a schemaVersion 1 sidecar/);
  } finally { cleanup(dir); }
});

test('without --generation the provenance fields are null', () => {
  const { dir, out } = setup();
  try {
    assert.equal(cli(base(out)).code, 0);
    const doc = JSON.parse(fs.readFileSync(path.join(out, 'candidates.json'), 'utf8'));
    assert.deepEqual(doc.source, { experiment: 'strands-sample.json', generation: null, version: null, model: null, contextSha256: null, taskDescription: null });
  } finally { cleanup(dir); }
});

test('--duplicate-threshold changes what counts as a duplicate', () => {
  const { dir, out } = setup();
  try {
    assert.equal(cli([...base(out), '--duplicate-threshold', '0.99']).code, 0);
    const doc = JSON.parse(fs.readFileSync(path.join(out, 'candidates.json'), 'utf8'));
    assert.equal(doc.summary.byReason.duplicate, undefined);
  } finally { cleanup(dir); }
});
