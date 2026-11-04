// SPDX-License-Identifier: Apache-2.0
/**
 * Soundness tests for the snapshot loader (findings I-8 and I-7)
 *
 * Each test encodes a concrete attack on the loader as first written: a credential file that was
 * loaded into a snapshot, a file that outgrew its size limit between `stat` and `read`, a limit
 * option that was silently ignored, and a byte change that decoding made invisible.
 *
 * Run: node --test bench/test/snapshot-loader-soundness.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadSnapshot, decodeLossless, sensitiveContentReason, contentDigest } = require('../lib/snapshot-loader');
const { sensitivePathReason } = require('../lib/safe-path');
const { evalCheck } = require('../lib/checks');

/** Creates a temporary tree from `files` (relative path to string or Buffer) and removes it after the test. */
function makeTree(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-loader-soundness-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

/** Replaces `fs[name]` for the rest of the test. */
function patch(t, name, replacement) {
  const original = fs[name];
  fs[name] = replacement;
  t.after(() => {
    fs[name] = original;
  });
}

const FAKE_SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

// --- I-8: sensitive paths ----------------------------------------------------------------------

test('I-8: .env, .aws/credentials and id_rsa are refused and never end up in a snapshot', (t) => {
  const cases = {
    '.env': `API_TOKEN=${FAKE_SECRET}\n`,
    '.aws/credentials': `[default]\naws_secret_access_key = ${FAKE_SECRET}\n`,
    '.ssh/id_rsa': 'private\n',
    id_rsa: 'private\n',
    'deploy/.env.production': `DB_PASSWORD=${FAKE_SECRET}\n`,
    'certs/server.pem': 'x\n',
    'infra/prod.tfvars': 'password = "x"\n',
    '.npmrc': '//registry.npmjs.org/:_authToken=abc\n',
  };
  for (const [relative, content] of Object.entries(cases)) {
    const root = makeTree(t, { 'README.md': 'hello', [relative]: content });
    assert.throws(() => loadSnapshot(root), (error) => {
      assert.match(error.message, new RegExp(`refusing to load ${relative.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), relative);
      assert.ok(!error.message.includes(FAKE_SECRET), 'the error must not echo content');
      return true;
    }, relative);
  }
});

test('I-8: a sensitive file is refused before it is opened, so its content is never read', (t) => {
  const root = makeTree(t, { 'a.txt': 'ok', '.env': 'TOKEN=1\n', '.aws/credentials': 'x' });
  const opened = [];
  const original = fs.openSync;
  patch(t, 'openSync', (...args) => {
    opened.push(String(args[0]));
    return original(...args);
  });
  assert.throws(() => loadSnapshot(root), /refusing to load \.aws\/credentials/);
  assert.equal(opened.some((p) => p.endsWith('.env') || p.endsWith('credentials')), false, opened.join(', '));
});

test('I-8: the name rule ignores case, compatibility forms and trailing dots and spaces', () => {
  for (const name of ['.ENV', '.Aws/Credentials', 'ID_RSA', '\uff49\uff44_rsa', '.env.', '.env ', 'Keys/Server.PEM', '.SSH/config', 'a/.config/gcloud/x.json']) {
    assert.notEqual(sensitivePathReason(name), null, name);
  }
});

test('I-8: public keys and dotenv templates are not sensitive, and ordinary names are not either', () => {
  for (const name of ['id_rsa.pub', '.env.example', '.env.sample', '.env.template', '.env.dist', 'docs/environment.md', 'src/keyboard.js', 'credentials.md', 'README.md', 'identity.txt']) {
    assert.equal(sensitivePathReason(name), null, name);
  }
});

test('I-8: a credential is refused by its content whatever the file is called', (t) => {
  const bodies = {
    'notes.txt': '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n',
    'config.yaml': 'access: AKIAIOSFODNN7EXAMPLE\n',
    'settings.ini': `aws_secret_access_key=${FAKE_SECRET}\n`,
    'ci.md': `token ghp_${'a'.repeat(36)}\n`,
  };
  for (const [relative, content] of Object.entries(bodies)) {
    const root = makeTree(t, { [relative]: content });
    assert.throws(() => loadSnapshot(root), (error) => {
      assert.match(error.message, new RegExp(`refusing to load ${relative.replace('.', '\\.')}: its content holds `));
      assert.ok(!error.message.includes('AKIAIOSFODNN7EXAMPLE') && !error.message.includes(FAKE_SECRET));
      return true;
    }, relative);
  }
  assert.equal(sensitiveContentReason('plain prose with no secrets'), null);
});

test('I-8: allowSensitive admits one exact path and nothing near it', (t) => {
  const root = makeTree(t, { '.env': 'MODE=test\n', '.env.local': 'MODE=local\n', 'a.txt': 'x' });
  assert.throws(() => loadSnapshot(root, { allowSensitive: ['.env'] }), /refusing to load \.env\.local/);
  const loaded = loadSnapshot(root, { allowSensitive: ['.env', '.env.local'] });
  assert.deepEqual(Object.keys(loaded), ['.env', '.env.local', 'a.txt']);
  // A directory prefix is not an exact file path, so it admits nothing under it.
  const nested = makeTree(t, { '.aws/credentials': 'x' });
  assert.throws(() => loadSnapshot(nested, { allowSensitive: ['.aws'] }), /refusing to load \.aws\/credentials/);
  assert.throws(() => loadSnapshot(nested, { allowSensitive: ['.aws/*'] }), /refusing to load \.aws\/credentials/);
});

test('I-8: a fixture that holds a fake key is admitted by pinning its digest', (t) => {
  // Behavior change (C-6): this asserted that listing a bare path skipped the content scan too, which
  // let a real secret written at an allowed path load. A bare path now skips only the name rule; the
  // content scan is skipped only for the bytes the `{ path, sha256 }` pin names.
  const bytes = Buffer.from('access: AKIAIOSFODNN7EXAMPLE\n');
  const root = makeTree(t, { 'fixtures/fake.txt': bytes });
  assert.throws(() => loadSnapshot(root), /its content holds an AWS access key id/);
  assert.throws(() => loadSnapshot(root, { allowSensitive: ['fixtures/fake.txt'] }), /its content holds an AWS access key id/);
  const pinned = { path: 'fixtures/fake.txt', sha256: contentDigest(bytes) };
  assert.deepEqual(Object.keys(loadSnapshot(root, { allowSensitive: [pinned] })), ['fixtures/fake.txt']);
});

// --- I-8: .git ---------------------------------------------------------------------------------

test('I-8: a .git file (worktree or submodule pointer) is not read, like a .git directory', (t) => {
  // Behavior change (I-A): this asserted that no key ended in `.git`. Each skipped entry is now an
  // empty-valued marker, so the keys exist; what the test protects is that the content never loads.
  const root = makeTree(t, {
    '.git': 'gitdir: /Users/someone/work/repo/.git/worktrees/x\n',
    'sub/.git': 'gitdir: ../.git/modules/sub\n',
    'keep.txt': 'k',
    '.GIT': 'gitdir: elsewhere\n',
  });
  const snapshot = loadSnapshot(root);
  assert.deepEqual(Object.keys(snapshot).filter((key) => key !== 'keep.txt' && !/git/i.test(key)), []);
  for (const [key, value] of Object.entries(snapshot)) {
    if (key !== 'keep.txt') assert.equal(value, '', `${key} must be a marker with no content`);
  }
  assert.equal(JSON.stringify(snapshot).includes('/Users/someone'), false);
  assert.equal(JSON.stringify(snapshot).includes('elsewhere'), false);
});

// --- I-8: options -----------------------------------------------------------------------------

test('I-8: an unknown or misspelled option is an error, not a silent default', (t) => {
  const root = makeTree(t, { 'a.txt': 'x' });
  assert.throws(() => loadSnapshot(root, { maxFile: 1 }), /unknown option "maxFile"/);
  assert.throws(() => loadSnapshot(root, { maxTotalByte: 1 }), /unknown option "maxTotalByte"/);
  for (const bad of [null, 'x', 5, [], true]) {
    assert.throws(() => loadSnapshot(root, bad), /options must be a plain object/, String(bad));
  }
  for (const bad of ['.env', ['ok', ''], [1], {}, null]) {
    assert.throws(() => loadSnapshot(root, { allowSensitive: bad }), /allowSensitive must be an array/, String(bad));
  }
});

// --- I-8: the size limit applies to the bytes read ---------------------------------------------

test('I-8: a file that grows after stat still hits the size limit', (t) => {
  // The attack: stat reports a small file, the file is then replaced by a large one before the read.
  // Reporting 1 byte from every size query reproduces what the loader saw before it read.
  const root = makeTree(t, { 'big.txt': 'x'.repeat(5000) });
  for (const name of ['statSync', 'lstatSync', 'fstatSync']) {
    const original = fs[name];
    patch(t, name, (...args) => {
      const stats = original(...args);
      stats.size = 1;
      return stats;
    });
  }
  assert.throws(() => loadSnapshot(root, { maxFileBytes: 100 }), /big\.txt is over the 100 byte limit/);
});

test('I-8: the total limit counts the bytes read, not the sizes reported', (t) => {
  const root = makeTree(t, { 'a.txt': 'x'.repeat(60), 'b.txt': 'x'.repeat(60) });
  for (const name of ['statSync', 'lstatSync', 'fstatSync']) {
    const original = fs[name];
    patch(t, name, (...args) => {
      const stats = original(...args);
      stats.size = 1;
      return stats;
    });
  }
  assert.throws(() => loadSnapshot(root, { maxTotalBytes: 100 }), /content exceeds 100 bytes in total/);
});

test('I-8: a limit of zero admits only empty files', (t) => {
  const root = makeTree(t, { 'a.txt': '' });
  assert.deepEqual(loadSnapshot(root, { maxFileBytes: 0 }), { 'a.txt': '' });
  const full = makeTree(t, { 'a.txt': 'x' });
  assert.throws(() => loadSnapshot(full, { maxFileBytes: 0 }), /a\.txt is over the 0 byte limit/);
});

test('I-8: a file larger than one read chunk is loaded whole', (t) => {
  const text = 'abcdefghij'.repeat(20000);
  const root = makeTree(t, { 'long.txt': text });
  assert.equal(loadSnapshot(root)['long.txt'], text);
});

// --- I-7: bytes, not decoded strings -----------------------------------------------------------

test('I-7: two files that differ only in an invalid byte load as different strings', (t) => {
  const first = makeTree(t, { 'data.bin': Buffer.from([0x61, 0xff, 0x62]) });
  const second = makeTree(t, { 'data.bin': Buffer.from([0x61, 0xfe, 0x62]) });
  assert.notEqual(loadSnapshot(first)['data.bin'], loadSnapshot(second)['data.bin']);
});

test('I-7: fixture_unchanged fails when an invalid byte is swapped for another one', (t) => {
  // Under lossy decoding both files read as "a\uFFFDb" and the check passed.
  const pristine = loadSnapshot(makeTree(t, { 'fixtures/blob.dat': Buffer.from([0x61, 0xff, 0x62]) }));
  const changed = loadSnapshot(makeTree(t, { 'fixtures/blob.dat': Buffer.from([0x61, 0xfe, 0x62]) }));
  const same = loadSnapshot(makeTree(t, { 'fixtures/blob.dat': Buffer.from([0x61, 0xff, 0x62]) }));
  const check = { type: 'fixture_unchanged', path: 'fixtures' };
  assert.equal(evalCheck(same, check, { pristine }).passed, true);
  const verdict = evalCheck(changed, check, { pristine });
  assert.equal(verdict.passed, false);
  assert.match(verdict.detail, /^changed 1 /);
});

test('I-7: a replaced valid character and its invalid-byte look-alike are different strings', () => {
  const real = decodeLossless(Buffer.from('a\ufffdb', 'utf8'));
  const invalid = decodeLossless(Buffer.from([0x61, 0xff, 0x62]));
  assert.equal(real, 'a\ufffdb');
  assert.notEqual(invalid, real);
});

test('I-7: valid UTF-8 decodes as before, with the byte order mark kept', () => {
  const text = 'caf\u00e9 \u2713 \u{1f600}';
  assert.equal(decodeLossless(Buffer.from(text, 'utf8')), text);
  assert.equal(decodeLossless(Buffer.from([0xef, 0xbb, 0xbf, 0x61])), '\ufeffa');
  assert.equal(decodeLossless(Buffer.alloc(0)), '');
});

test('I-7: overlong forms, encoded surrogates, bad leads and truncated sequences each keep their bytes', () => {
  const lone = (bytes) => bytes.map((b) => String.fromCharCode(0xdc00 + b)).join('');
  for (const bytes of [[0xc0, 0x80], [0xed, 0xa0, 0x80], [0xf5, 0x80, 0x80, 0x80], [0xe2, 0x82], [0x80], [0xf0, 0x9f, 0x98]]) {
    assert.equal(decodeLossless(Buffer.from(bytes)), lone(bytes), bytes.map((b) => b.toString(16)).join(' '));
  }
  // A valid character after an invalid byte is still decoded.
  assert.equal(decodeLossless(Buffer.from([0xff, 0xc3, 0xa9])), `${lone([0xff])}\u00e9`);
});

test('I-7: decoding is one to one over every byte string of length three or less from a mixed alphabet', () => {
  const alphabet = [0x00, 0x41, 0x7f, 0x80, 0xa0, 0xbf, 0xc0, 0xc2, 0xe0, 0xed, 0xf0, 0xf4, 0xf5, 0xff];
  const seen = new Map();
  const visit = (bytes) => {
    const text = decodeLossless(Buffer.from(bytes));
    const key = bytes.join(',');
    assert.ok(!seen.has(text) || seen.get(text) === key, `${key} and ${seen.get(text)} decode to the same string`);
    seen.set(text, key);
    // The string can be turned back into the bytes: lone surrogates stand for single bytes.
    const back = [];
    for (const char of text) {
      const code = char.codePointAt(0);
      if (code >= 0xdc80 && code <= 0xdcff) back.push(code - 0xdc00);
      else back.push(...Buffer.from(char, 'utf8'));
    }
    assert.deepEqual(back, bytes);
  };
  visit([]);
  for (const a of alphabet) {
    visit([a]);
    for (const b of alphabet) {
      visit([a, b]);
      for (const c of alphabet) visit([a, b, c]);
    }
  }
});

// --- I-8: what the loader may do ---------------------------------------------------------------

test('I-8: the loader requires only node:crypto, node:fs, node:os and safe-path, and starts no process and makes no network call', () => {
  // purity.test.js does not list this module because it reads the filesystem by design. This pins
  // the rest of what it may do, so a new allowance has to be added here on purpose.
  // Behavior change (C-6, I-H): node:path was dropped (paths are no longer joined by name) and two
  // allowances were added on purpose: node:crypto, for the SHA-256 that pins an allowSensitive
  // fixture, and node:os, for os.platform(), which picks the descent that is safe on this OS.
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'snapshot-loader.js'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const specifiers = [...code.matchAll(/\brequire\s*\(\s*(['"`])([^'"`]*)\1\s*\)/g)].map((match) => match[2]).sort();
  assert.deepEqual(specifiers, ['./safe-path', 'node:crypto', 'node:fs', 'node:os']);
  for (const pattern of [/\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\beval\s*\(/, /\bnew\s+Function\s*\(/, /\bimport\s*\(/, /\bprocess\s*\./, /\bchild_process\b/]) {
    assert.doesNotMatch(code, pattern);
  }
});
