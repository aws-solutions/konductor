// SPDX-License-Identifier: Apache-2.0
/**
 * Credential-exposure tests for the snapshot loader (finding C-6)
 *
 * The loader refused `.env`, `.aws/credentials` and a few token formats, and nothing else: a Cargo
 * token, an INI password, a Stripe key in the underscore form, a password inside a connection
 * string, the JSON output of `aws iam create-access-key`, an npm or GitLab token, a bearer JWT, a
 * SendGrid or Hugging Face key and a service-account key file all loaded with no error, and a
 * snapshot can end up in a report or a model prompt. Each test below is one of those inputs, run
 * through `loadSnapshot` on a real directory.
 *
 * The fake secrets are assembled from fragments, so this file holds no literal token and does not
 * trip a secret scanner of its own.
 *
 * Run: node --test bench/test/snapshot-loader-credentials.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { loadSnapshot, sensitiveContentReason, contentDigest } = require('../lib/snapshot-loader');

function makeTree(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-loader-credentials-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Fragments, joined at run time.
const AWS_SECRET = ['wJalrXUtnFEMI', '/K7MDENG/', 'bPxRfiCYEXAMPLEKEY'].join('');
const STRIPE = ['sk', '_live_', '51H8', 'aBcDeFgHiJkLmNoPqRsT'].join('');
const NPM = ['npm', '_', 'aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789'].join('');
const GITLAB = ['glp', 'at-', 'aBcDeFgHiJkLmNoPqRsT'].join('');
const JWT = ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ', 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'].join('.');
const SENDGRID = ['S', 'G.', 'aBcDeFgHiJkLmNoPqRsTuV', '.', 'WxYzAbCdEfGhIjKlMnOpQrStUvWxYzAbCdEfGhIjKlM'].join('');
const HF = ['h', 'f_', 'aBcDeFgHiJkLmNoPqRsTuVwXyZaBcDeFgH'].join('');
const SERVICE_ACCOUNT = JSON.stringify({ type: 'service_account', project_id: 'demo', private_key_id: 'abc123', client_email: 'sa@demo.iam.gserviceaccount.com' });

// The twelve credentials the review loaded with no error: the path each sat at, and its content.
const REVIEW_CASES = [
  ['.cargo/credentials.toml', `[registry]\ntoken = "cio${'1234567890abcdef'}"\n`],
  ['credentials.ini', '[default]\npassword=hunter2\n'],
  ['notes.txt', `STRIPE_SECRET=${STRIPE}\n`],
  ['settings.py', `DATABASE_URL = "postgres://admin:S3cr3tPassw0rd@db.internal:5432/app"\n`],
  ['out.json', `{"SecretAccessKey":"${AWS_SECRET}"}`],
  ['notes.md', `//registry.npmjs.org/:_authToken=${NPM}\n`],
  ['ci.yml', `variables:\n  DEPLOY_TOKEN: ${GITLAB}\n`],
  ['.yarnrc.yml', 'npmRegistryServer: "https://registry.example.com"\nnpmAuthToken: abcdef\n'],
  ['a.txt', `curl -H "Authorization: Bearer ${JWT}" https://api.example.com\n`],
  ['m.txt', `${SENDGRID}\n`],
  ['gcp-key.json', SERVICE_ACCOUNT],
  ['t.txt', `${HF}\n`],
];

test('C-6: each credential the review loaded with no error is refused, and the error never echoes it', (t) => {
  for (const [relative, content] of REVIEW_CASES) {
    const root = makeTree(t, { 'README.md': 'hello', [relative]: content });
    assert.throws(
      () => loadSnapshot(root),
      (error) => {
        assert.match(error.message, new RegExp(`refusing to load ${escapeRegExp(relative)}`), relative);
        for (const secret of [AWS_SECRET, STRIPE, NPM, GITLAB, JWT, SENDGRID, HF, 'S3cr3tPassw0rd', 'hunter2']) {
          assert.ok(!error.message.includes(secret), `${relative}: the error must not echo ${secret.slice(0, 6)}...`);
        }
        return true;
      },
      relative,
    );
  }
});

test('C-6: the content layer refuses each one on its own, under a name the name layer does not know', (t) => {
  // The name layer would catch several of these by their file names (credentials.ini, gcp-key.json,
  // .yarnrc.yml). Hiding each behind a neutral name proves the content scan is not leaning on it.
  REVIEW_CASES.forEach(([relative, content], index) => {
    const neutral = `neutral-${index}.txt`;
    const root = makeTree(t, { [neutral]: content });
    assert.throws(() => loadSnapshot(root), new RegExp(`refusing to load ${neutral}: its content holds `), `${relative} as ${neutral}`);
    assert.equal(typeof sensitiveContentReason(content), 'string', relative);
  });
});

test('C-6: what was already refused stays refused', (t) => {
  const cases = {
    '.env': 'MODE=test\n',
    '.aws/credentials': '[default]\n',
    id_rsa: 'x\n',
    'certs/server.pem': 'x\n',
    'backup/key.bak': '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n',
    'deploy.txt': 'AKIAIOSFODNN7EXAMPLE\n',
    '.env.': 'MODE=test\n',
    'id_rsa.': 'x\n',
    '.aws./credentials': '[default]\n',
    '.Env ': 'MODE=test\n',
  };
  for (const [relative, content] of Object.entries(cases)) {
    const root = makeTree(t, { [relative]: content });
    assert.throws(() => loadSnapshot(root), new RegExp(`refusing to load ${escapeRegExp(relative)}`), relative);
  }
});

test('C-6: Stripe keys are refused in the sk_ form as well as sk-', () => {
  for (const key of [STRIPE, ['sk', '_test_', '4eC39HqLyjWDarjtT1zdp7dc'].join(''), ['rk', '_live_', 'aBcDeFgHiJkLmNoPqRsT'].join('')]) {
    assert.match(sensitiveContentReason(`value ${key}`), /Stripe/, key.slice(0, 8));
  }
  assert.match(sensitiveContentReason(`x ${['sk', '-', 'a'.repeat(40)].join('')}`), /API secret key/);
});

// --- the bounded gap: formats nobody named ----------------------------------------------------

test('C-6: a token of a provider no rule names is still caught, by assignment or by entropy', () => {
  // These formats have no rule of their own. Group 2 (a secret-looking assignment) and group 4 (a
  // high-entropy token) are what keep the denylist from being the only layer.
  const random = ['Zk3pQ9vL7xW2mN8bR5tY1cH4jF6dS0aG', 'q8LmT2vXz9RbN4kYw7JcH5pD1sFgA3uE'].join('');
  const cases = {
    'a keyed hex secret': 'ACME_API_KEY=3f9a1c07d4b84e2a9c3d5e7f10a2b4c6\n',
    'a yaml password': 'db:\n  password: Tr0ub4dor&3xyz\n',
    'a json client secret': '{"client_secret": "x7Qp-93LmZ_vRt2"}\n',
    'a quoted random token': `config = "${random}"\n`,
    'a value after a colon': `deploy key: ${random}\n`,
    'a token alone on its line': `${random}\n`,
    'a connection string without a known scheme': 'amqp://svc:Pa55w0rdQ@mq.internal:5672/vhost\n',
    'a redis url with an empty user': 'redis://:Pa55w0rdQ@cache.internal:6379/0\n',
    'a comparison against a literal secret': 'if (token === "a1b2c3d4e5f6") {}\n',
  };
  for (const [label, text] of Object.entries(cases)) {
    assert.equal(typeof sensitiveContentReason(text), 'string', label);
  }
});

test('C-6: ordinary code, prose, hashes and certificates are not mistaken for credentials', (t) => {
  // I-8 r4: this fixture used to be four lines of repeated text between the BEGIN and END lines, which the loader
  // blanked because of the markers alone, and that is the wrapper a secret can hide in. A block is now blanked only
  // when its body decodes to one DER SEQUENCE of exactly the declared length, as every real certificate does, so the
  // fixture is built as one: a 0x30 0x82 header over 600 pseudo-random bytes, in 64-character lines.
  const der = Buffer.concat([Buffer.from([0x30, 0x82, 0x02, 0x58]), crypto.createHash('sha512').update('ca.crt').digest(), ...Array.from({ length: 8 }, (_, i) => crypto.createHash('sha512').update(`ca.crt:${i}`).digest())]);
  const sized = Buffer.concat([der, Buffer.alloc(4 + 600 - der.length, 7)]);
  const certificate = ['-----BEGIN CERTIFICATE-----', ...sized.toString('base64').match(/.{1,64}/g), '-----END CERTIFICATE-----'].join('\n');
  const files = {
    'README.md': 'Pass: 90-100 is excellent. The password must be rotated every 90 days. Bearer token authentication is described below.\n',
    'src/auth.js': 'const nextToken = getToken();\nconst token = req.headers.authorization;\nconst password = prompt("Enter your password");\nconst apiKey = process.env.API_KEY;\n',
    'src/schema.smithy': 'structure Page {\n    nextToken: String\n}\n@paginated(inputToken: "nextToken", outputToken: "nextToken")\n',
    'src/model.py': 'password_hash = hash_password(raw)\ntoken_type = "bearer"\nsecret_name = "my-secret-name"\n',
    'config/values.yaml': 'existingSecret: my-secret\ntoken: ${CI_TOKEN}\npassword: "{{ .Values.password }}"\n',
    'docs/db.md': 'Connect with `postgres://user:password@localhost:5432/db` or `https://[user[:pass]@]host[:port]`.\n',
    // I-8 r4: the digest used to be an invented 76-character string, which only passed because any `sha512-` prefix
    // was exempt. It is now a real SHA-512 (64 bytes, 88 characters with `==`), the only thing the exemption admits.
    'package-lock.json': `{"integrity": "sha512-${crypto.createHash('sha512').update('left-pad@1.3.0').digest('base64')}"}\n`,
    'git-notes.txt': 'commit da39a3ee5e6b4b0d3255bfef95601890afd80709\nid 123e4567-e89b-12d3-a456-426614174000\n',
    'src/alphabet.js': "const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';\n",
    'certs/ca.crt': certificate,
    'src/names.js': "const path = 'src/components/AuthenticationProvider/UserProfile2Page';\n",
  };
  const root = makeTree(t, files);
  assert.deepEqual(Object.keys(loadSnapshot(root)), Object.keys(files).sort());
});

test('C-6: a password with no digit in it is a documented miss, not a promise', () => {
  // The header says so: groups 2 to 4 bound the gap without closing it. Pinning one known miss in a
  // test keeps that sentence true; if the rule is ever tightened, this test is the one to flip.
  assert.equal(sensitiveContentReason('password=hunter\n'), null);
});

// --- scan cost -------------------------------------------------------------------------------

test('C-6: hostile files cannot make the content scan slow', () => {
  const megabyte = 1024 * 1024;
  const hostile = {
    'repeated keyword': 'password='.repeat(megabyte / 9),
    'repeated keyword and long value': `password=${'a'.repeat(300)}\n`.repeat(megabyte / 310),
    'repeated scheme': '://u:'.repeat(megabyte / 5),
    'repeated quotes': '"a'.repeat(megabyte / 2),
    'one long base64 line': `"${'Ab1'.repeat(megabyte / 3)}`,
    'many PEM openers': '-----BEGIN X-----\n'.repeat(megabyte / 18),
    'bearer run': 'Bearer '.repeat(megabyte / 7),
    'many near-miss tokens': `key: ${'Ab1'.repeat(10)}\n`.repeat(megabyte / 36),
  };
  for (const [label, text] of Object.entries(hostile)) {
    const started = Date.now();
    sensitiveContentReason(text);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 5000, `${label} took ${elapsed} ms`);
  }
});

// --- allowSensitive ---------------------------------------------------------------------------

test('C-6: a real secret written at an allowed path is still refused', (t) => {
  // Before: allowSensitive was path-only and skipped both layers, so `.env` here loaded.
  const root = makeTree(t, { '.env': `DB_PASSWORD=${['Tr0ub4dor', '&3xyz'].join('')}\nSTRIPE_SECRET=${STRIPE}\n`, 'a.txt': 'x' });
  assert.throws(() => loadSnapshot(root), /refusing to load \.env: its name marks it as a dotenv file/);
  assert.throws(() => loadSnapshot(root, { allowSensitive: ['.env'] }), /refusing to load \.env: its content holds /);
});

test('C-6: an allowed fixture admits its pinned bytes and nothing a subject writes there later', (t) => {
  const fixture = Buffer.from('MODE=test\nAWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n');
  const pin = { path: '.env', sha256: contentDigest(fixture) };
  const pristine = makeTree(t, { '.env': fixture, 'a.txt': 'x' });
  assert.deepEqual(loadSnapshot(pristine, { allowSensitive: [pin] }), { '.env': fixture.toString('utf8'), 'a.txt': 'x' });

  // The subject appends a real secret to the allowed fixture: the bytes no longer hash to the pin.
  const written = makeTree(t, { '.env': Buffer.concat([fixture, Buffer.from(`STRIPE_SECRET=${STRIPE}\n`)]), 'a.txt': 'x' });
  assert.throws(() => loadSnapshot(written, { allowSensitive: [pin] }), /refusing to load \.env: its content holds /);

  // The subject keeps the fake key line and adds a different credential: still scanned.
  const swapped = makeTree(t, { '.env': 'MODE=test\nAWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nPASSWORD=hunter22\n', 'a.txt': 'x' });
  assert.throws(() => loadSnapshot(swapped, { allowSensitive: [pin] }), /refusing to load \.env: its content holds /);

  // The subject edits the allowed file to something harmless: it is allowed by name and scans clean.
  const harmless = makeTree(t, { '.env': 'MODE=prod\n', 'a.txt': 'x' });
  assert.deepEqual(Object.keys(loadSnapshot(harmless, { allowSensitive: [pin] })), ['.env', 'a.txt']);
});

test('C-6: a pin admits its own path only', (t) => {
  const fixture = Buffer.from('AKIAIOSFODNN7EXAMPLE\n');
  const pin = { path: 'fixtures/fake.txt', sha256: contentDigest(fixture) };
  const root = makeTree(t, { 'fixtures/fake.txt': fixture, 'elsewhere/copy.txt': fixture });
  assert.throws(() => loadSnapshot(root, { allowSensitive: [pin] }), /refusing to load elsewhere\/copy\.txt: its content holds an AWS access key id/);
});

test('C-6: a malformed or ambiguous allowance is a TypeError and never an open door', (t) => {
  const root = makeTree(t, { 'a.txt': 'x' });
  const digest = contentDigest('x');
  const bad = [
    [{ path: 'a.txt' }],
    [{ sha256: digest }],
    [{ path: 'a.txt', sha256: digest, extra: 1 }],
    [{ path: 'a.txt', sha256: digest.toUpperCase() }],
    [{ path: 'a.txt', sha256: digest.slice(1) }],
    [{ path: 'a.txt', sha256: 5 }],
    [{ path: '', sha256: digest }],
    [{ path: 5, sha256: digest }],
    [null],
    [['a.txt']],
    ['a.txt', 'a.txt'],
    ['a.txt', { path: 'a.txt', sha256: digest }],
  ];
  for (const allowSensitive of bad) {
    assert.throws(() => loadSnapshot(root, { allowSensitive }), TypeError, JSON.stringify(allowSensitive));
  }
});

test('C-6: contentDigest is the SHA-256 of the bytes, as lower-case hex', () => {
  assert.equal(contentDigest(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(contentDigest('abc'), contentDigest(Buffer.from('abc')));
  assert.notEqual(contentDigest(Buffer.from([0xff])), contentDigest(Buffer.from([0xfe])));
  for (const bad of [undefined, null, 5, {}, []]) assert.throws(() => contentDigest(bad), TypeError, String(bad));
});
