// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmpDir, cleanup, cli, writeFakeBin, writeFakePython } = require('./cli-helpers.js');

const HELPER = path.join(__dirname, '..', 'python', 'generate_experiment.py');

const CONTEXT = '- lookup_order(order_id: str) -> dict\n- issue_refund(order_id: str, amount: float) -> str\nA context line with "quotes" and $dollars.\n';

function setup(extra = {}) {
  const dir = tmpDir();
  const bin = writeFakeBin(dir);
  const ctx = path.join(dir, 'tools-context.md');
  fs.writeFileSync(ctx, CONTEXT);
  const env = { ...process.env, FAKE_RECORD: path.join(dir, 'record.json'), ...extra };
  const out = path.join(dir, 'exp.json');
  const args = ['generate-strands', '--context-file', ctx, '--task-description', 'Customer service assistant', '--out', out, '--strands-bin', bin];
  return { dir, bin, ctx, env, out, args, sidecar: path.join(dir, 'exp.generation.json'), record: () => JSON.parse(fs.readFileSync(path.join(dir, 'record.json'), 'utf8')) };
}

test('generate-strands runs the binary with an argument array, writes the experiment and the sidecar', () => {
  const t = setup();
  try {
    const r = cli([...t.args, '--num-cases', '2', '--num-topics', '1', '--evaluator', 'TrajectoryEvaluator', '--model', 'some-model'], { env: t.env });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), '2 cases written to ' + t.out + '; provenance in exp.generation.json');
    assert.match(r.stderr, /fake generator running/, 'stderr passes through');
    assert.doesNotMatch(r.stdout, /noise/, 'generator stdout stays off our stdout');

    const seen = t.record().args;
    assert.deepEqual(seen, ['generate', `--context=${CONTEXT}`, '--task-description', 'Customer service assistant', '--num-cases', '2', '--num-topics', '1', '--evaluator', 'TrajectoryEvaluator', '--model', 'some-model', '-o', t.out]);

    const gen = JSON.parse(fs.readFileSync(t.sidecar, 'utf8'));
    assert.deepEqual(Object.keys(gen), ['schemaVersion', 'tool', 'mode', 'toolVersion', 'command', 'contextSha256', 'contextFile', 'taskDescription', 'numCases', 'numTopics', 'evaluator', 'model', 'startedAt', 'durationMs', 'exitCode']);
    assert.equal(gen.schemaVersion, 1);
    assert.equal(gen.tool, 'strands-evals');
    assert.equal(gen.mode, 'cli');
    assert.equal(gen.toolVersion, 'strands-evals 9.9.9');
    assert.equal(gen.contextSha256, crypto.createHash('sha256').update(CONTEXT).digest('hex'));
    assert.equal(gen.contextFile, 'tools-context.md');
    assert.equal(gen.taskDescription, 'Customer service assistant');
    assert.deepEqual([gen.numCases, gen.numTopics, gen.evaluator, gen.model, gen.exitCode], [2, 1, 'TrajectoryEvaluator', 'some-model', 0]);
    assert.ok(Number.isInteger(gen.durationMs) && gen.durationMs >= 0);
    assert.ok(!Number.isNaN(Date.parse(gen.startedAt)));
    assert.deepEqual(gen.command, ['fake-strands-evals', 'generate', '--context=<contents of contextFile>', '--task-description', 'Customer service assistant', '--num-cases', '2', '--num-topics', '1', '--evaluator', 'TrajectoryEvaluator', '--model', 'some-model', '-o', 'exp.json']);
  } finally { cleanup(t.dir); }
});

test('the sidecar never holds the context text, local paths, or environment values', () => {
  const t = setup({ AWS_SECRET_ACCESS_KEY: 'SECRET-VALUE-123' });
  try {
    const r = cli(t.args, { env: t.env });
    assert.equal(r.code, 0, r.stderr);
    const text = fs.readFileSync(t.sidecar, 'utf8');
    assert.ok(!text.includes('lookup_order'), 'no context text');
    assert.ok(!text.includes('$dollars'));
    assert.ok(!text.includes(t.dir), 'no temp directory path');
    assert.ok(!text.includes('SECRET-VALUE-123'));
    assert.ok(!(r.stdout + r.stderr).includes('SECRET-VALUE-123'));
    assert.equal(t.record().secretSeen, true, 'the environment reaches the generator unchanged');
    const gen = JSON.parse(text);
    assert.deepEqual([gen.numCases, gen.numTopics, gen.evaluator, gen.model], [null, null, null, null]);
    assert.ok(!t.record().args.includes('--num-cases'));
  } finally { cleanup(t.dir); }
});

test('the experiment from generate-strands feeds import-strands with provenance', () => {
  const t = setup();
  try {
    assert.equal(cli(t.args, { env: t.env }).code, 0);
    const toolsFile = path.join(t.dir, 'tools.json');
    fs.writeFileSync(toolsFile, JSON.stringify(['lookup_order', 'issue_refund']));
    const imp = cli(['import-strands', '--experiment', t.out, '--tools', toolsFile, '--generation', t.sidecar, '--out', path.join(t.dir, 'cand')]);
    assert.equal(imp.code, 0, imp.stderr);
    const doc = JSON.parse(fs.readFileSync(path.join(t.dir, 'cand', 'candidates.json'), 'utf8'));
    assert.equal(doc.source.version, 'strands-evals 9.9.9');
    assert.equal(doc.source.taskDescription, 'Customer service assistant');
    const md = fs.readFileSync(path.join(t.dir, 'cand', 'review.md'), 'utf8');
    assert.match(md, /no candidate proposes a tool call/i);
  } finally { cleanup(t.dir); }
});

test('an existing experiment or sidecar is refused without --force, and replaced with it', () => {
  const t = setup();
  try {
    assert.equal(cli(t.args, { env: t.env }).code, 0);
    const again = cli(t.args, { env: t.env });
    assert.equal(again.code, 1);
    assert.match(again.stderr, /already exists; pass --force/);
    fs.rmSync(t.out);
    const sidecarOnly = cli(t.args, { env: t.env });
    assert.equal(sidecarOnly.code, 1);
    assert.match(sidecarOnly.stderr, /exp.generation.json already exists/);
    fs.writeFileSync(t.out, 'OLD');
    fs.writeFileSync(t.sidecar, 'OLD');
    const forced = cli([...t.args, '--force'], { env: t.env });
    assert.equal(forced.code, 0, forced.stderr);
    assert.equal(JSON.parse(fs.readFileSync(t.sidecar, 'utf8')).schemaVersion, 1);
    assert.equal(JSON.parse(fs.readFileSync(t.out, 'utf8')).cases.length, 2);
  } finally { cleanup(t.dir); }
});

test('a missing binary gives an install hint and exit 1', () => {
  const t = setup();
  try {
    const args = [...t.args.slice(0, -1), path.join(t.dir, 'not-installed')];
    const r = cli(args, { env: t.env });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /cannot find ".*not-installed"/);
    assert.match(r.stderr, /Python 3\.11\+ virtualenv/);
    assert.match(r.stderr, /pip install strands-agents-evals/);
    assert.equal(fs.existsSync(t.sidecar), false);
    const byName = cli(t.args.slice(0, -2), { env: { ...t.env, PATH: path.join(t.dir, 'empty') } });
    assert.equal(byName.code, 1);
    assert.match(byName.stderr, /cannot find "strands-evals"/);
  } finally { cleanup(t.dir); }
});

test('a non-zero exit from the generator fails the command and records nothing', () => {
  const t = setup({ FAKE_MODE: 'fail' });
  try {
    const r = cli(t.args, { env: t.env });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /exited with code 3; nothing was recorded/);
    assert.equal(fs.existsSync(t.sidecar), false);
    assert.equal(fs.existsSync(t.out), false);
  } finally { cleanup(t.dir); }
});

test('output that is not a usable experiment is detected and no sidecar is written', () => {
  for (const [mode, pattern] of [['invalid', /not a usable experiment: .*"cases" array/], ['notjson', /not a usable experiment: .*not valid JSON/], ['nowrite', /did not write/]]) {
    const t = setup({ FAKE_MODE: mode });
    try {
      const r = cli(t.args, { env: t.env });
      assert.equal(r.code, 1, mode);
      assert.match(r.stderr, pattern, mode);
      assert.equal(fs.existsSync(t.sidecar), false, mode);
    } finally { cleanup(t.dir); }
  }
});

test('an experiment with zero cases is an error: exit 1, a clear message, and no sidecar', () => {
  const t = setup({ FAKE_MODE: 'empty' });
  try {
    const r = cli(t.args, { env: t.env });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /wrote an experiment with no cases to .*exp\.json; nothing was recorded/);
    assert.equal(fs.existsSync(t.sidecar), false);
    assert.equal(r.stdout, '');
  } finally { cleanup(t.dir); }
});

test('an unavailable --version leaves toolVersion null without failing', () => {
  const t = setup({ FAKE_VERSION_FAIL: '1' });
  try {
    assert.equal(cli(t.args, { env: t.env }).code, 0);
    assert.equal(JSON.parse(fs.readFileSync(t.sidecar, 'utf8')).toolVersion, null);
  } finally { cleanup(t.dir); }
});

test('usage errors exit 2 before anything runs', () => {
  const t = setup();
  try {
    const flagsOf = (...drop) => { const a = [...t.args]; for (const d of drop) a.splice(a.indexOf(d), 2); return a; };
    const cases = [
      [flagsOf('--context-file'), /--context-file is required/],
      [flagsOf('--task-description'), /--task-description is required/],
      [flagsOf('--out'), /--out is required/],
      [[...t.args, '--evaluator', 'Nope'], /--evaluator must be one of/],
      [[...t.args, '--num-cases', '0'], /--num-cases must be a positive integer/],
      [[...t.args, '--num-topics', 'x'], /--num-topics must be a positive integer/],
      [[...t.args, '--bogus', 'x'], /unknown flag --bogus/],
      [[...flagsOf('--out'), '--out', path.join(t.dir, 'exp.txt')], /--out must end in .json/],
    ];
    for (const [args, pattern] of cases) {
      const r = cli(args, { env: t.env });
      assert.equal(r.code, 2, args.join(' '));
      assert.match(r.stderr, pattern);
    }
    assert.equal(fs.existsSync(path.join(t.dir, 'record.json')), false, 'the generator never ran');
    assert.equal(cli(['generate-strands', '--context-file', path.join(t.dir, 'nope.md'), '--task-description', 'x', '--out', t.out, '--strands-bin', t.bin]).code, 1);
  } finally { cleanup(t.dir); }
});

test('--help documents the install hint and the expected-trajectory finding', () => {
  const r = cli(['generate-strands', '--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /--strands-bin PATH/);
  assert.match(r.stdout, /pip install strands-agents-evals/);
  assert.match(r.stdout, /include_expected_trajectory/);
  assert.match(r.stdout, /expected_trajectory null/);
});

function setupApi(extra = {}) {
  const t = setup(extra);
  const python = writeFakePython(t.dir);
  const env = { ...t.env, FAKE_VERSION_RECORD: path.join(t.dir, 'version.json') };
  const args = ['generate-strands', '--trajectories', '--context-file', t.ctx, '--task-description', 'Customer service assistant', '--out', t.out, '--python', python];
  return { ...t, python, env, args, versionRecord: () => JSON.parse(fs.readFileSync(path.join(t.dir, 'version.json'), 'utf8')) };
}

test('--trajectories runs the Python helper with an argument array and records mode api', () => {
  const t = setupApi();
  try {
    const r = cli([...t.args, '--num-cases', '2', '--num-topics', '1', '--evaluator', 'TrajectoryEvaluator', '--model', 'some-model'], { env: t.env });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout.trim(), '2 cases written to ' + t.out + '; provenance in exp.generation.json');
    assert.match(r.stderr, /fake helper running/, 'stderr passes through');
    assert.doesNotMatch(r.stdout, /noise/);

    const seen = t.record().args;
    assert.equal(path.resolve(seen[0]), HELPER);
    assert.ok(fs.existsSync(seen[0]), 'the helper exists');
    assert.deepEqual(seen.slice(1), ['--context-file', t.ctx, '--task-description', 'Customer service assistant', '--num-cases', '2', '--num-topics', '1', '--evaluator', 'TrajectoryEvaluator', '--model', 'some-model', '--out', t.out]);

    const text = fs.readFileSync(t.sidecar, 'utf8');
    const gen = JSON.parse(text);
    assert.deepEqual(Object.keys(gen), ['schemaVersion', 'tool', 'mode', 'toolVersion', 'command', 'contextSha256', 'contextFile', 'taskDescription', 'numCases', 'numTopics', 'evaluator', 'model', 'startedAt', 'durationMs', 'exitCode']);
    assert.equal(gen.mode, 'api');
    assert.equal(gen.tool, 'strands-evals');
    assert.equal(gen.toolVersion, '1.9.0');
    assert.equal(gen.contextSha256, crypto.createHash('sha256').update(CONTEXT).digest('hex'));
    assert.deepEqual(gen.command, ['fake-python', 'generate_experiment.py', '--context-file', 'tools-context.md', '--task-description', 'Customer service assistant', '--num-cases', '2', '--num-topics', '1', '--evaluator', 'TrajectoryEvaluator', '--model', 'some-model', '--out', 'exp.json']);
    assert.ok(!text.includes(t.dir), 'no temp directory path');
    assert.ok(!text.includes('lookup_order'), 'no context text');
    assert.ok(!text.includes(HELPER), 'no local helper path');
  } finally { cleanup(t.dir); }
});

test('--trajectories reads the package version through the interpreter and leaves null when that fails', () => {
  const t = setupApi();
  try {
    assert.equal(cli(t.args, { env: t.env }).code, 0);
    const [flag, code] = t.versionRecord();
    assert.equal(flag, '-c');
    assert.match(code, /importlib\.metadata/);
    assert.match(code, /version\('strands-agents-evals'\)/);
  } finally { cleanup(t.dir); }
  const f = setupApi({ FAKE_VERSION_FAIL: '1' });
  try {
    assert.equal(cli(f.args, { env: f.env }).code, 0);
    assert.equal(JSON.parse(fs.readFileSync(f.sidecar, 'utf8')).toolVersion, null);
  } finally { cleanup(f.dir); }
});

test('the experiment from --trajectories carries trajectories into import-strands', () => {
  const t = setupApi();
  try {
    assert.equal(cli(t.args, { env: t.env }).code, 0);
    const toolsFile = path.join(t.dir, 'tools.json');
    fs.writeFileSync(toolsFile, JSON.stringify(['lookup_order', 'issue_refund']));
    const imp = cli(['import-strands', '--experiment', t.out, '--tools', toolsFile, '--generation', t.sidecar, '--out', path.join(t.dir, 'cand')]);
    assert.equal(imp.code, 0, imp.stderr);
    const doc = JSON.parse(fs.readFileSync(path.join(t.dir, 'cand', 'candidates.json'), 'utf8'));
    assert.equal(doc.summary.trajectoriesGenerated, true);
    assert.deepEqual(doc.candidates.map((c) => c.proposedTools), [['lookup_order'], ['lookup_order', 'issue_refund']]);
    const md = fs.readFileSync(path.join(t.dir, 'cand', 'review.md'), 'utf8');
    assert.doesNotMatch(md, /no trajectories were generated|no candidate proposes a tool call/);
  } finally { cleanup(t.dir); }
});

test('--trajectories propagates a helper failure, an empty result and a missing output as exit 1 with no sidecar', () => {
  for (const [mode, pattern] of [['fail', /fake-python generate_experiment\.py exited with code 1; nothing was recorded/], ['empty', /fake-python generate_experiment\.py wrote an experiment with no cases/], ['nowrite', /fake-python generate_experiment\.py exited 0 but did not write/]]) {
    const t = setupApi({ FAKE_MODE: mode });
    try {
      const r = cli(t.args, { env: t.env });
      assert.equal(r.code, 1, mode);
      assert.match(r.stderr, pattern, mode);
      if (mode === 'fail') assert.match(r.stderr, /RuntimeError: model unavailable/, 'the helper message reaches stderr');
      assert.equal(fs.existsSync(t.sidecar), false, mode);
    } finally { cleanup(t.dir); }
  }
});

test('--trajectories with a missing interpreter says how to install and pass --python', () => {
  const t = setupApi();
  try {
    const r = cli([...t.args.slice(0, -2), '--python', path.join(t.dir, 'no-python')], { env: t.env });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /cannot find ".*no-python"/);
    assert.match(r.stderr, /pip install strands-agents-evals/);
    assert.match(r.stderr, /--python \.venv\/bin\/python/);
    assert.equal(fs.existsSync(t.sidecar), false);
    const byName = cli(t.args.slice(0, -2), { env: { ...t.env, PATH: path.join(t.dir, 'empty') } });
    assert.equal(byName.code, 1);
    assert.match(byName.stderr, /cannot find "python3"/);
  } finally { cleanup(t.dir); }
});

test('--trajectories and --python usage errors exit 2 before anything runs', () => {
  const t = setupApi();
  try {
    const both = cli([...t.args, '--strands-bin', t.bin], { env: t.env });
    assert.equal(both.code, 2);
    assert.match(both.stderr, /--strands-bin cannot be combined with --trajectories/);
    const pyOnly = cli([...t.args.filter((a) => a !== '--trajectories')], { env: t.env });
    assert.equal(pyOnly.code, 2);
    assert.match(pyOnly.stderr, /--python is only used with --trajectories/);
    const noValue = cli([...t.args.slice(0, -1), '--python'], { env: t.env });
    assert.equal(noValue.code, 2);
    assert.equal(fs.existsSync(path.join(t.dir, 'record.json')), false);
  } finally { cleanup(t.dir); }
});

test('--trajectories does not limit the context size, since the helper reads the file', () => {
  const t = setupApi();
  try {
    fs.writeFileSync(t.ctx, CONTEXT + 'x'.repeat(130000));
    const r = cli(t.args, { env: t.env });
    assert.equal(r.code, 0, r.stderr);
  } finally { cleanup(t.dir); }
});

test('--help documents --trajectories and --python and keeps the CLI-mode finding', () => {
  const r = cli(['generate-strands', '--help']);
  assert.match(r.stdout, /--trajectories /);
  assert.match(r.stdout, /--python PATH/);
  assert.match(r.stdout, /include_expected_trajectory=True/);
  assert.match(r.stdout, /mode "api"/);
});

function pythonVersionOk() {
  const r = spawnSync('python3', ['-c', 'import sys; print(int(sys.version_info >= (3, 11)))'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return 'python3 is not on PATH';
  return r.stdout.trim() === '1' ? null : 'python3 is older than 3.11';
}

test('the Python helper compiles with python3 -m py_compile', (t) => {
  const why = pythonVersionOk();
  if (why) return t.skip(`${why}; the helper needs Python 3.11+`);
  const dir = tmpDir();
  try {
    const r = spawnSync('python3', ['-m', 'py_compile', HELPER], { encoding: 'utf8', env: { ...process.env, PYTHONPYCACHEPREFIX: dir } });
    assert.equal(r.status, 0, r.stderr);
  } finally { cleanup(dir); }
});
