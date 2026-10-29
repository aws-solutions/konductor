// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanStream, fixRecall, contaminationFlags, MIN_RECALL } = require('../lib/contamination.js');
const { parseStream } = require('../lib/stream.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'kiro-main-orch-input-validation.stream.jsonl');

const ENTRY = {
  repo: { name: 'Textualize/rich', url: 'https://github.com/Textualize/rich', packageNames: ['rich'] },
  pr: { number: 3938, url: 'https://github.com/Textualize/rich/pull/3938' },
  issues: [{ number: 3838, url: 'https://github.com/Textualize/rich/issues/3838' }],
};

const call = (toolName, rawInput, id = `t${Math.random()}`) => ({
  type: 'sessionUpdate',
  data: { update: { sessionUpdate: 'tool_call', toolCallId: id, title: 'x', rawInput, _meta: { kiro: { toolName } } } },
});
const shell = (command) => call('shell', { command, working_dir: '/scratch/run/work' });

test('a real captured stream of a delegating run raises no flag', () => {
  const { events } = parseStream(fs.readFileSync(FIXTURE, 'utf8'));
  assert.ok(events.filter((e) => e.data?.update?.sessionUpdate === 'tool_call').length > 20, 'the fixture has real tool calls');
  assert.deepEqual(scanStream(events, ENTRY), []);
});

test('fetch, install and download commands are flagged with the tool and the command', () => {
  const cmds = [
    'git clone https://example.org/x.git /tmp/x',
    'cd /tmp && git fetch origin main',
    'curl -sL https://example.org/a.tar.gz | tar xz',
    'wget -q https://example.org/a',
    'gh pr view 3938 --repo Textualize/rich',
    'pip install rich==14.3.0',
    'python3 -m pip install -U rich',
    'pip3 download rich',
    'npm install commander@16',
    'npm i -D left-pad',
    'cd work && (git status; curl https://example.org)',
  ];
  for (const c of cmds) {
    const found = scanStream([shell(c)], ENTRY);
    assert.equal(found.length, 1, c);
    assert.equal(found[0].tool, 'shell');
    assert.ok(found[0].text.includes(c.slice(0, 30)), c);
  }
});

test('ordinary commands and look-alike words are not flagged', () => {
  const cmds = ['git diff', 'git log --oneline | head', 'git status', 'npm test', 'npm run build', 'pip list', 'python3 -m pytest -q', 'ls high-quality/', 'echo curly braces', 'git fetcher.sh', 'cat npm-install-notes.txt', 'ping -c1 sigh'];
  for (const c of cmds) assert.deepEqual(scanStream([shell(c)], ENTRY), [], c);
});

test('a URL of the upstream repository, pull request, issue or package page is flagged in a shell command or a web tool', () => {
  const urls = [
    'https://github.com/Textualize/rich',
    'https://github.com/textualize/rich/pull/3938/files',
    'https://github.com/Textualize/rich/issues/3838',
    'https://raw.githubusercontent.com/Textualize/rich/master/rich/console.py',
    'https://api.github.com/repos/Textualize/rich/pulls/3938',
    'https://pypi.org/project/rich/',
    'https://files.pythonhosted.org/packages/ab/cd/rich-15.0.0-py3-none-any.whl',
  ];
  for (const u of urls) {
    assert.equal(scanStream([shell(`python3 -c "import urllib.request as u; u.urlopen('${u}')"`)], ENTRY).length, 1, `shell ${u}`);
    assert.equal(scanStream([call('web_fetch', { url: u })], ENTRY).length, 1, `web_fetch ${u}`);
  }
  assert.equal(scanStream([call('web_search', { query: 'rich github Textualize/rich issue 3838 soft wrap' })], ENTRY).length, 0, 'a search query without a URL is not a fetch');
  assert.equal(scanStream([call('web_fetch', { url: 'https://github.com/other/project' })], ENTRY).length, 0);
  assert.equal(scanStream([call('web_fetch', { url: 'https://docs.python.org/3/library/re.html' })], ENTRY).length, 0);
});

test('tools that carry file content or search patterns are not scanned for commands', () => {
  assert.deepEqual(scanStream([call('write', { path: 'README.md', content: 'Run `pip install rich` then curl https://github.com/Textualize/rich' })], ENTRY), []);
  assert.deepEqual(scanStream([call('grep', { pattern: 'curl|wget', path: '.' })], ENTRY), []);
  assert.deepEqual(scanStream([call('read', { operations: [{ path: '/scratch/run/work/docs/pip install.md' }] })], ENTRY), []);
  assert.deepEqual(scanStream([call('subagent', { task: 'run git clone for me' })], ENTRY), []);
});

test('a repeated tool call id is counted once and long commands are shortened in the evidence', () => {
  const long = `curl ${'x'.repeat(500)}`;
  const e = shell(long);
  const found = scanStream([e, e], ENTRY);
  assert.equal(found.length, 1);
  assert.ok(found[0].text.length <= 203);
});

test('an unusable stream or entry gives no flag instead of a crash', () => {
  assert.deepEqual(scanStream([], ENTRY), []);
  assert.deepEqual(scanStream([{ type: 'sessionUpdate', data: {} }, { type: 'x' }, { data: { update: { sessionUpdate: 'tool_call' } } }], ENTRY), []);
  assert.deepEqual(scanStream([shell('git status')], null), []);
  assert.equal(scanStream([shell('curl x')], null).length, 1, 'command patterns need no entry');
});

// A base tree, an agent tree and the upstream patch.
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'contam-')));
const write = (f, t) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };

const UPSTREAM_LINES = [
  'if force_interactive is None:',
  'tty_interactive = self._environ.get("TTY_INTERACTIVE", None)',
  'if tty_interactive is not None:',
  'force_interactive = tty_interactive == "1"',
];
const PATCH = [
  'diff --git a/rich/console.py b/rich/console.py',
  '--- a/rich/console.py',
  '+++ b/rich/console.py',
  '@@ -1,1 +1,5 @@',
  ' import os',
  ...UPSTREAM_LINES.map((l) => `+        ${l}`),
  'diff --git a/tests/test_console.py b/tests/test_console.py',
  '--- a/tests/test_console.py',
  '+++ b/tests/test_console.py',
  '@@ -1 +1,3 @@',
  ...['def test_a_test_with_a_long_enough_name_to_matter():', '    assert TTY_INTERACTIVE_SWITCH_WORKS_FOR_ALL_CASES == True  # padding padding'].map((l) => `+${l}`),
  '',
].join('\n');

function trees(agentSource, extra = {}) {
  const base = tmp();
  const work = tmp();
  write(path.join(base, 'rich/console.py'), 'import os\n');
  write(path.join(base, 'tests/test_console.py'), 'x = 1\n');
  write(path.join(work, 'rich/console.py'), agentSource);
  write(path.join(work, 'tests/test_console.py'), 'x = 1\n');
  for (const [f, t] of Object.entries(extra)) write(path.join(work, f), t);
  return { base, work, done: () => { fs.rmSync(base, { recursive: true, force: true }); fs.rmSync(work, { recursive: true, force: true }); } };
}

test('a verbatim copy of the upstream fix of 80 or more characters is reported with its length', () => {
  const t = trees(`import os\n        ${UPSTREAM_LINES.join('\n        ')}\n`);
  try {
    const r = fixRecall({ baseDir: t.base, workDir: t.work, patch: PATCH });
    assert.ok(r.matchedChars >= MIN_RECALL, `matched ${r.matchedChars}`);
    assert.deepEqual(r.files, ['rich/console.py']);
  } finally { t.done(); }
});

test('the copy is found whatever the indentation', () => {
  const t = trees(`import os\n${UPSTREAM_LINES.map((l) => `\t\t\t${l}`).join('\n')}\n`);
  try {
    assert.ok(fixRecall({ baseDir: t.base, workDir: t.work, patch: PATCH }).matchedChars >= MIN_RECALL);
  } finally { t.done(); }
});

test('a short overlap, a different fix, or no change is not reported', () => {
  const short = trees(`import os\n        ${UPSTREAM_LINES[0]}\n        ${UPSTREAM_LINES[1].slice(0, 30)}\n`);
  const other = trees('import os\nif os.environ.get("FORCE_COLOR"):\n    interactive = True\nelse:\n    interactive = False\n');
  const none = trees('import os\n');
  try {
    assert.ok(fixRecall({ baseDir: short.base, workDir: short.work, patch: PATCH }).matchedChars < MIN_RECALL);
    assert.equal(fixRecall({ baseDir: other.base, workDir: other.work, patch: PATCH }).matchedChars, 0);
    assert.equal(fixRecall({ baseDir: none.base, workDir: none.work, patch: PATCH }).matchedChars, 0);
  } finally { short.done(); other.done(); none.done(); }
});

test('copying the upstream test file or touching caches is not a recall of the fix', () => {
  const t = trees('import os\n', {
    'tests/test_console.py': 'def test_a_test_with_a_long_enough_name_to_matter():\n    assert TTY_INTERACTIVE_SWITCH_WORKS_FOR_ALL_CASES == True  # padding padding\n',
    'rich/__pycache__/console.cpython-312.pyc': 'binary\n',
    '.pytest_cache/v/cache/lastfailed': `${UPSTREAM_LINES.join('\n')}\n`,
  });
  try {
    assert.equal(fixRecall({ baseDir: t.base, workDir: t.work, patch: PATCH }).matchedChars, 0);
  } finally { t.done(); }
});

test('a patch with no non-test source lines cannot be recalled', () => {
  const t = trees('import os\nanything at all in the new file, long enough to matter for the window\n');
  try {
    assert.deepEqual(fixRecall({ baseDir: t.base, workDir: t.work, patch: '' }), { matchedChars: 0, files: [] });
  } finally { t.done(); }
});

test('flags are built from the two findings, with evidence kept separately', () => {
  assert.deepEqual(contaminationFlags({ externalFetch: [], fixRecallChars: 0 }), []);
  assert.deepEqual(contaminationFlags({ externalFetch: [{ tool: 'shell', text: 'curl x' }], fixRecallChars: 0 }), ['externalFetch']);
  assert.deepEqual(contaminationFlags({ externalFetch: [], fixRecallChars: 95 }), ['fixRecall']);
  assert.deepEqual(contaminationFlags({ externalFetch: [{ tool: 'shell', text: 'wget y' }], fixRecallChars: 80 }), ['externalFetch', 'fixRecall']);
  assert.deepEqual(contaminationFlags({ externalFetch: [], fixRecallChars: 79 }), []);
});
