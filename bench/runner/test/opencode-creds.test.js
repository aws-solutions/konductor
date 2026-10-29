// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmp, write } = require('./helpers.js');
const { extractProfile, installCredentials, removeCredentials } = require('../lib/harness/opencode-creds.js');
const { scanTree, scrubTree } = require('../lib/hygiene.js');

// Obviously fake values shaped like the real thing.
// Built from parts so that no key-shaped literal sits in the source.
const KEY_ID = 'AK' + 'IATESTTESTTEST1234';
const OTHER_KEY_ID = 'AS' + 'IAOTHEROTHEROTHER1';
const SECRET = 'fakeSecretValueNotReal0123456789abcdefgh';
const TOKEN = 'fakeSessionTokenNotReal//ABCDEFGHIJKLMNOP==';
const INI = `[other]
aws_access_key_id = ${OTHER_KEY_ID}
aws_secret_access_key = otherSecretShouldNeverBeCopied

[bench]
aws_access_key_id = ${KEY_ID}
aws_secret_access_key = ${SECRET}
aws_session_token = ${TOKEN}
`;

test('extractProfile keeps only the named profile', () => {
  const { text, secrets } = extractProfile(INI, 'bench');
  assert.match(text, /^\[bench\]\n/);
  assert.ok(text.includes(KEY_ID) && text.includes(SECRET) && text.includes(TOKEN));
  assert.equal(text.includes('other'), false);
  assert.ok(secrets.includes(SECRET) && secrets.includes(TOKEN));
});

test('extractProfile accepts the [profile name] form and refuses a missing or incomplete profile without echoing values', () => {
  assert.match(extractProfile(INI.replace('[bench]', '[profile bench]'), 'bench').text, /^\[bench\]/);
  assert.throws(() => extractProfile(INI, 'nope'), /profile "nope" not found/);
  assert.throws(() => extractProfile('[bench]\naws_access_key_id = x\n', 'bench'), /lacks aws_secret_access_key/);
  try { extractProfile('[bench]\naws_access_key_id = leakcheck\n', 'bench'); } catch (e) { assert.equal(e.message.includes('leakcheck'), false); }
});

test('installCredentials writes a 0600 file under the scratch home and removeCredentials deletes it', () => {
  const root = tmp();
  try {
    write(path.join(root, 'creds'), INI);
    const home = path.join(root, 'home');
    const { file, configFile } = installCredentials({ credsFile: path.join(root, 'creds'), profile: 'bench', home, region: 'us-east-1' });
    assert.equal(file, path.join(home, '.aws', 'credentials'));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(file, 'utf8').includes('otherSecret'), false);
    assert.match(fs.readFileSync(configFile, 'utf8'), /region = us-east-1/);
    removeCredentials(home);
    assert.equal(fs.existsSync(path.join(home, '.aws')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an unreadable credentials file gives an error without the path contents', () => {
  assert.throws(() => installCredentials({ credsFile: '/nonexistent/creds', profile: 'bench', home: tmp(), region: 'us-east-1' }), /cannot read the credentials file/);
});

test('scanTree finds key ids, setting names and exact values, and reports names only', () => {
  const dir = tmp();
  try {
    write(path.join(dir, 'clean.txt'), 'nothing here\n');
    write(path.join(dir, 'a/stream.jsonl'), `{"out":"key ${KEY_ID}"}\n`);
    write(path.join(dir, 'b/stderr.txt'), 'AWS_SESSION_TOKEN is set\n');
    write(path.join(dir, 'c/raw.txt'), `value ${SECRET}\n`);
    const hits = scanTree(dir, { literals: [SECRET] });
    const byFile = Object.fromEntries(hits.map((h) => [path.relative(dir, h.file), h.pattern]));
    assert.equal(byFile['a/stream.jsonl'], 'access key id');
    assert.equal(byFile['b/stderr.txt'], 'session token setting');
    assert.equal(byFile['c/raw.txt'], 'exact secret value');
    assert.equal('clean.txt' in byFile, false);
    assert.equal(JSON.stringify(hits).includes(SECRET), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scrubTree redacts exact values in place', () => {
  const dir = tmp();
  try {
    write(path.join(dir, 'x/out.txt'), `before ${SECRET} after ${TOKEN}\n`);
    assert.equal(scrubTree(dir, [SECRET, TOKEN]), 1);
    assert.equal(fs.readFileSync(path.join(dir, 'x/out.txt'), 'utf8'), 'before <redacted> after <redacted>\n');
    assert.deepEqual(scanTree(dir, { literals: [SECRET, TOKEN] }), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
