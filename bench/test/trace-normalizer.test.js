// SPDX-License-Identifier: Apache-2.0
/**
 * Trace Normalizer unit tests
 *
 * Uses Node's built-in `node:test` and `node:assert`, so no test framework dependency is needed.
 * Run: node --test bench/test/trace-normalizer.test.js
 *      (or `npm test`, which runs every bench/test/*.test.js and tests/scripts/*.test.js)
 *
 * Every fixture under fixtures/traces/ is a synthetic behavior example: it is hand-written from
 * the event shapes described in the per-runtime doc comments of bench/lib/trace-normalizer.js.
 * It is not a capture of any runtime and does not show what a current release of Claude Code,
 * OpenCode or Kiro CLI emits, so a passing fixture test proves how the parser treats that shape,
 * not that the shape matches a real runtime. Every other trace is built inline from the helpers
 * below. No test makes a network or model call. Credential-shaped test values are assembled from
 * fragments so no real-looking token appears in this file.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const normalizer = require('../lib/trace-normalizer');
const {
  normalizeTrace,
  normalizeToolName,
  skillLoadFromPath,
  assessDegraded,
  defaultRedact,
  SCHEMA_VERSION,
  MAX_STORED_STRING,
} = normalizer;

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'traces');

function loadFixture(name) {
  return fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8');
}

// --- Inline trace builders ---------------------------------------------------------------------

const FAKE_ACCESS_KEY_ID = 'AKIA' + 'X'.repeat(16);
const FAKE_STS_KEY_ID = 'ASIA' + 'Y'.repeat(16);
const FAKE_TOKEN = 'FAKE_TOKEN_VALUE';
const SECRET_FIELD = 'aws_secret_' + 'access_key';
const SESSION_FIELD = 'aws_session_' + 'token';

const jsonl = (...events) => events.map((e) => JSON.stringify(e)).join('\n');

const claudeCall = (id, name, input, extra = {}) => ({
  type: 'assistant',
  message: { model: 'model-a', content: [{ type: 'tool_use', id, name, input }] },
  ...extra,
});
const claudeResult = (id, content, isError = false, extra = {}) => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content }] },
  ...extra,
});
const claudeDone = (extra = {}) => ({
  type: 'result',
  subtype: 'success',
  result: 'final answer',
  is_error: false,
  total_cost_usd: 0.01,
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 1, cache_creation_input_tokens: 2 },
  ...extra,
});

const openCodeFinish = (id, extra = {}) => ({
  type: 'step_finish',
  sessionID: 'ses_a',
  part: { id, cost: 0.5, tokens: { input: 10, output: 20, cache: { read: 30, write: 40 } }, ...extra },
});
const openCodeText = (text, sessionID = 'ses_a') => ({ type: 'text', sessionID, part: { id: 'p', text } });
const openCodeTool = (tool, status, extra = {}) => ({
  type: 'tool_use',
  sessionID: 'ses_a',
  part: { tool, state: { status, input: { path: 'a.md' }, output: 'out' }, ...extra },
});

const kiroCall = (id, tool, args) => ({ type: 'tool_call', tool_call_id: id, tool_name: tool, arguments: args });
const kiroUpdate = (id, status, extra = {}) => ({ type: 'tool_call_update', tool_call_id: id, status, ...extra });

const SKILL_PATH = '/home/dev/.agent/skills/backend-review/SKILL.md';

// --- Schema shape ------------------------------------------------------------------------------

test('every runtime returns all documented schema fields, including parse_errors, complete and session_ids', () => {
  const expectedKeys = [
    'schema_version',
    'runtime',
    'model_id',
    'session_ids',
    'tool_calls',
    'skill_loads',
    'available_tools',
    'response_text',
    'usage',
    'cost_usd',
    'errors',
    'parse_errors',
    'complete',
    'degraded',
    'degraded_reason',
  ];
  for (const runtime of ['claude-code', 'opencode', 'kiro']) {
    const record = normalizeTrace(runtime, '');
    for (const key of expectedKeys) {
      assert.ok(key in record, `${runtime}: missing documented schema field ${key}`);
    }
    assert.equal(record.schema_version, SCHEMA_VERSION);
    assert.equal(record.parse_errors, 0);
    assert.deepEqual(record.errors, []);
  }
});

test('normalizeTrace throws on an unknown runtime rather than silently returning an empty record', () => {
  assert.throws(() => normalizeTrace('not-a-real-runtime', 'irrelevant'), /unknown runtime/);
});

// --- Public safety scan of fixtures and sources ------------------------------------------------

// The rules describe classes of private data by shape. They name no specific organization,
// host or package. Anything that looks like a real host, scoped package, home directory,
// account id or credential is flagged, and only reserved example hosts are allowed.
const EXAMPLE_HOST = /(?:^|\.)example\.(?:com|org|net)$/i;
const SAFE_MCP_SERVERS = new Set(['example', 'x']);

const SAFETY_RULES = [
  { label: 'user home directory', find: (t) => t.match(/\/Users\//) || t.match(/[A-Za-z]:\\Users\\/i) },
  { label: 'non-synthetic home path', find: (t) => t.match(/\/home\/(?!dev\/)[\w.-]+/) },
  { label: 'email address', find: (t) => t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/) },
  { label: 'twelve-digit account id', find: (t) => t.match(/(?<!\d)\d{12}(?!\d)/) },
  { label: 'access key id', find: (t) => t.match(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/) },
  { label: 'Bearer token', find: (t) => t.match(/\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i) },
  { label: 'code review reference', find: (t) => t.match(/\bCR-\d{3,}/) || t.match(/\/reviews\/(?:CR-)?\d{3,}/) },
  {
    label: 'region name',
    find: (t) => t.match(/\b(?:us|eu|ap|sa|ca|me|af)-(?:north|south|east|west|central)(?:east|west)?-\d\b/),
  },
  {
    label: 'URL to a host that is not a reserved example host',
    find: (t) => {
      for (const m of t.matchAll(/https?:\/\/([^\s/"'`)\\]+)/gi)) {
        if (!EXAMPLE_HOST.test(m[1]) && m[1] !== 'localhost') return m;
      }
      return null;
    },
  },
  {
    label: 'host name that is not a reserved example host',
    find: (t) => {
      for (const m of t.matchAll(/\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|dev|aws|edu|gov)\b/gi)) {
        if (!EXAMPLE_HOST.test(m[0])) return m;
      }
      return null;
    },
  },
  { label: 'scoped package name', find: (t) => t.match(/(?<![\w.])@[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*/i) },
  {
    label: 'tool server name that is not a placeholder',
    find: (t) => {
      for (const m of t.matchAll(/mcp__([A-Za-z0-9_-]+?)__/g)) {
        if (!SAFE_MCP_SERVERS.has(m[1])) return m;
      }
      return null;
    },
  },
  {
    label: 'UUID-shaped identifier',
    find: (t) => t.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i),
  },
  {
    label: 'long session or tool call id',
    find: (t) => t.match(/\b(?:ses|toolu)_[A-Za-z0-9]{16,}\b/),
  },
];

// The one public reference the library documents: the OpenTelemetry GenAI attribute registry.
// Only URLs under this exact repository path are exempt; any other host or repository is still flagged.
const ALLOWED_REFERENCE_URL = /https:\/\/github\.com\/open-telemetry\/semantic-conventions-genai\/[^\s"'`)]*/g;

function findPublicBlockers(rawText) {
  const text = rawText.replace(ALLOWED_REFERENCE_URL, '');
  const found = [];
  for (const rule of SAFETY_RULES) {
    const hit = rule.find(text);
    if (hit) found.push(rule.label);
  }
  return found;
}

test('the public safety scan flags each class of private data (samples are built from fragments)', () => {
  const join = (...parts) => parts.join('');
  const samples = {
    'user home directory': join('/Us', 'ers/', 'someone/project'),
    'non-synthetic home path': join('/ho', 'me/', 'someone/project'),
    'email address': join('someone', '@', 'corp.example.net'),
    'twelve-digit account id': join('1234', '5678', '9012'),
    'access key id': join('AKIA', 'Q'.repeat(16)),
    'Bearer token': join('Bearer ', 'a'.repeat(20)),
    'code review reference': join('CR', '-', '123456789'),
    'region name': join('us-', 'east-', '1'),
    'URL to a host that is not a reserved example host': join('https', '://', 'service', '.corp', '.or', 'g/path'),
    'host name that is not a reserved example host': join('service', '.corp', '.dev'),
    'scoped package name': join('@sco', 'pe/pkg-name'),
    'tool server name that is not a placeholder': join('mcp', '__', 'corp', '__', 'Tool'),
    'UUID-shaped identifier': join('1b2c3d4e', '-', '5f60', '-', '7a8b', '-', '9c0d', '-', '1e2f3a4b5c6d'),
    'long session or tool call id': join('ses', '_', 'Ab1'.repeat(8)),
  };
  for (const rule of SAFETY_RULES) {
    assert.ok(samples[rule.label], `missing sample for rule: ${rule.label}`);
    assert.ok(findPublicBlockers(samples[rule.label]).includes(rule.label), `not flagged: ${rule.label}`);
  }
  const benign = [
    'https://docs.example.com/page and http://localhost/x',
    '/home/dev/skills/demo/SKILL.md',
    'mcp__example__LoadSkill mcp__x__Skill',
    'Use Bearer authentication for the API.',
    'a 13-digit value 1234567890123 and src/index.ts',
    'ids ses_fixture_happy, ses_a and toolu_parent are short placeholders',
  ].join('\n');
  assert.deepEqual(findPublicBlockers(benign), []);
});

test('the safety scan exempts only the OpenTelemetry GenAI registry URL, not other repository links', () => {
  const join = (...parts) => parts.join('');
  const base = join('https', '://', 'git', 'hub', '.', 'com/');
  const registry = `${base}open-telemetry/semantic-conventions-genai/blob/main/docs/registry/attributes/gen-ai.md`;
  assert.deepEqual(findPublicBlockers(`See ${registry}`), []);
  const expected = ['URL to a host that is not a reserved example host', 'host name that is not a reserved example host'];
  assert.deepEqual(findPublicBlockers(`${base}some-org/some-repo/blob/main/x.md`), expected);
  assert.deepEqual(findPublicBlockers(`${base}open-telemetry/other-repo/blob/main/x.md`), expected);
  assert.deepEqual(findPublicBlockers(`${registry} and ${base}some-org/some-repo`), expected);
});

const REPO_ROOT = path.join(__dirname, '..', '..');
const LIBRARY_PATH = path.join(REPO_ROOT, 'bench', 'lib', 'trace-normalizer.js');

/**
 * The CHANGELOG bullet that announces the library: from the line that starts with "- " and names
 * the library file to the last indented line that continues it. Returns null when it is absent.
 * Only this entry is scanned, because the rest of the file is not part of this change.
 */
function libraryChangelogEntry(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.startsWith('- ') && line.includes('trace-normalizer'));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && /^\s+\S/.test(lines[end])) end += 1;
  return lines.slice(start, end).join('\n');
}

test('the CHANGELOG entry is found, and does not end at a following bullet or heading', () => {
  const markdown = '# Changelog\n- other item\n- `lib/trace-normalizer.js`, first\n  second\n- next\n';
  const entry = libraryChangelogEntry(markdown);
  assert.equal(entry, '- `lib/trace-normalizer.js`, first\n  second');
  assert.equal(libraryChangelogEntry('- nothing relevant\n'), null);
});

test('fixtures, library, test source and CHANGELOG entry hold no private paths, identities, credentials or hosts', () => {
  const fixtureNames = fs.readdirSync(FIXTURES_DIR);
  assert.ok(fixtureNames.length >= 12, 'every runtime has its four synthetic fixtures');
  const sources = fixtureNames.map((name) => [`fixtures/traces/${name}`, loadFixture(name)]);
  sources.push(['bench/test/trace-normalizer.test.js', fs.readFileSync(__filename, 'utf8')]);
  sources.push(['bench/lib/trace-normalizer.js', fs.readFileSync(LIBRARY_PATH, 'utf8')]);
  const entry = libraryChangelogEntry(fs.readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf8'));
  assert.notEqual(entry, null, 'CHANGELOG.md has an entry for the library');
  sources.push(['CHANGELOG.md (library entry)', entry]);
  assert.equal(sources.length, fixtureNames.length + 3);
  for (const [name, content] of sources) {
    assert.deepEqual(findPublicBlockers(content), [], `${name} contains data that must not be published`);
  }
});

// --- Purity scan of the library ----------------------------------------------------------------

/**
 * Splits JavaScript source into two views of the same length and line layout. Both have comments
 * blanked. `bare` also blanks the inside of string, template and regular-expression literals, so
 * a word in a message or a pattern is not mistaken for code. `code` keeps those literals, so a
 * module name written as a string can still be read. This is a scanner for one well-formed file,
 * not a parser: it does not follow a template literal nested inside a `${}` expression, and it
 * decides between a regular expression and a division from the text just before the slash.
 */
function viewSource(source) {
  const blank = (text) => text.replace(/[^\n]/g, ' ');
  let code = '';
  let bare = '';
  const add = (inCode, inBare = inCode) => {
    code += inCode;
    bare += inBare;
  };
  const regexMayStart = () => {
    const before = bare.trimEnd();
    return (
      before === '' ||
      '(,=:[!&|?{};+-*%<>~^'.includes(before.slice(-1)) ||
      /(?:^|[^\w$.])(?:return|typeof|case|void|delete|in|of|new|throw|else|do)$/.test(before)
    );
  };

  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      add(blank(source.slice(i, stop)));
      i = stop;
    } else if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      add(blank(source.slice(i, stop)));
      i = stop;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < source.length && source[j] !== ch && (ch === '`' || source[j] !== '\n')) {
        j += source[j] === '\\' ? 2 : 1;
      }
      const stop = Math.min(j + 1, source.length);
      const literal = source.slice(i, stop);
      add(literal, ch + blank(literal.slice(1, -1)) + (literal.length > 1 ? ch : ''));
      i = stop;
    } else if (ch === '/' && regexMayStart()) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length && source[j] !== '\n' && (inClass || source[j] !== '/')) {
        if (source[j] === '[') inClass = true;
        else if (source[j] === ']') inClass = false;
        j += source[j] === '\\' ? 2 : 1;
      }
      if (source[j] !== '/') {
        add(ch);
        i += 1;
      } else {
        let stop = j + 1;
        while (/[a-z]/i.test(source[stop] ?? '')) stop += 1;
        add(source.slice(i, stop), '/' + blank(source.slice(i + 1, j)) + '/' + blank(source.slice(j + 1, stop)));
        i = stop;
      }
    } else {
      add(ch);
      i += 1;
    }
  }
  return { code, bare };
}

// The library must stay a pure parser: no module loading, no process or network access.
const PURITY_RULES = [
  { label: 'require call', find: (v) => v.bare.match(/\brequire\s*\(/) },
  { label: 'import statement or dynamic import', find: (v) => v.bare.match(/\bimport\b/) },
  {
    label: 'child_process',
    find: (v) => v.bare.match(/\bchild_process\b/) || v.code.match(/['"`](?:node:)?child_process['"`]/),
  },
  { label: 'process access', find: (v) => v.bare.match(/\bprocess\s*\./) },
  { label: 'fetch call', find: (v) => v.bare.match(/\bfetch\s*\(/) },
  { label: 'http or https module', find: (v) => v.code.match(/['"`](?:node:)?(?:https?|http2)['"`]/) },
];

function findPurityViolations(source) {
  const views = viewSource(source);
  return PURITY_RULES.filter((rule) => rule.find(views)).map((rule) => rule.label);
}

test('the purity scan flags each forbidden construct in code', () => {
  const samples = {
    'require call': "const fs = require('node:fs');",
    'import statement or dynamic import': "import fs from 'node:fs';\nconst m = await import('./x.js');",
    child_process: "const { spawn } = require('node:child_process');",
    'process access': 'const home = process.env.HOME;',
    'fetch call': 'const res = await fetch(url);',
    'http or https module': 'const https = require("node:https");\nconst http = require(`http`);',
  };
  for (const rule of PURITY_RULES) {
    assert.ok(samples[rule.label], `missing sample for rule: ${rule.label}`);
    assert.ok(findPurityViolations(samples[rule.label]).includes(rule.label), `not flagged: ${rule.label}`);
  }
  assert.ok(findPurityViolations('export { x } from "./y.js"; globalThis.process.exit(1);').includes('process access'));
});

test('the purity scan ignores the same words in comments, strings, templates and patterns', () => {
  const harmless = [
    '// calls require("x"), import y, process.env, fetch(url) or child_process',
    '/* a block that mentions require( and process.exit() and "https" */',
    '/**',
    ' * Spawns no processes and does no import or fetch(ing).',
    ' */',
    "const note = 'use require( or import here, see process.env and fetch(';",
    'const tpl = `fetch( ${1 + 1} process.cwd() child_process`;',
    'const quoted = "it\'s // not a comment, and require( is only text";',
    "const quotes = /['\"`]import['\"]\\//g;",
    'const skill = /(?:^|\\/)skills\\/([^/]+)\\/SKILL\\.md$/;',
    'const ratio = (a + b) / 2 / c; // a division, not a pattern',
    'const importance = 1; const process_id = 2; const prefetch = () => 0;',
    'const url = "https://docs.example.com/page";',
  ].join('\n');
  assert.deepEqual(findPurityViolations(harmless), []);
  // A string that is exactly a module name is the shape of an import, wherever it appears.
  assert.deepEqual(findPurityViolations('const name = "http";'), ['http or https module']);
});

test('the library is pure: no modules, process, child processes or network access', () => {
  const source = fs.readFileSync(LIBRARY_PATH, 'utf8');
  const { bare } = viewSource(source);
  // A scan that lost track of its place would blank the code and pass for the wrong reason.
  assert.equal(bare.length, source.length);
  assert.match(bare, /function normalizeTrace\(/);
  assert.match(bare, /module\.exports\s*=/);
  assert.deepEqual(findPurityViolations(source), []);
});

// --- Claude Code: synthetic fixtures -----------------------------------------------------------

test('claude-code happy path (synthetic fixture): calls paired with results, answer from result event, usage and cost captured', () => {
  const record = normalizeTrace('claude-code', loadFixture('claude-code-happy-path.jsonl'));

  assert.equal(record.runtime, 'claude-code');
  assert.equal(record.model_id, 'example-model-a');
  assert.equal(record.response_text, 'The file looks fine. CRITICAL: none found.');
  assert.equal(record.cost_usd, 0.0123);
  assert.deepEqual(record.usage, {
    input_tokens: 512,
    output_tokens: 128,
    cache_read_tokens: 256,
    cache_write_tokens: 64,
  });
  assert.deepEqual(record.available_tools, ['Read', 'Write', 'Skill', 'mcp__example__LoadSkill']);
  assert.equal(record.complete, true);

  assert.equal(record.tool_calls.length, 2);
  assert.equal(record.tool_calls[0].tool_name, 'read');
  assert.equal(record.tool_calls[0].raw_tool_name, 'Read');
  assert.equal(record.tool_calls[0].status, 'completed');
  assert.equal(record.tool_calls[0].result, 'export function hello() {}');
  assert.equal(record.tool_calls[0].subagent, false);
  assert.equal(record.tool_calls[0].truncated, false);

  // The MCP skill-loading tool normalizes to "loadskill" and is not a counted skill load.
  assert.equal(record.tool_calls[1].tool_name, 'loadskill');
  assert.equal(record.tool_calls[1].status, 'completed');
  assert.deepEqual(record.skill_loads, []);

  assert.equal(record.errors.length, 0);
  assert.equal(record.degraded, false);
  assert.equal(record.degraded_reason, null);
});

test('claude-code zero tool calls (synthetic fixture): no expectation supplied means not degraded', () => {
  const record = normalizeTrace('claude-code', loadFixture('claude-code-no-tool-calls.jsonl'));
  assert.equal(record.tool_calls.length, 0);
  assert.equal(record.response_text, 'No tool calls needed. The answer is 42.');
  assert.equal(record.degraded, false, 'no expectedCallCount was given');
});

test('claude-code error trace (synthetic fixture): a failed tool_result and a top-level error event are both recorded', () => {
  const record = normalizeTrace('claude-code', loadFixture('claude-code-error.jsonl'));
  assert.equal(record.tool_calls.length, 1);
  assert.equal(record.tool_calls[0].status, 'error');
  assert.equal(record.tool_calls[0].result, 'ENOENT: no such file or directory');
  assert.equal(record.errors.length, 2);
  assert.deepEqual(
    record.errors.map((e) => e.type),
    ['tool_error', 'runtime_error'],
  );
  assert.equal(record.complete, false, 'the error fixture ends without a result event');
});

test('claude-code degraded trace (synthetic fixture): 1 of 3 expected calls flags degraded, not fabricated', () => {
  const record = normalizeTrace('claude-code', loadFixture('claude-code-degraded.jsonl'), { expectedCallCount: 3 });
  assert.equal(record.tool_calls.length, 1);
  assert.equal(record.degraded, true);
  assert.match(record.degraded_reason, /fewer than half/);
});

// --- Claude Code: skill loads ------------------------------------------------------------------

test('claude-code skill load: a Skill call with a non-error result is recorded', () => {
  const trace = jsonl(
    claudeCall('t1', 'Skill', { skill: 'backend-review' }),
    claudeResult('t1', 'loaded'),
    claudeDone(),
  );
  const record = normalizeTrace('claude-code', trace);
  assert.deepEqual(record.skill_loads, [
    { skill_name: 'backend-review', source: 'dedicated-event', raw_path: null, subagent: false },
  ]);
});

test('claude-code skill load: a Skill call whose result is an error is not a load', () => {
  const trace = jsonl(claudeCall('t1', 'Skill', { skill: 'backend-review' }), claudeResult('t1', 'denied', true));
  const record = normalizeTrace('claude-code', trace);
  assert.deepEqual(record.skill_loads, []);
  assert.equal(record.tool_calls[0].status, 'error');
});

test('claude-code skill load: a Skill call with no result yet is not a load', () => {
  const record = normalizeTrace('claude-code', jsonl(claudeCall('t1', 'Skill', { skill: 'backend-review' })));
  assert.deepEqual(record.skill_loads, []);
  assert.equal(record.tool_calls[0].status, 'unknown');
});

test('claude-code skill load: a differently named tool (mcp__x__Skill) is not a load', () => {
  const trace = jsonl(claudeCall('t1', 'mcp__x__Skill', { skill: 'backend-review' }), claudeResult('t1', 'ok'));
  const record = normalizeTrace('claude-code', trace);
  assert.deepEqual(record.skill_loads, []);
  assert.equal(record.tool_calls[0].tool_name, 'skill', 'the call itself is still recorded');
});

test('claude-code skill load: a non-string skill name is not a load', () => {
  const trace = jsonl(
    claudeCall('t1', 'Skill', { skill: { nested: 1 } }),
    claudeResult('t1', 'ok'),
    claudeCall('t2', 'Skill', { skill: 42 }),
    claudeResult('t2', 'ok'),
    claudeCall('t3', 'Skill', {}),
    claudeResult('t3', 'ok'),
  );
  const record = normalizeTrace('claude-code', trace);
  assert.deepEqual(record.skill_loads, []);
  assert.equal(record.tool_calls.length, 3);
});

test('claude-code skill load: the result may arrive several events after the call', () => {
  const trace = jsonl(
    claudeCall('t1', 'Skill', { skill: 'a-skill' }),
    claudeCall('t2', 'Read', { path: 'x' }),
    claudeResult('t2', 'x'),
    claudeResult('t1', 'loaded'),
  );
  const record = normalizeTrace('claude-code', trace);
  assert.deepEqual(
    record.skill_loads.map((l) => l.skill_name),
    ['a-skill'],
  );
});

// --- Claude Code: subagents --------------------------------------------------------------------

test('claude-code subagent events are kept and their tool calls and skill loads are flagged', () => {
  const trace = jsonl(
    claudeCall('t1', 'Read', { path: 'a' }),
    claudeResult('t1', 'a'),
    claudeCall('s1', 'Skill', { skill: 'sub-skill' }, { parent_tool_use_id: 'toolu_parent' }),
    claudeResult('s1', 'ok', false, { parent_tool_use_id: 'toolu_parent' }),
    claudeDone(),
  );
  const record = normalizeTrace('claude-code', trace);
  assert.deepEqual(
    record.tool_calls.map((c) => c.subagent),
    [false, true],
  );
  assert.equal(record.skill_loads.length, 1);
  assert.equal(record.skill_loads[0].subagent, true);
});

test('claude-code model_id comes from top-level events, not from a subagent event', () => {
  const trace = jsonl(
    { type: 'assistant', message: { model: 'main-model', content: [] } },
    { type: 'assistant', message: { model: 'sub-model', content: [] }, parent_tool_use_id: 'toolu_parent' },
  );
  assert.equal(normalizeTrace('claude-code', trace).model_id, 'main-model');
});

// --- Completeness and parse errors -------------------------------------------------------------

test('claude-code complete is true only when a terminal result event was seen', () => {
  const withResult = normalizeTrace('claude-code', jsonl(claudeCall('t1', 'Read', {}), claudeDone()));
  assert.equal(withResult.complete, true);
  const truncated = normalizeTrace('claude-code', jsonl(claudeCall('t1', 'Read', {}), claudeResult('t1', 'x')));
  assert.equal(truncated.complete, false, 'a trace cut off before the result event must not look clean');
  assert.equal(truncated.cost_usd, null);
  assert.equal(truncated.usage, null);
});

test('opencode complete is true when at least one step_finish was seen, false otherwise', () => {
  assert.equal(normalizeTrace('opencode', jsonl(openCodeFinish('f1'))).complete, true);
  assert.equal(normalizeTrace('opencode', jsonl(openCodeText('partial answer'))).complete, false);
  assert.equal(normalizeTrace('opencode', loadFixture('opencode-happy-path.jsonl')).complete, true);
});

test('kiro complete is null because the stream has no terminal event', () => {
  assert.equal(normalizeTrace('kiro', loadFixture('kiro-happy-path.jsonl')).complete, null);
});

test('parse_errors counts unparseable lines and non-object lines, not blank lines', () => {
  const trace = [
    '{"type":"system","subtype":"init","tools":["Read"]}',
    '',
    '   ',
    '{"type": "assistant", "message": {',
    '42',
    'null',
    '[1,2]',
    '"just a string"',
    JSON.stringify(claudeDone()),
  ].join('\n');
  for (const runtime of ['claude-code', 'opencode', 'kiro']) {
    const record = normalizeTrace(runtime, trace);
    assert.equal(record.parse_errors, 5, `${runtime}: truncated JSON, 42, null, array and string are parse errors`);
  }
  assert.equal(normalizeTrace('claude-code', trace).complete, true, 'valid lines around the bad ones still parse');
});

test('parse_errors counts non-object items in an array of pre-parsed events', () => {
  const record = normalizeTrace('claude-code', [null, 7, 'not json', claudeDone()]);
  assert.equal(record.parse_errors, 3);
  assert.equal(record.complete, true);
});

// --- Numbers -----------------------------------------------------------------------------------

test('claude-code cost: negative, non-finite and non-numeric values become null plus an error', () => {
  for (const bad of [-1, 'abc', {}, [], Infinity, NaN, true]) {
    const record = normalizeTrace('claude-code', [claudeDone({ total_cost_usd: bad })]);
    assert.equal(record.cost_usd, null, `cost ${String(bad)} must not be stored`);
    assert.ok(
      record.errors.some((e) => e.type === 'invalid_number' && /total_cost_usd/.test(e.message)),
      `cost ${String(bad)} must add an invalid_number error`,
    );
  }
});

test('claude-code cost and tokens: numeric strings are coerced and zero is valid', () => {
  const record = normalizeTrace('claude-code', [
    claudeDone({ total_cost_usd: '0.25', usage: { input_tokens: '7', output_tokens: 0 } }),
  ]);
  assert.equal(record.cost_usd, 0.25);
  assert.equal(record.usage.input_tokens, 7);
  assert.equal(record.usage.output_tokens, 0);
  assert.equal(record.usage.cache_read_tokens, null, 'an absent value is null without an error');
  assert.equal(record.errors.length, 0);
});

test('claude-code tokens: a negative token count becomes null for that field only', () => {
  const record = normalizeTrace('claude-code', [claudeDone({ usage: { input_tokens: -5, output_tokens: 9 } })]);
  assert.equal(record.usage.input_tokens, null);
  assert.equal(record.usage.output_tokens, 9);
  assert.equal(record.errors.filter((e) => e.type === 'invalid_number').length, 1);
});

test('opencode: an invalid cost or token value nulls that total and adds an error', () => {
  const record = normalizeTrace(
    'opencode',
    jsonl(
      openCodeFinish('f1'),
      openCodeFinish('f2', { cost: -2, tokens: { input: 'x', output: 5, cache: { read: 1, write: 1 } } }),
    ),
  );
  assert.equal(record.cost_usd, null);
  assert.equal(record.usage.input_tokens, null);
  assert.equal(record.usage.output_tokens, 25);
  assert.equal(record.errors.filter((e) => e.type === 'invalid_number').length, 2);
});

test('opencode step_finish is deduplicated by part id; events without an id are all counted', () => {
  const duplicated = normalizeTrace('opencode', jsonl(openCodeFinish('same'), openCodeFinish('same')));
  assert.equal(duplicated.cost_usd, 0.5);
  assert.equal(duplicated.usage.input_tokens, 10);

  const noIds = normalizeTrace('opencode', jsonl(openCodeFinish(undefined), openCodeFinish(undefined)));
  assert.equal(noIds.cost_usd, 1);
  assert.equal(noIds.usage.input_tokens, 20);

  const distinct = normalizeTrace('opencode', jsonl(openCodeFinish('a'), openCodeFinish('b')));
  assert.equal(distinct.cost_usd, 1);
});

test('opencode session_ids lists every session seen and more than one adds an error', () => {
  const single = normalizeTrace('opencode', loadFixture('opencode-happy-path.jsonl'));
  assert.deepEqual(single.session_ids, ['ses_fixture_happy']);
  assert.equal(single.errors.length, 0);

  const mixed = normalizeTrace('opencode', jsonl(openCodeText('a', 'ses_one'), openCodeText('b', 'ses_two')));
  assert.deepEqual(mixed.session_ids, ['ses_one', 'ses_two']);
  assert.equal(mixed.errors.filter((e) => e.type === 'multiple_sessions').length, 1);
});

// --- Robustness --------------------------------------------------------------------------------

test('claude-code never throws on malformed events and blocks, and records malformed_event with the line', () => {
  const events = [
    { type: 'assistant', message: 'not an object' },
    { type: 'assistant', message: { content: 'not an array' } },
    { type: 'assistant', message: { content: [null, 5, { type: 'text' }, { type: 'text', text: 9 }] } },
    { type: 'user', message: { content: [null] } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } },
    claudeDone(),
  ];
  let record;
  assert.doesNotThrow(() => {
    record = normalizeTrace('claude-code', events);
  });
  const malformed = record.errors.filter((e) => e.type === 'malformed_event');
  assert.deepEqual(
    malformed.map((e) => e.line),
    [1, 2, 3, 4],
    'one malformed_event per bad event, carrying its 1-based line',
  );
  assert.equal(record.complete, true, 'good events around the bad ones are still read');
});

test('claude-code a non-string tool name becomes a string or "unknown"', () => {
  const trace = [
    claudeCall('t1', 42, {}),
    claudeCall('t2', null, {}),
    claudeCall('t3', { x: 1 }, {}),
    claudeCall('t4', undefined, {}),
  ];
  const record = normalizeTrace('claude-code', trace);
  assert.deepEqual(
    record.tool_calls.map((c) => c.raw_tool_name),
    ['42', 'unknown', 'unknown', 'unknown'],
  );
  assert.deepEqual(
    record.tool_calls.map((c) => c.tool_name),
    ['42', 'unknown', 'unknown', 'unknown'],
  );
});

test('a tool name that is missing, null, an object or empty adds one invalid_tool_name error; number and boolean names do not', () => {
  const claude = normalizeTrace('claude-code', [
    claudeCall('t1', null, {}),
    claudeCall('t2', { x: 1 }, {}),
    claudeCall('t3', '', {}),
    claudeCall('t4', 42, {}),
    claudeCall('t5', true, {}),
  ]);
  assert.deepEqual(
    claude.errors.map((e) => [e.type, e.line, e.raw.event_type]),
    [
      ['invalid_tool_name', 1, 'assistant'],
      ['invalid_tool_name', 2, 'assistant'],
      ['invalid_tool_name', 3, 'assistant'],
    ],
  );
  assert.deepEqual(
    claude.tool_calls.map((c) => c.raw_tool_name),
    ['unknown', 'unknown', 'unknown', '42', 'true'],
  );

  const openCode = normalizeTrace('opencode', [openCodeTool(null, 'completed'), openCodeTool(7, 'completed')]);
  assert.deepEqual(
    openCode.errors.map((e) => [e.type, e.line]),
    [['invalid_tool_name', 1]],
  );
  const kiro = normalizeTrace('kiro', [kiroCall('c1', { weird: true }, {}), kiroCall('c2', false, {})]);
  assert.deepEqual(
    kiro.errors.map((e) => [e.type, e.line]),
    [['invalid_tool_name', 1]],
  );
  assert.equal(kiro.tool_calls[1].raw_tool_name, 'false');
});

test('null and non-object events count in parse_errors only, with no malformed_event', () => {
  for (const runtime of ['claude-code', 'opencode', 'kiro']) {
    const record = normalizeTrace(runtime, [null, 7, 'text', [1], true, 'not json {']);
    assert.equal(record.parse_errors, 6, runtime);
    assert.deepEqual(record.errors, [], runtime);
  }
});

test('claude-code a non-object tool input is stored as an empty arguments object', () => {
  const record = normalizeTrace('claude-code', [claudeCall('t1', 'Read', 'a string'), claudeCall('t2', 'Read', [1])]);
  assert.deepEqual(record.tool_calls[0].arguments, {});
  assert.deepEqual(record.tool_calls[1].arguments, {});
});

test('errors[].message is always a string, even for object or numeric error payloads', () => {
  const claude = normalizeTrace('claude-code', [
    { type: 'error', message: { nested: true } },
    { type: 'error', error: 500 },
    { type: 'error' },
    claudeDone({ is_error: true, result: { not: 'a string' } }),
  ]);
  const openCode = normalizeTrace('opencode', [
    { type: 'error', error: { message: 12 } },
    { type: 'error', error: 'boom' },
  ]);
  const kiro = normalizeTrace('kiro', [
    { type: 'error', message: [1] },
    { type: 'error', error: { message: 'deep' } },
  ]);
  for (const record of [claude, openCode, kiro]) {
    assert.ok(record.errors.length > 0);
    for (const error of record.errors) assert.equal(typeof error.message, 'string');
  }
  assert.equal(openCode.errors[1].message, 'boom');
  assert.equal(kiro.errors[1].message, 'deep');
});

test('opencode an empty final text event does not overwrite a real answer', () => {
  const record = normalizeTrace(
    'opencode',
    jsonl(openCodeText('the real answer'), openCodeText(''), openCodeText('  \n')),
  );
  assert.equal(record.response_text, 'the real answer');
});

test('opencode malformed events are recorded and skipped without throwing', () => {
  const events = [
    { type: 'tool_use', part: 'nope' },
    { type: 'text', part: { text: 7 } },
    { type: 'step_finish', part: null },
    { type: 'tool_use', part: { tool: 99, state: null } },
    openCodeFinish('ok'),
  ];
  let record;
  assert.doesNotThrow(() => {
    record = normalizeTrace('opencode', events);
  });
  assert.deepEqual(
    record.errors.filter((e) => e.type === 'malformed_event').map((e) => e.line),
    [1, 2, 3],
  );
  assert.equal(record.tool_calls.length, 1);
  assert.equal(record.tool_calls[0].raw_tool_name, '99');
  assert.equal(record.tool_calls[0].status, 'error');
  assert.equal(record.cost_usd, 0.5);
});

test('kiro malformed events do not throw, and a null or non-string field is skipped', () => {
  const events = [
    { type: 'agent_message_chunk', content: null },
    { type: 'tool_call', tool_call_id: 'c1', tool_name: { weird: true }, arguments: 'x' },
    { type: 'tool_call_update', tool_call_id: 'c1', status: 'completed', result: { a: 1 } },
    { type: 'model', model: 12 },
    { type: 'agent_message_chunk', content: 'answer' },
  ];
  let record;
  assert.doesNotThrow(() => {
    record = normalizeTrace('kiro', events);
  });
  assert.equal(record.response_text, 'answer');
  assert.equal(record.tool_calls[0].raw_tool_name, 'unknown');
  assert.deepEqual(record.tool_calls[0].arguments, {});
  assert.equal(record.model_id, null);
});

test('every runtime accepts null, undefined and non-string input without throwing', () => {
  for (const runtime of ['claude-code', 'opencode', 'kiro']) {
    for (const input of [null, undefined, '', [], 12345, {}]) {
      assert.doesNotThrow(() => normalizeTrace(runtime, input), `${runtime} with ${String(input)}`);
    }
    assert.doesNotThrow(() => normalizeTrace(runtime, '', null));
    assert.doesNotThrow(() => normalizeTrace(runtime, '', 'not an options object'));
  }
});

// --- Data exposure -----------------------------------------------------------------------------

test('errors[].raw holds only the event type and line, never an event', () => {
  const trace = jsonl(
    claudeCall('t1', 'Read', { path: 'a' }),
    claudeResult('t1', 'SECRET_BODY_TEXT', true),
    { type: 'error', message: 'failure', extra: 'SECRET_EXTRA_FIELD' },
    claudeDone({ is_error: true, result: 'run failed' }),
  );
  const record = normalizeTrace('claude-code', trace);
  assert.ok(record.errors.length >= 3);
  for (const error of record.errors) {
    assert.deepEqual(Object.keys(error.raw).sort(), ['event_type', 'line']);
  }
  const serialized = JSON.stringify(record.errors);
  assert.ok(!serialized.includes('SECRET_BODY_TEXT'));
  assert.ok(!serialized.includes('SECRET_EXTRA_FIELD'));
});

test('stored tool results are capped at 8 KB and the call is marked truncated', () => {
  const big = 'a'.repeat(MAX_STORED_STRING * 3);
  const record = normalizeTrace('claude-code', [claudeCall('t1', 'Read', {}), claudeResult('t1', big)]);
  assert.equal(record.tool_calls[0].result.length, MAX_STORED_STRING);
  assert.equal(record.tool_calls[0].truncated, true);
});

test('stored tool arguments are capped at 8 KB across the whole value and the call is marked truncated', () => {
  const record = normalizeTrace('claude-code', [
    claudeCall('t1', 'Write', { first: 'x'.repeat(5000), second: 'y'.repeat(5000), small: 'z' }),
  ]);
  const args = record.tool_calls[0].arguments;
  const stored = Object.entries(args).reduce((sum, [key, value]) => sum + key.length + value.length, 0);
  assert.equal(stored <= MAX_STORED_STRING, true, 'keys and values together stay within the budget');
  assert.equal(args.first.length, 5000, 'strings under the budget are kept whole');
  assert.equal(record.tool_calls[0].truncated, true);
});

test('a small result and small arguments are stored whole and not marked truncated', () => {
  const record = normalizeTrace('opencode', jsonl(openCodeTool('read', 'completed')));
  assert.equal(record.tool_calls[0].truncated, false);
  assert.equal(record.tool_calls[0].result, 'out');
});

test('structured results are redacted and capped inside nested values', () => {
  const nested = [
    { type: 'text', text: `${SECRET_FIELD}=${FAKE_TOKEN}` },
    { type: 'text', text: 'b'.repeat(20000) },
  ];
  const record = normalizeTrace('claude-code', [claudeCall('t1', 'Read', {}), claudeResult('t1', nested)]);
  const result = record.tool_calls[0].result;
  assert.ok(Array.isArray(result));
  assert.ok(!JSON.stringify(result).includes(FAKE_TOKEN));
  assert.equal(record.tool_calls[0].truncated, true);
});

test('default redactor masks access key ids, secret and session token values, and Bearer tokens', () => {
  const input = [
    `id ${FAKE_ACCESS_KEY_ID} and ${FAKE_STS_KEY_ID}`,
    `${SECRET_FIELD}=${FAKE_TOKEN}`,
    `${SESSION_FIELD}: ${FAKE_TOKEN}`,
    `{"SecretAccessKey": "${FAKE_TOKEN}"}`,
    `{\\"SessionToken\\": \\"${FAKE_TOKEN}\\"}`,
    `Authorization: Bearer ${FAKE_TOKEN}`,
  ].join('\n');
  const out = defaultRedact(input);
  assert.ok(!out.includes(FAKE_ACCESS_KEY_ID));
  assert.ok(!out.includes(FAKE_STS_KEY_ID));
  assert.ok(!out.includes(FAKE_TOKEN));
  assert.match(out, /\[REDACTED_AWS_KEY_ID\]/);
  assert.match(out, /Bearer \[REDACTED\]/);
  assert.equal(defaultRedact('plain text about a Bearer of news'), 'plain text about a Bearer of news');
  assert.equal(defaultRedact(5), 5, 'non-strings pass through untouched');
});

test('default redactor leaves prose that follows the word Bearer unchanged', () => {
  for (const prose of [
    'Use Bearer authentication for the API.',
    'The bearer instrument is unsigned.',
    'Bearer Authentication Scheme',
  ]) {
    assert.equal(defaultRedact(prose), prose);
  }
});

test('default redactor masks a Bearer token of 16 or more characters, and only the token', () => {
  const token = 'tok' + '_'.repeat(2) + 'x'.repeat(18);
  assert.equal(defaultRedact(`Authorization: Bearer ${token} sent`), 'Authorization: Bearer [REDACTED] sent');
  assert.equal(defaultRedact(`bearer ${'z'.repeat(16)}`), 'bearer [REDACTED]');
  assert.equal(defaultRedact(`Bearer ${'z'.repeat(15)}`), `Bearer ${'z'.repeat(15)}`, 'one short of the minimum');
});

test('default redaction applies to arguments, results and error messages in every runtime', () => {
  const secret = `${SECRET_FIELD}=${FAKE_TOKEN}`;
  const claude = normalizeTrace('claude-code', [
    claudeCall('t1', 'Bash', { command: `export ${secret}` }),
    claudeResult('t1', `out ${FAKE_ACCESS_KEY_ID}`),
    { type: 'error', message: `failed with ${secret}` },
  ]);
  const openCode = normalizeTrace('opencode', [
    {
      type: 'tool_use',
      part: { tool: 'bash', state: { status: 'completed', input: { command: secret }, output: secret } },
    },
    { type: 'error', error: { message: `Bearer ${FAKE_TOKEN}` } },
  ]);
  const kiro = normalizeTrace('kiro', [
    kiroCall('c1', 'execute', { command: secret }),
    kiroUpdate('c1', 'failed', { error: secret, result: secret }),
  ]);
  for (const record of [claude, openCode, kiro]) {
    const serialized = JSON.stringify(record);
    assert.ok(!serialized.includes(FAKE_TOKEN), `${record.runtime} leaked a token`);
    assert.ok(!serialized.includes(FAKE_ACCESS_KEY_ID), `${record.runtime} leaked a key id`);
  }
});

test('options.redact replaces the built-in redactor for arguments, results, error messages and paths', () => {
  const redact = (s) => s.replace(/CUSTOM_SECRET/g, '[X]');
  const record = normalizeTrace(
    'kiro',
    [
      kiroCall('c1', 'fsRead', { path: '/home/dev/CUSTOM_SECRET/skills/my-skill/SKILL.md' }),
      kiroUpdate('c1', 'completed', { result: 'CUSTOM_SECRET body' }),
      kiroCall('c2', 'fsRead', { path: 'CUSTOM_SECRET.txt' }),
      kiroUpdate('c2', 'failed', { error: 'CUSTOM_SECRET denied' }),
    ],
    { redact },
  );
  assert.equal(record.tool_calls[0].arguments.path, '/home/dev/[X]/skills/my-skill/SKILL.md');
  assert.equal(record.tool_calls[0].result, '[X] body');
  assert.equal(record.skill_loads[0].raw_path, '/home/dev/[X]/skills/my-skill/SKILL.md');
  assert.equal(record.errors[0].message, '[X] denied');
});

test('options.redact that throws or returns a non-string fails closed instead of leaking text', () => {
  for (const redact of [
    () => {
      throw new Error('boom');
    },
    () => 123,
  ]) {
    const record = normalizeTrace('claude-code', [claudeCall('t1', 'Bash', { command: FAKE_TOKEN })], { redact });
    assert.ok(!JSON.stringify(record).includes(FAKE_TOKEN));
    assert.deepEqual(
      record.tool_calls[0].arguments,
      { '[REDACTION_FAILED]': '[REDACTION_FAILED]' },
      'both the key and the value fail closed',
    );
  }
});

test('options.redact that is not a function is ignored with an invalid_option error', () => {
  const record = normalizeTrace('claude-code', [claudeCall('t1', 'Bash', { command: `Bearer ${FAKE_TOKEN}` })], {
    redact: 'nope',
  });
  assert.ok(record.errors.some((e) => e.type === 'invalid_option' && /redact/.test(e.message)));
  assert.ok(!JSON.stringify(record.tool_calls).includes(FAKE_TOKEN), 'the built-in redactor still ran');
});

// --- OpenCode: synthetic fixtures --------------------------------------------------------------

test('opencode happy path (synthetic fixture): fused call and result, last text event is the answer', () => {
  const record = normalizeTrace('opencode', loadFixture('opencode-happy-path.jsonl'));

  assert.equal(record.runtime, 'opencode');
  assert.equal(record.model_id, null, 'OpenCode events do not name the model');
  assert.equal(record.tool_calls.length, 1);
  assert.equal(record.tool_calls[0].tool_name, 'read');
  assert.equal(record.tool_calls[0].status, 'completed');
  assert.equal(record.tool_calls[0].arguments.path, 'fixtures/scenario-artifact.md');
  assert.ok(record.tool_calls[0].result.includes('MARKER'));

  assert.ok(record.response_text.startsWith('```json'), 'the fence is kept; stripping it is left to the consumer');
  assert.ok(record.response_text.includes('SYNTHETIC-MARKER-0001'));

  assert.equal(record.cost_usd, 0.005);
  assert.deepEqual(record.usage, {
    input_tokens: 4,
    output_tokens: 60,
    cache_read_tokens: 12000,
    cache_write_tokens: 140,
  });
  assert.equal(record.available_tools, 'unknown');
  assert.deepEqual(record.skill_loads, []);
  assert.equal(record.degraded, false);
});

test('opencode zero tool calls (synthetic fixture): no tool_use events at all', () => {
  const record = normalizeTrace('opencode', loadFixture('opencode-no-tool-calls.jsonl'));
  assert.equal(record.tool_calls.length, 0);
  assert.equal(record.response_text, 'OK');
  assert.equal(record.usage, null, 'no step_finish event appears in this fixture');
  assert.equal(record.cost_usd, null);
  assert.equal(record.complete, false);
  assert.equal(record.degraded, false);
});

test('opencode error trace (synthetic fixture): a type "error" event is recorded', () => {
  const record = normalizeTrace('opencode', loadFixture('opencode-error.jsonl'));
  assert.equal(record.errors.length, 1);
  assert.equal(record.errors[0].type, 'runtime_error');
  assert.match(record.errors[0].message, /unsupported model option/);
  assert.equal(record.tool_calls.length, 0);
});

test('opencode degraded trace (synthetic fixture): 1 of 3 expected calls flags degraded', () => {
  const record = normalizeTrace('opencode', loadFixture('opencode-degraded.jsonl'), { expectedCallCount: 3 });
  assert.equal(record.tool_calls.length, 1);
  assert.equal(record.degraded, true);
  assert.match(record.degraded_reason, /fewer than half/);
});

test('opencode tool status other than completed is an error with an error entry', () => {
  const record = normalizeTrace('opencode', jsonl(openCodeTool('bash', 'running')));
  assert.equal(record.tool_calls[0].status, 'error');
  assert.equal(record.errors[0].type, 'tool_error');
  assert.match(record.errors[0].message, /bash/);
});

// --- Kiro: synthetic fixtures ------------------------------------------------------------------

test('kiro happy path (synthetic fixture): call and update pairing, skill load from a completed read, available_tools unknown', () => {
  const record = normalizeTrace('kiro', loadFixture('kiro-happy-path.jsonl'));

  assert.equal(record.runtime, 'kiro');
  assert.equal(record.model_id, 'example-model-b');
  assert.equal(record.tool_calls.length, 2);
  assert.equal(record.tool_calls[0].status, 'completed');
  assert.equal(record.tool_calls[0].tool_name, 'fsread');

  assert.deepEqual(record.skill_loads, [
    { skill_name: 'backend-review', source: 'path-heuristic', raw_path: SKILL_PATH, subagent: false },
  ]);
  assert.equal(record.available_tools, 'unknown');
  assert.equal(record.usage, null);
  assert.equal(record.cost_usd, null);
  assert.ok(record.response_text.includes('CRITICAL'));
  assert.equal(record.degraded, false);
});

test('kiro zero tool calls (synthetic fixture): no expectation supplied means not degraded', () => {
  const record = normalizeTrace('kiro', loadFixture('kiro-no-tool-calls.jsonl'));
  assert.equal(record.tool_calls.length, 0);
  assert.equal(record.skill_loads.length, 0);
  assert.equal(record.degraded, false);
});

test('kiro error trace (synthetic fixture): a failed update is recorded on the call and in errors, plus the error event', () => {
  const record = normalizeTrace('kiro', loadFixture('kiro-error.jsonl'));
  assert.equal(record.tool_calls.length, 1);
  assert.equal(record.tool_calls[0].status, 'error');
  assert.equal(record.errors.length, 2);
});

test('kiro degraded trace (synthetic fixture): 0 of 1 expected call flags degraded, and the reason names the expected count', () => {
  const record = normalizeTrace('kiro', loadFixture('kiro-degraded.jsonl'), { expectedCallCount: 1 });
  assert.equal(record.tool_calls.length, 0);
  assert.equal(record.degraded, true);
  assert.match(record.degraded_reason, /expected at least 1/);
});

// --- Kiro: skill loads -------------------------------------------------------------------------

test('kiro skill load: only read tools count, so a write to a skill path is not a load', () => {
  const record = normalizeTrace('kiro', [
    kiroCall('c1', 'fsWrite', { path: SKILL_PATH, text: 'new' }),
    kiroUpdate('c1', 'completed'),
    kiroCall('c2', 'fs_read', { path: SKILL_PATH }),
    kiroUpdate('c2', 'completed'),
  ]);
  assert.deepEqual(
    record.skill_loads.map((l) => l.skill_name),
    ['backend-review'],
  );
  assert.equal(record.tool_calls.length, 2);
});

test('kiro skill load: a failed or never-completed read is not a load', () => {
  const record = normalizeTrace('kiro', [
    kiroCall('c1', 'fsRead', { path: SKILL_PATH }),
    kiroUpdate('c1', 'failed', { error: 'no such file' }),
    kiroCall('c2', 'fsRead', { path: SKILL_PATH }),
    kiroUpdate('c2', 'error'),
    kiroCall('c3', 'fsRead', { path: SKILL_PATH }),
    kiroCall('c4', 'fsRead', { path: SKILL_PATH }),
    kiroUpdate('c4', 'in_progress'),
  ]);
  assert.deepEqual(record.skill_loads, []);
});

test('kiro skill load: the path must end at skills/<name>/SKILL.md on a segment boundary, case-sensitive', () => {
  const paths = [
    '/home/dev/myskills/x/SKILL.md',
    '/home/dev/skills/x/skill.md',
    '/home/dev/Skills/x/SKILL.md',
    '/home/dev/skills/x/SKILL.md.bak',
    '/home/dev/skills/x/y/SKILL.md.txt',
    '/home/dev/skills//SKILL.md',
    'skills/../SKILL.md',
  ];
  const events = [];
  paths.forEach((p, i) => {
    events.push(kiroCall(`c${i}`, 'fsRead', { path: p }), kiroUpdate(`c${i}`, 'completed'));
  });
  assert.deepEqual(normalizeTrace('kiro', events).skill_loads, []);
});

test('kiro skill load: a relative path and a Windows-style path both match', () => {
  const record = normalizeTrace('kiro', [
    kiroCall('c1', 'fsRead', { path: 'skills/rel-skill/SKILL.md' }),
    kiroUpdate('c1', 'completed'),
    kiroCall('c2', 'fsRead', { file_path: 'C:\\agent\\skills\\win-skill\\SKILL.md' }),
    kiroUpdate('c2', 'completed'),
  ]);
  assert.deepEqual(
    record.skill_loads.map((l) => [l.skill_name, l.raw_path]),
    [
      ['rel-skill', 'skills/rel-skill/SKILL.md'],
      ['win-skill', 'C:/agent/skills/win-skill/SKILL.md'],
    ],
  );
});

// --- Kiro: status, ids, model ------------------------------------------------------------------

test('kiro status failed and error both map to error and always add an errors entry', () => {
  for (const status of ['failed', 'error']) {
    const record = normalizeTrace('kiro', [kiroCall('c1', 'execute', {}), kiroUpdate('c1', status)]);
    assert.equal(record.tool_calls[0].status, 'error', status);
    assert.equal(record.errors.length, 1, status);
    assert.equal(record.errors[0].type, 'tool_error');
    assert.equal(typeof record.errors[0].message, 'string');
  }
  const withText = normalizeTrace('kiro', [
    kiroCall('c1', 'execute', {}),
    kiroUpdate('c1', 'failed', { error: 'denied' }),
  ]);
  assert.equal(withText.errors[0].message, 'denied');
  assert.equal(withText.errors.length, 1, 'one entry per update, not two');
});

test('kiro a later in_progress update does not downgrade a completed call', () => {
  const record = normalizeTrace('kiro', [
    kiroCall('c1', 'execute', {}),
    kiroUpdate('c1', 'completed', { result: 'done' }),
    kiroUpdate('c1', 'in_progress'),
  ]);
  assert.equal(record.tool_calls[0].status, 'completed');
  assert.equal(record.tool_calls[0].result, 'done');
});

test('kiro id 0 pairs a call with its update', () => {
  const record = normalizeTrace('kiro', [
    { type: 'tool_call', tool_call_id: 0, tool_name: 'fsRead', arguments: { path: SKILL_PATH } },
    { type: 'tool_call_update', tool_call_id: 0, status: 'completed', result: 'ok' },
  ]);
  assert.equal(record.tool_calls[0].status, 'completed');
  assert.equal(record.tool_calls[0].result, 'ok');
  assert.equal(record.skill_loads.length, 1);
});

test('kiro a duplicate tool id adds an error and does not overwrite the first call', () => {
  const record = normalizeTrace('kiro', [
    kiroCall('dup', 'fsRead', { path: 'first.txt' }),
    kiroCall('dup', 'fsRead', { path: 'second.txt' }),
    kiroUpdate('dup', 'completed', { result: 'for the first' }),
  ]);
  assert.equal(record.errors.filter((e) => e.type === 'duplicate_tool_id').length, 1);
  assert.equal(record.tool_calls.length, 2);
  assert.equal(record.tool_calls[0].status, 'completed');
  assert.equal(record.tool_calls[0].result, 'for the first');
  assert.equal(record.tool_calls[1].status, 'unknown');
  assert.equal(record.tool_calls[1].result, null);
});

test('claude-code a duplicate tool_use id adds an error and keeps the first pairing', () => {
  const record = normalizeTrace('claude-code', [
    claudeCall('dup', 'Read', { path: 'a' }),
    claudeCall('dup', 'Read', { path: 'b' }),
    claudeResult('dup', 'for the first'),
  ]);
  assert.equal(record.errors.filter((e) => e.type === 'duplicate_tool_id').length, 1);
  assert.equal(record.tool_calls[0].result, 'for the first');
  assert.equal(record.tool_calls[1].result, null);
});

test('claude-code a terminal status is final: error then ok stays error and is not a skill load', () => {
  const record = normalizeTrace('claude-code', [
    claudeCall('t1', 'Skill', { skill: 'backend-review' }),
    claudeResult('t1', 'denied', true),
    claudeResult('t1', 'late success'),
  ]);
  const [call] = record.tool_calls;
  assert.equal(call.status, 'error');
  assert.equal(call.result, 'denied');
  assert.deepEqual(record.skill_loads, []);
  assert.deepEqual(
    record.errors.map((e) => e.type),
    ['tool_error', 'conflicting_tool_result'],
  );
  assert.equal(record.errors[1].line, 3);
});

test('claude-code a terminal status is final: ok then error stays completed', () => {
  const record = normalizeTrace('claude-code', [
    claudeCall('t1', 'Skill', { skill: 'backend-review' }),
    claudeResult('t1', 'loaded'),
    claudeResult('t1', 'late failure', true),
  ]);
  const [call] = record.tool_calls;
  assert.equal(call.status, 'completed');
  assert.equal(call.result, 'loaded');
  assert.equal(record.skill_loads.length, 1);
  assert.deepEqual(
    record.errors.map((e) => e.type),
    ['conflicting_tool_result'],
    'the ignored failure adds a conflict entry, not a tool_error',
  );
});

test('claude-code the first tool result is kept; a repeat of the same outcome changes nothing', () => {
  const record = normalizeTrace('claude-code', [
    claudeCall('t1', 'Read', { path: 'a' }),
    claudeResult('t1', 'first'),
    claudeResult('t1', 'second'),
    claudeCall('t2', 'Read', { path: 'b' }),
    claudeResult('t2', 'boom one', true),
    claudeResult('t2', 'boom two', true),
  ]);
  assert.equal(record.tool_calls[0].result, 'first');
  assert.equal(record.tool_calls[1].result, 'boom one');
  assert.deepEqual(
    record.errors.map((e) => e.type),
    ['tool_error'],
    'one tool_error for the first failure; the repeats add nothing',
  );
});

test('kiro a conflicting later status adds conflicting_tool_result and keeps the first result', () => {
  const record = normalizeTrace('kiro', [
    kiroCall('c1', 'execute', {}),
    kiroUpdate('c1', 'completed', { result: 'done' }),
    kiroUpdate('c1', 'failed', { error: 'late failure', result: 'late' }),
  ]);
  assert.equal(record.tool_calls[0].status, 'completed');
  assert.equal(record.tool_calls[0].result, 'done');
  assert.deepEqual(
    record.errors.map((e) => e.type),
    ['conflicting_tool_result'],
  );
});

test('kiro model id comes only from the dedicated model event', () => {
  const record = normalizeTrace('kiro', [
    { type: 'agent_message_chunk', content: 'hi', model: 'not-the-model' },
    { type: 'tool_call', tool_call_id: 'c1', tool_name: 'x', arguments: {}, model: 'also-not' },
    { type: 'metadata', model: 'still-not' },
  ]);
  assert.equal(record.model_id, null);
});

test('kiro a conflicting second model value keeps the first and adds an error; a repeat does not', () => {
  const same = normalizeTrace('kiro', [
    { type: 'model', model: 'model-1' },
    { type: 'model', model: 'model-1' },
  ]);
  assert.equal(same.model_id, 'model-1');
  assert.equal(same.errors.length, 0);

  const conflict = normalizeTrace('kiro', [
    { type: 'model', model: 'model-1' },
    { type: 'model', model: 'model-2' },
  ]);
  assert.equal(conflict.model_id, 'model-1');
  assert.deepEqual(
    conflict.errors.map((e) => e.type),
    ['model_conflict'],
  );
});

// --- expectedCallCount and assessDegraded ------------------------------------------------------

test('expectedCallCount that is not a non-negative integer is ignored with an invalid_option error', () => {
  for (const runtime of ['claude-code', 'opencode', 'kiro']) {
    for (const bad of [-1, 1.5, '3', NaN, Infinity, {}, true]) {
      const record = normalizeTrace(runtime, '', { expectedCallCount: bad });
      assert.equal(record.degraded, false, `${runtime} ${String(bad)}`);
      assert.deepEqual(
        record.errors.map((e) => e.type),
        ['invalid_option'],
        `${runtime} ${String(bad)}`,
      );
    }
  }
});

test('expectedCallCount undefined, null or a valid integer adds no error', () => {
  for (const good of [undefined, null, 0, 1, 7]) {
    const record = normalizeTrace('claude-code', '', { expectedCallCount: good });
    assert.deepEqual(record.errors, [], String(good));
  }
});

test('assessDegraded: a missing or invalid expectation never flags degraded', () => {
  assert.deepEqual(assessDegraded([], undefined), { degraded: false, reason: null });
  assert.deepEqual(assessDegraded([{ tool_name: 'read' }], null), { degraded: false, reason: null });
  assert.deepEqual(assessDegraded([], -2), { degraded: false, reason: null });
  assert.deepEqual(assessDegraded([], 2.5), { degraded: false, reason: null });
  assert.deepEqual(assessDegraded([], '4'), { degraded: false, reason: null });
});

test('assessDegraded: an expectation of 0 never flags degraded', () => {
  assert.deepEqual(assessDegraded([], 0), { degraded: false, reason: null });
});

test('assessDegraded: the 0-of-N message includes N', () => {
  const one = assessDegraded([], 1);
  assert.equal(one.degraded, true);
  assert.match(one.reason, /expected at least 1/);
  const five = assessDegraded([], 5);
  assert.equal(five.degraded, true);
  assert.match(five.reason, /expects 5\b/);
});

test('assessDegraded: fewer than half of expected is degraded; half or more is not', () => {
  assert.equal(assessDegraded([{}], 3).degraded, true); // 1 < 1.5
  assert.equal(assessDegraded([{}, {}], 4).degraded, false); // 2 == 4/2, not "fewer than"
  assert.equal(assessDegraded([{}, {}], 2).degraded, false);
});

// --- Kiro: status handling and read-tool matching ---------------------------------------------

test('kiro an update with content and no status leaves the call unknown and records no skill load', () => {
  const record = normalizeTrace('kiro', [
    kiroCall('c1', 'fsRead', { path: SKILL_PATH }),
    { type: 'tool_call_update', tool_call_id: 'c1', content: 'partial output' },
  ]);
  assert.equal(record.tool_calls[0].status, 'unknown');
  assert.deepEqual(record.skill_loads, []);
  assert.deepEqual(record.errors, []);
});

test('kiro an update with no status and an error field marks the call as error', () => {
  const record = normalizeTrace('kiro', [
    kiroCall('c1', 'execute', {}),
    { type: 'tool_call_update', tool_call_id: 'c1', error: 'denied' },
  ]);
  assert.equal(record.tool_calls[0].status, 'error');
  assert.equal(record.errors.length, 1);
});

test('kiro an error field on an in_progress update marks the call as error and is not a skill load', () => {
  const record = normalizeTrace('kiro', [
    kiroCall('c1', 'fsRead', { path: SKILL_PATH }),
    kiroUpdate('c1', 'in_progress', { error: 'boom' }),
    kiroUpdate('c1', 'completed', { result: 'late output' }),
  ]);
  assert.equal(record.tool_calls[0].status, 'error');
  assert.deepEqual(
    record.errors.map((e) => e.type),
    ['tool_error', 'conflicting_tool_result'],
    'the error field is the tool_error; the late completed only conflicts',
  );
  assert.equal(record.errors[0].message, 'boom');
  assert.deepEqual(record.skill_loads, [], 'a call that failed is not a load');
});

test('kiro an update that reports completed but carries an error field marks the call as error', () => {
  const record = normalizeTrace('kiro', [
    kiroCall('c1', 'fsRead', { path: SKILL_PATH }),
    kiroUpdate('c1', 'completed', { error: 'boom', result: 'partial' }),
  ]);
  assert.equal(record.tool_calls[0].status, 'error');
  assert.deepEqual(
    record.errors.map((e) => e.type),
    ['tool_error'],
    'one tool_error and no conflicting_tool_result',
  );
  assert.equal(record.errors[0].message, 'boom');
  assert.deepEqual(record.skill_loads, [], 'a call that failed is not a load');
});

test('kiro a terminal status is final: failed then completed stays error', () => {
  const record = normalizeTrace('kiro', [
    kiroCall('c1', 'fsRead', { path: SKILL_PATH }),
    kiroUpdate('c1', 'failed', { error: 'no such file' }),
    kiroUpdate('c1', 'completed', { result: 'late output' }),
  ]);
  assert.equal(record.tool_calls[0].status, 'error');
  assert.deepEqual(record.skill_loads, [], 'a call that failed is not a load');
});

test('kiro a terminal status is final: completed then failed stays completed', () => {
  const record = normalizeTrace('kiro', [
    kiroCall('c1', 'execute', {}),
    kiroUpdate('c1', 'completed'),
    kiroUpdate('c1', 'failed'),
    kiroUpdate('c1', 'error'),
  ]);
  assert.equal(record.tool_calls[0].status, 'completed');
});

test('kiro read tools are matched on the reported name, so namespaced names do not count as reads', () => {
  const record = normalizeTrace('kiro', [
    kiroCall('c1', 'mcp__x__fs_read', { path: SKILL_PATH }),
    kiroUpdate('c1', 'completed'),
    kiroCall('c2', 'plugin:s:fsRead', { path: SKILL_PATH }),
    kiroUpdate('c2', 'completed'),
    kiroCall('c3', 'FsRead', { path: SKILL_PATH }),
    kiroUpdate('c3', 'completed'),
  ]);
  assert.deepEqual(record.skill_loads, []);
  assert.equal(record.tool_calls.length, 3, 'the calls are still recorded');
  assert.deepEqual(
    record.tool_calls.map((c) => c.raw_tool_name),
    ['mcp__x__fs_read', 'plugin:s:fsRead', 'FsRead'],
  );
});

// --- Redaction and caps on every stored string -------------------------------------------------

test('object keys in stored arguments and results are redacted', () => {
  const keyed = { [FAKE_ACCESS_KEY_ID]: 'value', nested: { [`${SECRET_FIELD}=${FAKE_TOKEN}`]: 1 } };
  const record = normalizeTrace('claude-code', [claudeCall('t1', 'Read', keyed), claudeResult('t1', keyed)]);
  const serialized = JSON.stringify(record.tool_calls);
  assert.ok(!serialized.includes(FAKE_ACCESS_KEY_ID), 'a credential-shaped key must not be stored');
  assert.ok(!serialized.includes(FAKE_TOKEN));
  assert.ok('[REDACTED_AWS_KEY_ID]' in record.tool_calls[0].arguments);
});

// --- Secrets held in object properties ---------------------------------------------------------

// A parsed object has no `name=value` text for the text rules to match, so the value under a
// secret-named property is masked by the property name.
const SECRET_PROPERTY_NAMES = [
  'SecretAccessKey',
  'secretaccesskey',
  'secret_access_key',
  'aws_secret_access_key',
  'AWS_SECRET_ACCESS_KEY',
  'SessionToken',
  'sessiontoken',
  'session_token',
  'aws_session_token',
  'AWS_SESSION_TOKEN',
];

/** One tool call per runtime whose arguments and result are both `value`. */
const recordsStoring = (value) => [
  normalizeTrace('claude-code', [claudeCall('t1', 'Read', value), claudeResult('t1', value)]),
  normalizeTrace('opencode', [
    { type: 'tool_use', part: { tool: 'read', state: { status: 'completed', input: value, output: value } } },
  ]),
  normalizeTrace('kiro', [kiroCall('c1', 'read', value), kiroUpdate('c1', 'completed', { result: value })]),
];

test('a string under a secret-named property is masked in arguments and results in every runtime', () => {
  for (const name of SECRET_PROPERTY_NAMES) {
    for (const record of recordsStoring({ [name]: FAKE_TOKEN, path: 'a.md' })) {
      const [call] = record.tool_calls;
      assert.deepEqual(call.arguments, { [name]: '[REDACTED]', path: 'a.md' }, `${record.runtime} ${name} arguments`);
      assert.deepEqual(call.result, { [name]: '[REDACTED]', path: 'a.md' }, `${record.runtime} ${name} result`);
      assert.equal(call.truncated, false, `${record.runtime} ${name} must not look truncated`);
      assert.ok(!JSON.stringify(record).includes(FAKE_TOKEN), `${record.runtime} ${name} leaked the value`);
    }
  }
});

test('secret-named properties are masked at any depth, in arrays and below a secret-named property', () => {
  const value = {
    Credentials: {
      AccessKeyId: FAKE_ACCESS_KEY_ID,
      SecretAccessKey: FAKE_TOKEN,
      SessionToken: `${FAKE_TOKEN}_b`,
      Expiration: 'later today',
    },
    list: [{ [SESSION_FIELD]: `${FAKE_TOKEN}_c` }, [{ SecretAccessKey: `${FAKE_TOKEN}_d` }]],
    [SECRET_FIELD]: [`${FAKE_TOKEN}_e`, { inner: `${FAKE_TOKEN}_f` }],
    path: 'a.md',
  };
  const expected = {
    Credentials: {
      AccessKeyId: '[REDACTED_AWS_KEY_ID]',
      SecretAccessKey: '[REDACTED]',
      SessionToken: '[REDACTED]',
      Expiration: 'later today',
    },
    list: [{ [SESSION_FIELD]: '[REDACTED]' }, [{ SecretAccessKey: '[REDACTED]' }]],
    [SECRET_FIELD]: ['[REDACTED]', { inner: '[REDACTED]' }],
    path: 'a.md',
  };
  for (const record of recordsStoring(value)) {
    const [call] = record.tool_calls;
    assert.deepEqual(call.arguments, expected, `${record.runtime} arguments`);
    assert.deepEqual(call.result, expected, `${record.runtime} result`);
    assert.equal(call.truncated, false, record.runtime);
    assert.ok(!JSON.stringify(record).includes(FAKE_TOKEN), `${record.runtime} leaked a value`);
  }
});

test('secret-named properties keep non-string values, and other properties keep their strings', () => {
  const kept = { SessionToken: null, SecretAccessKey: 12, aws_session_token: true, sessiontoken: {} };
  for (const record of recordsStoring(kept)) {
    assert.deepEqual(record.tool_calls[0].arguments, kept, record.runtime);
  }
  const similar = { session_token_count: 'three', session_tokens: 'four', secret_access_key_id: 'five', note: 'plain' };
  for (const record of recordsStoring(similar)) {
    const [call] = record.tool_calls;
    assert.deepEqual(call.arguments, similar, `${record.runtime} arguments`);
    assert.deepEqual(call.result, similar, `${record.runtime} result`);
    assert.equal(call.truncated, false, record.runtime);
  }
});

test('a huge value under a secret-named property is replaced by the short mask and is not truncation', () => {
  const [record] = recordsStoring({ SessionToken: 'x'.repeat(MAX_STORED_STRING * 2), path: 'a.md' });
  assert.deepEqual(record.tool_calls[0].arguments, { SessionToken: '[REDACTED]', path: 'a.md' });
  assert.equal(record.tool_calls[0].truncated, false);
});

test('the property rule and the text rule agree on which field names are secret', () => {
  for (const name of SECRET_PROPERTY_NAMES) {
    assert.ok(!defaultRedact(`${name}=${FAKE_TOKEN}`).includes(FAKE_TOKEN), `text rule misses ${name}`);
    const [record] = recordsStoring({ [name]: FAKE_TOKEN });
    assert.ok(!JSON.stringify(record).includes(FAKE_TOKEN), `property rule misses ${name}`);
  }
});

test('a cyclic value is stored without looping, and the secrets in it are still masked', () => {
  const loop = { SecretAccessKey: FAKE_TOKEN, keep: 'ok' };
  loop.self = loop;
  loop.list = [loop, { [SESSION_FIELD]: FAKE_TOKEN }];
  let records;
  assert.doesNotThrow(() => {
    records = recordsStoring(loop);
  });
  for (const record of records) {
    const [call] = record.tool_calls;
    assert.equal(call.arguments.SecretAccessKey, '[REDACTED]', record.runtime);
    assert.equal(call.arguments.keep, 'ok', record.runtime);
    assert.equal(call.truncated, true, `${record.runtime}: the cycle is cut at the depth or node limit`);
    assert.ok(!JSON.stringify(record).includes(FAKE_TOKEN), `${record.runtime} leaked a value`);
  }
});

test('the property rule also applies with a custom redactor, which never sees the masked value', () => {
  const seen = [];
  const recording = (text) => {
    seen.push(text);
    return text;
  };
  const value = { SecretAccessKey: FAKE_TOKEN, nested: { aws_session_token: FAKE_TOKEN }, path: 'a.md' };
  const record = normalizeTrace('claude-code', [claudeCall('t1', 'Read', value)], { redact: recording });
  assert.deepEqual(record.tool_calls[0].arguments, {
    SecretAccessKey: '[REDACTED]',
    nested: { aws_session_token: '[REDACTED]' },
    path: 'a.md',
  });
  assert.equal(record.tool_calls[0].truncated, false);
  assert.ok(!seen.includes(FAKE_TOKEN), 'the custom redactor was not handed the secret value');

  for (const failing of [
    () => {
      throw new Error('boom');
    },
    () => 123,
  ]) {
    const failed = normalizeTrace('claude-code', [claudeCall('t1', 'Read', { SecretAccessKey: FAKE_TOKEN })], {
      redact: failing,
    });
    assert.ok(!JSON.stringify(failed).includes(FAKE_TOKEN));
    assert.deepEqual(failed.tool_calls[0].arguments, { '[REDACTION_FAILED]': '[REDACTED]' });
  }
});

test('a huge object key is capped and counts toward the 8 KB budget', () => {
  const huge = 'k'.repeat(MAX_STORED_STRING * 3);
  const record = normalizeTrace('claude-code', [
    claudeCall('t1', 'Write', { [huge]: 'v', after: 'w' }),
    claudeResult('t1', { [huge]: 'v' }),
  ]);
  const call = record.tool_calls[0];
  const storedLength = (value) => Object.entries(value).reduce((sum, [k, v]) => sum + k.length + String(v).length, 0);
  assert.ok(storedLength(call.arguments) <= MAX_STORED_STRING);
  assert.ok(storedLength(call.result) <= MAX_STORED_STRING);
  assert.ok(JSON.stringify(call).length < MAX_STORED_STRING * 3, 'the record stays far smaller than the input key');
  assert.equal(call.truncated, true);
});

test('many small object keys together stay within the 8 KB budget', () => {
  const many = {};
  for (let i = 0; i < 1000; i++) many[`key_${String(i).padStart(4, '0')}_${'x'.repeat(40)}`] = i;
  const record = normalizeTrace('claude-code', [claudeCall('t1', 'Write', many)]);
  const keys = Object.keys(record.tool_calls[0].arguments);
  assert.ok(keys.join('').length <= MAX_STORED_STRING);
  assert.ok(keys.length < 1000);
  assert.equal(record.tool_calls[0].truncated, true);
});

// These match MAX_STORED_NODES and MAX_STORED_DEPTH in lib/trace-normalizer.js, which are not
// exported. The tests reach the limits through normalizeTrace.
const STORED_NODE_LIMIT = 2000;
const STORED_DEPTH_LIMIT = 16;

/** `levels` nested objects: the root is depth 0, so `leaf` sits at depth `levels`. */
const nestedObjects = (levels, leaf) => {
  let value = leaf;
  for (let i = 0; i < levels; i++) value = { next: value };
  return value;
};

const storedResult = (value) => {
  const record = normalizeTrace('claude-code', [claudeCall('t1', 'Read', {}), claudeResult('t1', value)]);
  return record.tool_calls[0];
};

test('a stored value nested deeper than the depth limit is cut at that depth and marked truncated', () => {
  const atLimit = nestedObjects(STORED_DEPTH_LIMIT, 'bottom');
  const whole = storedResult(atLimit);
  assert.deepEqual(whole.result, atLimit, 'a leaf at exactly the depth limit is kept');
  assert.equal(whole.truncated, false);

  const cutAtLimit = nestedObjects(STORED_DEPTH_LIMIT + 1, null);
  const oneOver = storedResult(nestedObjects(STORED_DEPTH_LIMIT + 1, 'bottom'));
  assert.deepEqual(oneOver.result, cutAtLimit, 'a leaf one level past the limit is dropped');
  assert.equal(oneOver.truncated, true);

  const farOver = storedResult(nestedObjects(STORED_DEPTH_LIMIT + 10, 'bottom'));
  assert.deepEqual(farOver.result, cutAtLimit, 'everything below the limit is dropped, not just the leaf');
  assert.equal(farOver.truncated, true);
});

test('a stored value with more nodes than the node limit keeps at most that many and is marked truncated', () => {
  // The array itself is one node, so it holds STORED_NODE_LIMIT - 1 numbers at the limit.
  const numbers = (count) => Array.from({ length: count }, (_, i) => i + 1);
  const kept = (call) => call.result.filter((item) => item !== null);

  const atLimit = storedResult(numbers(STORED_NODE_LIMIT - 1));
  assert.deepEqual(atLimit.result, numbers(STORED_NODE_LIMIT - 1), 'a value at exactly the node limit is kept');
  assert.equal(atLimit.truncated, false);

  const oneOver = storedResult(numbers(STORED_NODE_LIMIT));
  assert.equal(kept(oneOver).length, STORED_NODE_LIMIT - 1, 'the one node past the limit is dropped');
  assert.equal(oneOver.truncated, true);

  const farOver = storedResult(numbers(STORED_NODE_LIMIT * 3));
  assert.equal(kept(farOver).length, STORED_NODE_LIMIT - 1, 'the stored count stops at the limit');
  assert.ok(farOver.result.length < STORED_NODE_LIMIT * 3);
  assert.equal(farOver.truncated, true);
});

test('a Kiro skill path with a huge or credential-shaped skill name is capped and redacted', () => {
  const huge = normalizeTrace('kiro', [
    kiroCall('c1', 'fsRead', { path: `/home/dev/skills/${'a'.repeat(MAX_STORED_STRING * 2)}/SKILL.md` }),
    kiroUpdate('c1', 'completed'),
  ]);
  assert.equal(huge.skill_loads.length, 1);
  assert.ok(huge.skill_loads[0].skill_name.length <= MAX_STORED_STRING);
  assert.ok(huge.skill_loads[0].raw_path.length <= MAX_STORED_STRING);

  const secret = normalizeTrace('kiro', [
    kiroCall('c1', 'fsRead', { path: `/home/dev/skills/${FAKE_ACCESS_KEY_ID}/SKILL.md` }),
    kiroUpdate('c1', 'completed'),
  ]);
  assert.equal(secret.skill_loads[0].skill_name, '[REDACTED_AWS_KEY_ID]');
  assert.ok(!JSON.stringify(secret).includes(FAKE_ACCESS_KEY_ID));
});

test('a huge or credential-shaped tool name is redacted and capped in every runtime', () => {
  const huge = 'T'.repeat(MAX_STORED_STRING * 2);
  const named = `tool_${FAKE_ACCESS_KEY_ID}`;
  const records = [
    normalizeTrace('claude-code', [claudeCall('t1', huge, {}), claudeCall('t2', named, {})]),
    normalizeTrace('opencode', [openCodeTool(huge, 'completed'), openCodeTool(named, 'completed')]),
    normalizeTrace('kiro', [kiroCall('c1', huge, {}), kiroCall('c2', named, {})]),
  ];
  for (const record of records) {
    const [hugeCall, namedCall] = record.tool_calls;
    assert.ok(hugeCall.raw_tool_name.length <= MAX_STORED_STRING, `${record.runtime} raw_tool_name`);
    assert.ok(hugeCall.tool_name.length <= MAX_STORED_STRING, `${record.runtime} tool_name`);
    assert.ok(!JSON.stringify(namedCall).includes(FAKE_ACCESS_KEY_ID), `${record.runtime} leaked a key id`);
    assert.ok(!JSON.stringify(record.errors).includes(FAKE_ACCESS_KEY_ID), `${record.runtime} leaked in errors`);
  }
});

test('errors[].raw.event_type is redacted, capped at 64 characters, and null when the type is not a string', () => {
  const second = (type) => normalizeTrace('opencode', [openCodeText('a', 'ses_one'), { type, sessionID: 'ses_two' }]);

  const long = second('E'.repeat(1000)).errors[0];
  assert.equal(long.type, 'multiple_sessions');
  assert.equal(long.raw.event_type.length, 64);

  const secret = second(FAKE_ACCESS_KEY_ID).errors[0];
  assert.equal(secret.raw.event_type, '[REDACTED_AWS_KEY_ID]');

  assert.equal(second({ nested: true }).errors[0].raw.event_type, null);
  assert.equal(second('text').errors[0].raw.event_type, 'text', 'a short ordinary type is stored as is');
});

test('model_id is redacted and capped in every runtime that reports one', () => {
  const huge = 'm'.repeat(MAX_STORED_STRING * 2);
  const claude = normalizeTrace('claude-code', [
    { type: 'assistant', message: { model: huge, content: [] } },
    claudeDone({ model: `model-${FAKE_ACCESS_KEY_ID}` }),
  ]);
  assert.equal(claude.model_id, 'model-[REDACTED_AWS_KEY_ID]');
  const claudeHuge = normalizeTrace('claude-code', [{ type: 'assistant', message: { model: huge, content: [] } }]);
  assert.equal(claudeHuge.model_id.length, MAX_STORED_STRING);

  const kiro = normalizeTrace('kiro', [{ type: 'model', model: `model-${FAKE_ACCESS_KEY_ID}` }]);
  assert.equal(kiro.model_id, 'model-[REDACTED_AWS_KEY_ID]');
  const kiroHuge = normalizeTrace('kiro', [
    { type: 'model', model: huge },
    { type: 'model', model: huge },
  ]);
  assert.equal(kiroHuge.model_id.length, MAX_STORED_STRING);
  assert.deepEqual(kiroHuge.errors, [], 'the same model reported twice is not a conflict');
});

test('opencode session_ids are redacted and capped', () => {
  const record = normalizeTrace('opencode', [
    openCodeText('a', FAKE_ACCESS_KEY_ID),
    openCodeText('b', 's'.repeat(MAX_STORED_STRING * 2)),
  ]);
  assert.equal(record.session_ids[0], '[REDACTED_AWS_KEY_ID]');
  assert.equal(record.session_ids[1].length, MAX_STORED_STRING);
});

test('claude-code available_tools entries are redacted and capped', () => {
  const record = normalizeTrace('claude-code', [
    {
      type: 'system',
      subtype: 'init',
      tools: ['Read', FAKE_ACCESS_KEY_ID, 'x'.repeat(MAX_STORED_STRING * 2), 7, null],
    },
  ]);
  assert.equal(record.available_tools.length, 3, 'non-string entries are dropped');
  assert.deepEqual(record.available_tools.slice(0, 2), ['Read', '[REDACTED_AWS_KEY_ID]']);
  assert.equal(record.available_tools[2].length, MAX_STORED_STRING);
});

test('claude-code available_tools is cut at the entry limit and an error says so', () => {
  const limit = normalizer.MAX_AVAILABLE_TOOLS;
  const tools = (n) => Array.from({ length: n }, (_, i) => `tool_${i}`);

  const exact = normalizeTrace('claude-code', [{ type: 'system', subtype: 'init', tools: tools(limit) }]);
  assert.equal(exact.available_tools.length, limit);
  assert.deepEqual(exact.errors, []);

  const over = normalizeTrace('claude-code', [{ type: 'system', subtype: 'init', tools: tools(limit + 88) }]);
  assert.equal(over.available_tools.length, limit);
  assert.equal(over.available_tools[limit - 1], `tool_${limit - 1}`);
  assert.deepEqual(
    over.errors.map((e) => [e.type, e.line]),
    [['available_tools_truncated', 1]],
  );
  assert.match(over.errors[0].message, new RegExp(String(limit + 88)));
});

test('response_text is redacted in every runtime but never truncated', () => {
  const long = 'word '.repeat(MAX_STORED_STRING);
  const secret = `Authorization: Bearer ${FAKE_TOKEN} and ${FAKE_ACCESS_KEY_ID}`;
  const answer = `${long}${secret}`;
  const records = [
    normalizeTrace('claude-code', [claudeDone({ result: answer })]),
    normalizeTrace('claude-code', [{ type: 'assistant', message: { content: [{ type: 'text', text: answer }] } }]),
    normalizeTrace('opencode', [openCodeText(answer)]),
    normalizeTrace('kiro', [{ type: 'agent_message_chunk', content: answer }]),
  ];
  for (const record of records) {
    assert.ok(!record.response_text.includes(FAKE_TOKEN), `${record.runtime} leaked a token`);
    assert.ok(!record.response_text.includes(FAKE_ACCESS_KEY_ID), `${record.runtime} leaked a key id`);
    assert.ok(record.response_text.startsWith(long), `${record.runtime} cut the answer`);
    assert.ok(record.response_text.length > MAX_STORED_STRING * 4);
    assert.match(record.response_text, /Bearer \[REDACTED\]/);
  }
});

test('response_text redaction sees a secret split across streamed chunks and text blocks', () => {
  const kiro = normalizeTrace('kiro', [
    { type: 'agent_message_chunk', content: 'Authorization: Bearer ' },
    { type: 'agent_message_chunk', content: FAKE_TOKEN },
  ]);
  assert.ok(!kiro.response_text.includes(FAKE_TOKEN));
  const claude = normalizeTrace('claude-code', [
    {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Authorization: Bearer ' },
          { type: 'text', text: FAKE_TOKEN },
        ],
      },
    },
  ]);
  assert.ok(!claude.response_text.includes(FAKE_TOKEN));
});

test('options.redact also applies to response_text, and an empty answer stays empty', () => {
  const redact = (s) => s.replace(/CUSTOM_SECRET/g, '[X]');
  const record = normalizeTrace('kiro', [{ type: 'agent_message_chunk', content: 'a CUSTOM_SECRET b' }], { redact });
  assert.equal(record.response_text, 'a [X] b');
  const throwing = () => {
    throw new Error('boom');
  };
  assert.equal(normalizeTrace('kiro', '', { redact: throwing }).response_text, '');
  assert.equal(
    normalizeTrace('kiro', [{ type: 'agent_message_chunk', content: 'text' }], { redact: throwing }).response_text,
    '[REDACTION_FAILED]',
  );
});

// --- Overflow, hostile events and subagent results ---------------------------------------------

test('opencode summed cost and tokens that overflow to infinity become null with an invalid_number error', () => {
  const big = { cost: 1e308, tokens: { input: 1e308, output: 5, cache: { read: 1, write: 1 } } };
  const record = normalizeTrace('opencode', jsonl(openCodeFinish('a', big), openCodeFinish('b', big)));
  assert.equal(record.cost_usd, null);
  assert.equal(record.usage.input_tokens, null);
  assert.equal(record.usage.output_tokens, 10, 'a total that did not overflow is kept');
  const messages = record.errors.filter((e) => e.type === 'invalid_number').map((e) => e.message);
  assert.equal(messages.length, 2);
  assert.ok(messages.some((m) => /cost/.test(m)));
  assert.ok(messages.some((m) => /input_tokens/.test(m)));
});

test('opencode a large sum that stays finite is kept', () => {
  const big = { cost: 1e300, tokens: { input: 1e300, output: 1, cache: { read: 1, write: 1 } } };
  const record = normalizeTrace('opencode', jsonl(openCodeFinish('a', big), openCodeFinish('b', big)));
  assert.equal(record.cost_usd, 2e300);
  assert.deepEqual(record.errors, []);
});

test('an event whose type getter throws is recorded as malformed without throwing, in every runtime', () => {
  const hostile = {
    get type() {
      throw new Error('hostile getter');
    },
  };
  for (const runtime of ['claude-code', 'opencode', 'kiro']) {
    let record;
    assert.doesNotThrow(() => {
      record = normalizeTrace(runtime, [hostile, { type: 'error', message: 'after' }]);
    }, runtime);
    const malformed = record.errors.filter((e) => e.type === 'malformed_event');
    assert.equal(malformed.length, 1, runtime);
    assert.equal(malformed[0].line, 1, runtime);
    assert.equal(malformed[0].raw.event_type, null, runtime);
    assert.ok(
      record.errors.some((e) => e.type === 'runtime_error'),
      `${runtime}: later events are still read`,
    );
  }
});

test('claude-code subagent assistant text does not reach response_text', () => {
  const record = normalizeTrace('claude-code', [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'main answer' }] } },
    {
      type: 'assistant',
      parent_tool_use_id: 'toolu_parent',
      message: { content: [{ type: 'text', text: ' subagent chatter' }] },
    },
  ]);
  assert.equal(record.complete, false, 'no top-level result event in this trace');
  assert.equal(record.response_text, 'main answer');
});

test('claude-code subagent text with a non-string text field is still recorded as malformed', () => {
  const record = normalizeTrace('claude-code', [
    { type: 'assistant', parent_tool_use_id: 'toolu_parent', message: { content: [{ type: 'text', text: 5 }] } },
  ]);
  assert.deepEqual(
    record.errors.map((e) => e.type),
    ['malformed_event'],
  );
  assert.equal(record.response_text, '');
});

test('claude-code a subagent result event does not set complete, response_text or model_id', () => {
  const subagentDone = claudeDone({
    parent_tool_use_id: 'toolu_parent',
    result: 'subagent answer',
    model: 'sub-model',
    total_cost_usd: 9,
  });
  const trace = [
    { type: 'assistant', message: { model: 'main-model', content: [{ type: 'text', text: 'main answer' }] } },
    subagentDone,
  ];
  const partial = normalizeTrace('claude-code', trace);
  assert.equal(partial.complete, false);
  assert.equal(partial.response_text, 'main answer');
  assert.equal(partial.model_id, 'main-model');
  assert.equal(partial.usage, null);
  assert.equal(partial.cost_usd, null);

  const full = normalizeTrace('claude-code', [...trace, claudeDone({ result: 'final answer', model: 'final-model' })]);
  assert.equal(full.complete, true);
  assert.equal(full.response_text, 'final answer');
  assert.equal(full.model_id, 'final-model');
  assert.equal(full.cost_usd, 0.01, 'the subagent cost does not leak into the total');
});

// --- Shared helpers ----------------------------------------------------------------------------

test('normalizeToolName collapses mcp__<server>__<tool> and plugin:server:tool__subtool forms', () => {
  assert.equal(normalizeToolName('mcp__example__LoadSkill'), 'loadskill');
  assert.equal(normalizeToolName('plugin:myserver:mytool__subtool'), 'subtool');
  assert.equal(normalizeToolName('Read'), 'read');
  assert.equal(normalizeToolName(''), '');
});

test('normalizeToolName returns an empty string for non-string input', () => {
  for (const value of [null, undefined, 5, {}, []]) {
    assert.equal(normalizeToolName(value), '');
  }
});

test('skillLoadFromPath matches a SKILL.md path and extracts the skill name', () => {
  assert.deepEqual(skillLoadFromPath(SKILL_PATH), {
    skill_name: 'backend-review',
    source: 'path-heuristic',
    raw_path: SKILL_PATH,
  });
  assert.equal(skillLoadFromPath('src/index.ts'), null);
  assert.equal(skillLoadFromPath(42), null);
  assert.equal(skillLoadFromPath(undefined), null);
});

// --- tool_call_id ------------------------------------------------------------------------------

test('claude-code tool_call_id is the tool_use id and pairs each call with its own result', () => {
  const record = normalizeTrace(
    'claude-code',
    jsonl(
      claudeCall('toolu_a', 'Read', { path: 'a.md' }),
      claudeCall('toolu_b', 'Read', { path: 'b.md' }),
      // Results arrive out of order, so the id is what ties a result to its call.
      claudeResult('toolu_b', 'content of b'),
      claudeResult('toolu_a', 'content of a'),
    ),
  );
  assert.deepEqual(
    record.tool_calls.map((c) => [c.tool_call_id, c.arguments.path, c.result]),
    [
      ['toolu_a', 'a.md', 'content of a'],
      ['toolu_b', 'b.md', 'content of b'],
    ],
  );
});

test('claude-code tool_call_id is also kept for a subagent call and for a call with no result yet', () => {
  const record = normalizeTrace(
    'claude-code',
    jsonl(claudeCall('toolu_sub', 'Read', {}, { parent_tool_use_id: 'toolu_parent' }), claudeCall('toolu_open', 'Read', {})),
  );
  assert.equal(record.tool_calls[0].subagent, true);
  assert.deepEqual(
    record.tool_calls.map((c) => c.tool_call_id),
    ['toolu_sub', 'toolu_open'],
  );
});

test('claude-code tool_call_id is null when the tool_use has no usable id, and a numeric id is stringified', () => {
  const noId = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: {} }] } };
  const record = normalizeTrace(
    'claude-code',
    jsonl(
      noId,
      claudeCall('', 'Read', {}),
      claudeCall(null, 'Read', {}),
      claudeCall({ nested: 1 }, 'Read', {}),
      claudeCall(0, 'Read', {}),
    ),
  );
  assert.deepEqual(
    record.tool_calls.map((c) => c.tool_call_id),
    [null, null, null, null, '0'],
  );
  assert.deepEqual(record.errors, []);
});

test('opencode tool_call_id is the part callID, falling back to the part id, and is null when neither exists', () => {
  const record = normalizeTrace(
    'opencode',
    jsonl(
      openCodeTool('read', 'completed', { callID: 'call_oc_1', id: 'prt_oc_1' }),
      openCodeTool('read', 'completed', { id: 'tooluse_oc_2' }),
      openCodeTool('read', 'completed'),
      openCodeTool('read', 'completed', { callID: '', id: 'prt_oc_4' }),
      openCodeTool('read', 'completed', { callID: { bad: true } }),
    ),
  );
  assert.deepEqual(
    record.tool_calls.map((c) => c.tool_call_id),
    ['call_oc_1', 'tooluse_oc_2', null, 'prt_oc_4', null],
  );
});

test('opencode fuses call and result, so tool_call_id sits beside the result it belongs to', () => {
  const record = normalizeTrace('opencode', loadFixture('opencode-happy-path.jsonl'));
  assert.ok(record.tool_calls.length > 0);
  const first = record.tool_calls[0];
  assert.equal(first.tool_call_id, 'tooluse_fixture_1');
  assert.equal(first.status, 'completed');
  assert.notEqual(first.result, null);
});

test('kiro tool_call_id is the tool_call_id, falling back to id, and pairs with its update', () => {
  const record = normalizeTrace(
    'kiro',
    jsonl(
      kiroCall('call_k1', 'fsRead', { path: 'a.md' }),
      { type: 'tool_call', id: 'call_k2', tool_name: 'fsRead', arguments: { path: 'b.md' } },
      { type: 'tool_call', tool_name: 'fsRead', arguments: { path: 'c.md' } },
      kiroCall(0, 'fsRead', { path: 'd.md' }),
      kiroUpdate('call_k2', 'completed', { result: 'content of b' }),
      kiroUpdate('call_k1', 'completed', { result: 'content of a' }),
      kiroUpdate(0, 'completed', { result: 'content of d' }),
    ),
  );
  assert.deepEqual(
    record.tool_calls.map((c) => [c.tool_call_id, c.arguments.path, c.result]),
    [
      ['call_k1', 'a.md', 'content of a'],
      ['call_k2', 'b.md', 'content of b'],
      [null, 'c.md', null],
      ['0', 'd.md', 'content of d'],
    ],
  );
});

test('a duplicate call id is kept on both calls, and the first call keeps the pairing', () => {
  for (const [runtime, trace] of [
    [
      'claude-code',
      jsonl(claudeCall('dup', 'Read', {}), claudeCall('dup', 'Read', {}), claudeResult('dup', 'out')),
    ],
    ['kiro', jsonl(kiroCall('dup', 'fsRead', {}), kiroCall('dup', 'fsRead', {}), kiroUpdate('dup', 'completed', { result: 'out' }))],
  ]) {
    const record = normalizeTrace(runtime, trace);
    assert.deepEqual(
      record.tool_calls.map((c) => [c.tool_call_id, c.result]),
      [
        ['dup', 'out'],
        ['dup', null],
      ],
      runtime,
    );
    assert.equal(record.errors.filter((e) => e.type === 'duplicate_tool_id').length, 1, runtime);
  }
});

test('tool_call_id goes through the redactor and the size cap, and is not hashed or renamed', () => {
  const secretId = `call_${FAKE_ACCESS_KEY_ID}`;
  const traces = {
    'claude-code': jsonl(claudeCall(secretId, 'Read', {})),
    opencode: jsonl(openCodeTool('read', 'completed', { callID: secretId })),
    kiro: jsonl(kiroCall(secretId, 'fsRead', {})),
  };
  for (const [runtime, trace] of Object.entries(traces)) {
    const masked = normalizeTrace(runtime, trace).tool_calls[0].tool_call_id;
    assert.equal(masked, 'call_[REDACTED_AWS_KEY_ID]', runtime);
    const custom = normalizeTrace(runtime, trace, { redact: (s) => s.replace('call_', 'seen_') }).tool_calls[0];
    assert.ok(custom.tool_call_id.startsWith('seen_'), runtime);
    const broken = normalizeTrace(runtime, trace, { redact: () => 42 }).tool_calls[0];
    assert.equal(broken.tool_call_id, '[REDACTION_FAILED]', runtime);
    const long = 'i'.repeat(MAX_STORED_STRING + 50);
    const longTrace = {
      'claude-code': jsonl(claudeCall(long, 'Read', {})),
      opencode: jsonl(openCodeTool('read', 'completed', { callID: long })),
      kiro: jsonl(kiroCall(long, 'fsRead', {})),
    }[runtime];
    assert.equal(normalizeTrace(runtime, longTrace).tool_calls[0].tool_call_id.length, MAX_STORED_STRING, runtime);
  }
  // The raw id is otherwise kept as it was reported.
  assert.equal(normalizeTrace('kiro', jsonl(kiroCall('Call-ID_09.x', 'fsRead', {}))).tool_calls[0].tool_call_id, 'Call-ID_09.x');
});

test('every tool call in every fixture carries tool_call_id as a string or null, and happy paths have ids', () => {
  for (const runtime of ['claude-code', 'opencode', 'kiro']) {
    for (const kind of ['happy-path', 'degraded', 'error', 'no-tool-calls']) {
      const record = normalizeTrace(runtime, loadFixture(`${runtime}-${kind}.jsonl`));
      for (const call of record.tool_calls) {
        assert.ok('tool_call_id' in call, `${runtime}-${kind}: tool_call_id is missing`);
        assert.ok(call.tool_call_id === null || typeof call.tool_call_id === 'string', `${runtime}-${kind}`);
      }
      if (kind === 'happy-path') {
        assert.ok(record.tool_calls.length > 0, runtime);
        assert.ok(record.tool_calls.every((c) => typeof c.tool_call_id === 'string' && c.tool_call_id), runtime);
      }
    }
  }
});

test('adding tool_call_id is additive: schema_version stays 1 and the other call fields are unchanged', () => {
  assert.equal(SCHEMA_VERSION, 1);
  const call = normalizeTrace('kiro', jsonl(kiroCall('c1', 'fsRead', { path: 'a.md' }), kiroUpdate('c1', 'completed', { result: 'ok' })))
    .tool_calls[0];
  assert.deepEqual(Object.keys(call).sort(), [
    'arguments',
    'raw_tool_name',
    'result',
    'status',
    'subagent',
    'tool_call_id',
    'tool_name',
    'truncated',
  ]);
  const { tool_call_id: id, ...rest } = call;
  assert.equal(id, 'c1');
  assert.deepEqual(rest, {
    tool_name: 'fsread',
    raw_tool_name: 'fsRead',
    arguments: { path: 'a.md' },
    status: 'completed',
    result: 'ok',
    truncated: false,
    subagent: false,
  });
});
