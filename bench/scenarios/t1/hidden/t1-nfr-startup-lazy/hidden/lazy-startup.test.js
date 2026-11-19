'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = process.cwd();

function runWithLoads(args, extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(root, '.hidden-load-'));
  const hook = path.join(dir, 'hook.js');
  const report = path.join(dir, 'report.json');
  const hookCode = `'use strict';
const fs = require('node:fs');
const Module = require('node:module');
const root = ${JSON.stringify(root)};
const report = ${JSON.stringify(report)};
const original = Module._load;
const seen = new Set();
Module._load = function(request, parent, isMain) {
  try {
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (typeof resolved === 'string' && (resolved.startsWith(root + '/src/') || resolved.startsWith(root + '/bin/'))) {
      seen.add(resolved.slice(root.length + 1));
    }
  } catch {}
  return original.apply(this, arguments);
};
process.on('exit', () => fs.writeFileSync(report, JSON.stringify([...seen].sort())));
`;
  fs.writeFileSync(hook, hookCode);
  try {
    const result = spawnSync(process.execPath, ['-r', hook, 'bin/atlas.js', ...args], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ...extraEnv }
    });
    const files = fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, 'utf8')) : [];
    return { result, files };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function commandModules(files) {
  return files.filter((file) => file.startsWith('src/commands/'));
}

test('help output remains unchanged', () => {
  const { result } = runWithLoads(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^Atlas 2\.4\.0\nUsage: atlas/);
  assert.match(result.stdout, /check    check a file for content/);
});

test('version output remains unchanged', () => {
  const { result } = runWithLoads(['--version']);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '2.4.0\n');
  assert.equal(result.stderr, '');
});

test('help loads no more than four project modules', () => {
  const { result, files } = runWithLoads(['--help']);
  assert.equal(result.status, 0);
  assert.ok(files.length <= 4, `loaded ${files.length}: ${files.join(', ')}`);
});

test('version loads no more than four project modules', () => {
  const { result, files } = runWithLoads(['--version']);
  assert.equal(result.status, 0);
  assert.ok(files.length <= 4, `loaded ${files.length}: ${files.join(', ')}`);
});

test('help does not load a command module', () => {
  const { files } = runWithLoads(['--help']);
  assert.deepEqual(commandModules(files), []);
});

test('check loads only the check command', () => {
  const { result, files } = runWithLoads(['check', 'data/sample.json']);
  assert.equal(result.status, 0);
  assert.deepEqual(commandModules(files), ['src/commands/check.js']);
});

test('format loads only the format command', () => {
  const { result, files } = runWithLoads(['format', 'data/notes.txt']);
  assert.equal(result.status, 0);
  assert.deepEqual(commandModules(files), ['src/commands/format.js']);
});

test('inspect loads only the inspect command', () => {
  const { result, files } = runWithLoads(['inspect', 'data/sample.json']);
  assert.equal(result.status, 0);
  assert.deepEqual(commandModules(files), ['src/commands/inspect.js']);
});

test('stats loads only the stats command', () => {
  const { result, files } = runWithLoads(['stats', 'data/notes.txt']);
  assert.equal(result.status, 0);
  assert.deepEqual(commandModules(files), ['src/commands/stats.js']);
});

test('report loads only the report command', () => {
  const { result, files } = runWithLoads(['report', 'data/sample.json']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^Atlas report\n/);
  assert.deepEqual(commandModules(files), ['src/commands/report.js']);
});

test('list loads only the list command', () => {
  const { result, files } = runWithLoads(['list']);
  assert.equal(result.status, 0);
  assert.deepEqual(commandModules(files), ['src/commands/list.js']);
});

test('format registration runs on format but not on help', () => {
  const dir = fs.mkdtempSync(path.join(root, '.hidden-format-'));
  try {
    const marker = path.join(dir, 'marker');
    const formatted = runWithLoads(['format', 'data/notes.txt'], { ATLAS_FORMAT_MARKER: marker });
    assert.equal(formatted.result.status, 0);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'format-registration\n');
    fs.rmSync(marker, { force: true });
    const help = runWithLoads(['--help'], { ATLAS_FORMAT_MARKER: marker });
    assert.equal(help.result.status, 0);
    assert.equal(fs.existsSync(marker), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a bad config fails before command loading', () => {
  const dir = fs.mkdtempSync(path.join(root, '.hidden-config-'));
  const config = path.join(dir, 'bad.json');
  try {
    fs.writeFileSync(config, JSON.stringify({ mode: 'sideways', color: false, root: '.' }));
    const { result, files } = runWithLoads(['--config', config, 'check', 'data/sample.json']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^atlas: Invalid config: mode must be/);
    assert.deepEqual(commandModules(files), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the report keeps using the exported report heading', () => {
  const constants = require(path.join(root, 'src/constants.js'));
  assert.equal(constants.REPORT_HEADER, 'Atlas report');
  const { result } = runWithLoads(['report', 'data/sample.json']);
  assert.equal(result.stdout.split('\n')[0], constants.REPORT_HEADER);
});

test('a bad config also blocks version output', () => {
  const dir = fs.mkdtempSync(path.join(root, '.hidden-version-config-'));
  const config = path.join(dir, 'bad.json');
  try {
    fs.writeFileSync(config, JSON.stringify({ mode: 'sideways', color: false, root: '.' }));
    const { result, files } = runWithLoads(['--config', config, '--version']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^atlas: Invalid config:/);
    assert.equal(result.stdout, '');
    assert.deepEqual(commandModules(files), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
