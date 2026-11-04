// SPDX-License-Identifier: Apache-2.0
/**
 * Credential-exposure tests for the snapshot loader, review 4 (findings C-2 r4 and I-8 r4)
 *
 * Review 4 found credentials that still loaded through the real `loadSnapshot` with no error:
 * strong passwords that start with `$`, `@` or `*` or hold a bracket (C-2), keyword spellings the
 * header promised but the pattern did not match (`pass`, `pw`, `passcode`, `api key`), a raw secret
 * in a table cell, a list item, a CSV field or a URL path (C-2), and four ways to slip a token past
 * the entropy rule: `abcdef` inside it, a `sha512-` or `sha1-` prefix, a `BEGIN CERTIFICATE` wrapper,
 * and a lower-case or upper-case token with digits (I-8). Each test below is one of those inputs.
 *
 * Three kinds of test live here, and the section titles say which:
 *   - exploit tests: refused now, and they loaded at tip 358ea0d6;
 *   - pin tests: they hold a boundary or a stated miss in place and pass at both (a mutant that moves
 *     ENTROPY_MIN_LENGTH from 32 to 40 survived the whole suite before this file);
 *   - false-positive tests: ordinary code and prose that must keep loading.
 *
 * Every fake secret is assembled from fragments at run time, so this file holds no literal token or
 * assignment and does not trip the content scan it tests.
 *
 * Run: node --test bench/test/snapshot-loader-credentials-r4.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadSnapshot, sensitiveContentReason, contentDigest } = require('../lib/snapshot-loader');

function makeTree(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-loader-r4-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return root;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const join = (...parts) => parts.join('');

/** Deterministic pseudo-random text over `alphabet`: a SHA-256 chain, so a run never differs from the last. */
function randomText(seed, alphabet, length) {
  let bytes = Buffer.alloc(0);
  for (let n = 0; bytes.length < length; n += 1) bytes = Buffer.concat([bytes, crypto.createHash('sha256').update(`${seed}:${n}`).digest()]);
  return Array.from(bytes.subarray(0, length), (byte) => alphabet[byte % alphabet.length]).join('');
}

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const BASE64URL = `${ALNUM}-_`;
const LOWER_DIGIT = 'abcdefghijklmnopqrstuvwxyz0123456789';
const UPPER_DIGIT = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const AWS_SECRET = join('wJalrXUtnFEMI', '/K7MDENG/', 'bPxRfiCYEXAMPLEKEY');
// A 40-character token that scores as random, in fragments. Mixed case, digits, no sequential run.
const TOKEN_40 = join('Zk3pQ9vL7xW2mN8b', 'R5tY1cH4jF6dS0aG', 'q8LmT2vX');

// --- C-2 r4: passwords the exemptions let through (exploit tests) ----------------------------

// [name, separator, value]: joined at run time. The reviewer's eleven shapes, each with a concrete value.
const CREDENTIAL_ASSIGNMENTS = [
  ['export DB_PASSWORD', '=', '"@dm1nPassw0rd"'],
  ['password', '=', '$uperS3cret!'],
  ['passwd', ' = ', 'P@ssw0rd(1)'],
  ['db_password', ': ', '*Pr0dRootPw'],
  ['secret', '=', '"%Xk29fjQ"'],
  ['api_key', ' = ', '"k9<x2f>Qz7"'],
  ['password', '=', '"{s3cr3t}Pw"'],
  ['password', '=', '[Pr0d]x'],
  ['DB_PASS', '=', 'Tr0ub4dor3x'],
  ['pw', '=', 'Hunter22x'],
  ['passcode', '=', 'Hunter22x'],
  ['api key', ' = ', 'abcdef123456'],
  // The cases the old exemptions were written for, in their strong-password form.
  ['password', '=', '<Pr0dRootPw>'],
  ['password', '=', '{{s3cr3t}}'],
  ['password', '=', '$Pr0dRoot'],
  ['password', '=', '%40dm1nPw'],
  ['password', '=', '${VAR:-hunter2}'],
  ['password', '=', 'hunter2(1)'],
  ['PASS', ': ', 'Tr0ub4dor3x'],
  ['access key', ' = ', 'AbCd1234EfGh'],
  ['private key', ': ', 'AbCd1234EfGh'],
];

test('C-2 r4: each strong password that loaded with no error is refused by loadSnapshot, and the error never echoes it', (t) => {
  CREDENTIAL_ASSIGNMENTS.forEach(([name, separator, value], index) => {
    const content = `${name}${separator}${value}\n`;
    const neutral = `neutral-${index}.txt`;
    const root = makeTree(t, { 'README.md': 'hello', [neutral]: content });
    assert.throws(
      () => loadSnapshot(root),
      (error) => {
        assert.match(error.message, new RegExp(`refusing to load ${escapeRegExp(neutral)}: its content holds `));
        assert.ok(!error.message.includes(value.replace(/^["']|["']$/g, '')), `assignment ${index}: the error must not echo the value`);
        return true;
      },
      `assignment ${index} (${name.trim()})`,
    );
    assert.equal(typeof sensitiveContentReason(content), 'string', `assignment ${index} (${name.trim()})`);
  });
});

test('C-2 r4: the keywords the module header lists are the keywords the pattern matches', () => {
  // The header names the words a secret-looking name may end in. A word it lists that the pattern does
  // not match is a promise the loader breaks (review 4: `pass`, `pw`, `passcode` and `api key` all were).
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'snapshot-loader.js'), 'utf8');
  const listed = /whose name ends in ([^()]*?) given a literal value/s.exec(source.replace(/\n \* /g, ' '));
  assert.ok(listed, 'the header sentence that lists the keywords was not found');
  const words = listed[1].split(/,\s*|\s+or\s+/).map((word) => word.trim()).filter((word) => word !== '' && word !== 'the like');
  assert.ok(words.length >= 10, `the header lists ${words.length} keywords`);
  for (const word of words) {
    for (const spelling of [word, word.replace(/ /g, '_'), word.replace(/ /g, '-'), word.toUpperCase().replace(/ /g, '_')]) {
      const text = `${spelling}=Zk9x2Qr7\n`;
      assert.equal(typeof sensitiveContentReason(text), 'string', `the header lists "${word}" and ${JSON.stringify(spelling)} loads`);
    }
  }
});

test('C-2 r4: a bare pass or pw still needs a letter in the value, so prose and score tables load', () => {
  for (const line of ['Pass: 90-100', 'pass = 1000000', 'pw: 123456789', 'The pass rate was 95%', 'SkillResourcePass::rewrite(x2)']) {
    assert.equal(sensitiveContentReason(`${line}\n`), null, line);
  }
});

test('C-2 r4: only a whole-value reference or template is exempt, and a name with a digit and a lower-case letter is not a variable', () => {
  const references = [
    '${DB_PASS2}',
    '$DB_PASS2',
    '%DB_PASS2%',
    '{{ db.PASS2 }}',
    '${{ secrets.DB_PASS2 }}',
    '<YOUR_PASS_2>',
    '%(pass2)s',
    '$(cat/run/secrets/pw2)',
    '${CLIENT_SECRET}',
    '***',
    'xxxxxxxx',
  ];
  for (const reference of references) {
    assert.equal(sensitiveContentReason(`password=${reference}\n`), null, reference);
    assert.equal(sensitiveContentReason(`secret: "${reference}"\n`), null, `quoted ${reference}`);
  }
  // A start character is not a reference; neither is a template with a default that holds text.
  for (const literal of ['$uperS3cret!', '@dm1nPassw0rd', '*Pr0dRootPw', '%Xk29fjQ', '<Pr0dRootPw>', '{{s3cr3t}}', '${VAR:-hunter2}', '[Pr0d]x']) {
    assert.equal(typeof sensitiveContentReason(`password=${literal}\n`), 'string', literal);
  }
});

test('C-2 r4: a connection string password that starts with $ or % is judged like any other, and a variable reference is a placeholder', () => {
  assert.equal(typeof sensitiveContentReason(join('redis://:', '%40dm1nPw', '@cache.internal:6379/0\n')), 'string');
  assert.equal(typeof sensitiveContentReason(join('amqp://svc:', '$uperS3cret', '@mq.internal:5672/vhost\n')), 'string');
  assert.equal(sensitiveContentReason(join('postgres://app:', '${DB_PASS2}', '@db.internal:5432/app\n')), null);
  assert.equal(sensitiveContentReason(join('postgres://app:', '$DB_PASS2', '@db.internal:5432/app\n')), null);
});

test('C-2 r4: a call or an index is code, and a literal that merely holds a bracket is not', () => {
  const code = [
    'token: foo(bar2, baz)',
    'token = getToken(opts2)',
    'token = sys.argv[1]',
    'password = base64.b16encode(random_bytes[8:])',
    'token = tokens[0]',
    'output_token: "Jobs[-1].JobId"',
    'output_token: "StreamDescription.Shards[-1].ShardId"',
    'token = 1*<any CHAR except CTLs or separators>',
    'TOKENS = /^[\\u0009\\u0020-\\u007E]+$/',
    'password = req.body.token2',
  ];
  for (const line of code) assert.equal(sensitiveContentReason(`${line}\n`), null, line);
});

// --- C-2 r4: a raw secret in a structured position (exploit tests) ----------------------------

const STRUCTURED_POSITIONS = [
  ['a markdown table cell', (secret) => `| aws | ${secret} |\n`],
  ['a table cell with no padding', (secret) => `|aws|${secret}|\n`],
  ['a sentence that says it is the secret', (secret) => `Note that the secret is ${secret} for now.\n`],
  ['a list item', (secret) => `- ${secret}\n`],
  ['a starred list item', (secret) => `* ${secret}\n`],
  ['a numbered list item', (secret) => `1. ${secret}\n`],
  ['a parenthesis', (secret) => `rotate this (${secret}) soon\n`],
  ['a bracket', (secret) => `see [${secret}] below\n`],
  ['a CSV field', (secret) => `aws,${secret},prod\n`],
  ['a heading', (secret) => `# ${secret}\n`],
  ['after an arrow', (secret) => `old -> ${secret}\n`],
  ['a URL path', (secret) => `https://keys.example.internal/v1/${secret}/rotate\n`],
  ['a URL path at the end', (secret) => `https://keys.example.internal/${secret}\n`],
  ['after a slash in a path', (secret) => `/srv/keys/${secret}\n`],
  ['after a query key', (secret) => `https://h.example/p?key=${secret}&x=1\n`],
  ['a YAML list item', (secret) => `keys:\n  - ${secret}\n`],
  ['a tab-separated field', (secret) => `aws\t${secret}\tprod\n`],
];

test('C-2 r4: a 40-character random token is refused in every structured position', () => {
  for (const [label, wrap] of STRUCTURED_POSITIONS) {
    assert.equal(typeof sensitiveContentReason(wrap(TOKEN_40)), 'string', `${label}: random token`);
  }
});

test('C-2 r4: the 40-character AWS secret key is refused in every structured position, through loadSnapshot', (t) => {
  STRUCTURED_POSITIONS.forEach(([label, wrap], index) => {
    const neutral = `positions-${index}.md`;
    const root = makeTree(t, { [neutral]: wrap(AWS_SECRET) });
    assert.throws(
      () => loadSnapshot(root),
      (error) => {
        assert.match(error.message, new RegExp(`refusing to load ${escapeRegExp(neutral)}`), label);
        assert.ok(!error.message.includes(AWS_SECRET), `${label}: the error must not echo the secret`);
        return true;
      },
      label,
    );
  });
});

// --- I-8 r4: ways to slip a token past the entropy rule (exploit tests) ----------------------

test('I-8 r4: a token that contains abcdef, 012345 or a similar run is still refused', () => {
  for (const run of ['abcdef', 'ABCDEF', '012345', 'uvwxyz', 'ghijklm']) {
    const token = join(TOKEN_40.slice(0, 16), run, TOKEN_40.slice(16, 40 - run.length + 0));
    assert.ok(token.length >= 38, `${run}: fixture is ${token.length} characters`);
    assert.equal(typeof sensitiveContentReason(`k = "${token}"\n`), 'string', `${run}: quoted`);
    assert.equal(typeof sensitiveContentReason(`| x | ${token} |\n`), 'string', `${run}: table cell`);
  }
});

test('I-8 r4: a sha512- or sha1- prefix does not exempt a token, and a genuine integrity hash is still exempt', () => {
  const tail = TOKEN_40;
  for (const prefix of ['sha512-', 'sha1-', 'sha256-', 'sha384-', 'sha224-', 'SHA512-']) {
    assert.equal(typeof sensitiveContentReason(`"integrity": "${prefix}${tail}"\n`), 'string', `${prefix} + 40 random characters`);
    assert.equal(typeof sensitiveContentReason(`| x | ${prefix}${tail} |\n`), 'string', `${prefix} in a table cell`);
  }
  // A sha512 digest with the wrong length is not a digest: 85 and 87 characters.
  const body86 = randomText('integrity-512', ALNUM, 86);
  assert.equal(typeof sensitiveContentReason(`"integrity": "sha512-${body86.slice(1)}=="\n`), 'string', 'sha512 body of 85 characters');
  assert.equal(typeof sensitiveContentReason(`"integrity": "sha512-${body86}A=="\n`), 'string', 'sha512 body of 87 characters');
  assert.equal(typeof sensitiveContentReason(`"integrity": "sha512-${body86}"\n`), 'string', 'sha512 body without the == padding');
  // Genuine digests keep loading: package-lock.json is full of them.
  const genuine = {
    sha512: `sha512-${randomText('integrity-512', ALNUM, 86)}==`,
    sha384: `sha384-${randomText('integrity-384', ALNUM, 64)}`,
    sha256: `sha256-${randomText('integrity-256', ALNUM, 43)}=`,
    sha1: `sha1-${randomText('integrity-1', ALNUM, 27)}=`,
  };
  for (const [algorithm, integrity] of Object.entries(genuine)) {
    assert.equal(sensitiveContentReason(`"integrity": "${integrity}"\n`), null, algorithm);
  }
});

/** A DER SEQUENCE of `size` pseudo-random content bytes, as PEM-style base64 lines of 64 characters. */
function derBody(seed, size) {
  const content = Buffer.from(randomText(seed, ALNUM, size), 'latin1');
  const header = size < 128 ? Buffer.from([0x30, size]) : size < 256 ? Buffer.from([0x30, 0x81, size]) : Buffer.from([0x30, 0x82, size >> 8, size & 0xff]);
  return Buffer.concat([header, content]).toString('base64').match(/.{1,64}/g).join('\n');
}

test('I-8 r4: a secret wrapped in BEGIN CERTIFICATE is scanned, and a genuine certificate or public key is not', () => {
  const wrap = (label, body) => `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
  // The wrapper the reviewer used: the secret as the whole body, as one line, as several lines.
  assert.equal(typeof sensitiveContentReason(wrap('CERTIFICATE', TOKEN_40)), 'string', 'one line');
  assert.equal(typeof sensitiveContentReason(wrap('CERTIFICATE', `${TOKEN_40}\n${TOKEN_40}`)), 'string', 'two lines');
  assert.equal(typeof sensitiveContentReason(wrap('PUBLIC KEY', AWS_SECRET)), 'string', 'AWS secret in a PUBLIC KEY block');
  assert.equal(typeof sensitiveContentReason(wrap('X509 CRL', randomText('crl', BASE64URL, 120))), 'string', 'random text, not DER');
  // A body that decodes to DER whose declared length does not match the bytes: not a certificate.
  const truncated = derBody('truncated', 400).slice(0, -8);
  assert.equal(typeof sensitiveContentReason(wrap('CERTIFICATE', truncated)), 'string', 'DER with a short body');
  // Text around a genuine block is scanned like any other text.
  assert.equal(typeof sensitiveContentReason(`${wrap('CERTIFICATE', derBody('around', 400))}| x | ${TOKEN_40} |\n`), 'string', 'a secret after a real certificate');
  // Genuine blocks load.
  assert.equal(sensitiveContentReason(wrap('CERTIFICATE', derBody('cert-a', 700))), null, 'DER certificate, long length form');
  assert.equal(sensitiveContentReason(wrap('CERTIFICATE', derBody('cert-b', 300))), null, 'DER certificate, 0x82 length form');
  assert.equal(sensitiveContentReason(wrap('CERTIFICATE REQUEST', derBody('csr', 250))), null, 'certificate request');
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  assert.equal(sensitiveContentReason(publicKey), null, 'a real RSA public key');
  const ed = crypto.generateKeyPairSync('ed25519', { publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  assert.equal(sensitiveContentReason(ed.publicKey), null, 'a real ed25519 public key');
});

/** The OpenPGP CRC-24 (RFC 4880 6.1), written out here so the test does not lean on the loader's. */
function crc24(bytes) {
  let crc = 0xb704ce;
  for (const byte of bytes) {
    crc ^= byte << 16;
    for (let i = 0; i < 8; i += 1) {
      crc <<= 1;
      if (crc & 0x1000000) crc ^= 0x1864cfb;
    }
  }
  return crc & 0xffffff;
}

test('I-8 r4: a PGP armor block is exempt only while its CRC-24 line matches', () => {
  const data = Buffer.from(randomText('pgp', ALNUM, 300), 'latin1');
  const lines = data.toString('base64').match(/.{1,64}/g).join('\n');
  const checksum = (value) => Buffer.from([(value >> 16) & 255, (value >> 8) & 255, value & 255]).toString('base64');
  const armor = (crc) => `-----BEGIN PGP PUBLIC KEY BLOCK-----\nVersion: Test 1.0\n\n${lines}\n=${crc}\n-----END PGP PUBLIC KEY BLOCK-----\n`;
  assert.equal(sensitiveContentReason(armor(checksum(crc24(data)))), null, 'matching CRC');
  assert.equal(typeof sensitiveContentReason(armor(checksum((crc24(data) + 1) & 0xffffff))), 'string', 'wrong CRC');
  // The same wrapper around a secret.
  const forged = `-----BEGIN PGP PUBLIC KEY BLOCK-----\n\n${TOKEN_40}\n=AAAA\n-----END PGP PUBLIC KEY BLOCK-----\n`;
  assert.equal(typeof sensitiveContentReason(forged), 'string', 'a secret in an armor wrapper');
});

test('I-8 r4: a lower-case or upper-case token with digits is refused, and hex of any length still loads', () => {
  const lower = randomText('lower-40', LOWER_DIGIT, 40);
  const upper = randomText('upper-40', UPPER_DIGIT, 40);
  assert.ok(/[a-z]/.test(lower) && /\d/.test(lower) && !/[A-Z]/.test(lower), 'fixture: lower case and digits');
  assert.ok(/[A-Z]/.test(upper) && /\d/.test(upper) && !/[a-z]/.test(upper), 'fixture: upper case and digits');
  for (const [label, token] of [['lower case', lower], ['upper case', upper]]) {
    assert.equal(typeof sensitiveContentReason(`api_url = "${token}"\n`), 'string', `${label}: quoted`);
    assert.equal(typeof sensitiveContentReason(`| id | ${token} |\n`), 'string', `${label}: table cell`);
    assert.equal(typeof sensitiveContentReason(`token ${token}\n`), 'string', `${label}: prose`);
  }
  // Hex is a digest, a commit id or a key id and is not judged: 16 symbols cannot reach the bar.
  for (const length of [32, 40, 56, 64, 128]) {
    const hex = randomText(`hex-${length}`, '0123456789abcdef', length);
    assert.equal(sensitiveContentReason(`"${hex}"\n| x | ${hex} |\n${hex.toUpperCase()}\n`), null, `${length} hex digits`);
  }
  assert.equal(sensitiveContentReason('id 123e4567-e89b-12d3-a456-426614174000\ncommit da39a3ee5e6b4b0d3255bfef95601890afd80709\n'), null);
});

// --- pin tests: the 32 to 39 character range and the length bounds ---------------------------

// Fixed tokens, one per length, each of which scores as random. In fragments so this file stays clean.
const RANGE_TOKENS = {
  32: join('nA45APXC5ATa', 'UJBWosPNm1Zsvl9aT5WE'),
  33: join('ADGjDjHR2cAT3xz9', 'YYahJB5gsCsGojMDJ'),
  34: join('hHejDAHYt4gh1rmh', 'L0CAF21p0IJ7b52qqU'),
  35: join('GfF0u5Nv1MEQZlDR', 'jjD3FKDGFhcTJ4CLY7t'),
  36: join('BFXhPG7yJ63XDhIg', '298hMF6Gyc3H6bMCxnm3'),
  37: join('ak5ji7kHf2gnNINu', 'XjtvTGj8vH17tiTSgKhYK'),
  38: join('MX1ErPkk2j8DN93K', 'oqolSNVQ2pNlsdg9e5KPHk'),
  39: join('uCFsFKxVehhpFoo1', 'ajtG2NpoLlijKzZcF8tvcKx'),
};

test('C-6: each random token of 32 to 39 characters is refused (the weak spot of the rule is pinned)', () => {
  // Mutant 39 raised ENTROPY_MIN_LENGTH from 32 to 40 and survived every earlier test, because every
  // token they used was 40 or more characters long.
  for (const [length, token] of Object.entries(RANGE_TOKENS)) {
    assert.equal(token.length, Number(length), `fixture ${length}`);
    assert.equal(typeof sensitiveContentReason(`k = "${token}"\n`), 'string', `${length} characters, quoted`);
    assert.equal(typeof sensitiveContentReason(`| id | ${token} |\n`), 'string', `${length} characters, table cell`);
    assert.equal(typeof sensitiveContentReason(`the key is ${token} today\n`), 'string', `${length} characters, prose`);
  }
});

test('C-6: the length bounds hold: 31 characters load, 256 are refused, 257 are a blob and load', () => {
  assert.equal(sensitiveContentReason(`k = "${RANGE_TOKENS[32].slice(0, 31)}"\n`), null, '31 characters');
  const at256 = randomText('bound-256', ALNUM, 256);
  const at257 = randomText('bound-256', ALNUM, 257);
  assert.equal(typeof sensitiveContentReason(`k = "${at256}"\n`), 'string', '256 characters');
  assert.equal(sensitiveContentReason(`k = "${at257}"\n`), null, '257 characters');
});

test('C-6: the measured slip rates are pinned, so the figures in the module header stay true', () => {
  // The header states the share of random tokens that score under the bar, by length. A fixed SHA-256
  // chain stands in for a random source, so this is a measurement and not a flaky test. The bounds sit
  // above the header's figures (4.6% at 32, 1.1% at 36, 0.4% at 40, 0.6% at 64, measured with 100000
  // samples) by more than the sampling error of 5000 draws.
  const alphabets = { 'base64url': BASE64URL, 'alphanumeric': ALNUM, 'lower case and digits': LOWER_DIGIT, 'upper case and digits': UPPER_DIGIT };
  const bounds = { 32: 0.07, 36: 0.025, 40: 0.012, 64: 0.012 };
  const draws = 5000;
  for (const [name, alphabet] of Object.entries(alphabets)) {
    for (const [length, bound] of Object.entries(bounds)) {
      let slipped = 0;
      for (let i = 0; i < draws; i += 1) {
        if (sensitiveContentReason(`k = "${randomText(`${name}:${length}:${i}`, alphabet, Number(length))}"\n`) === null) slipped += 1;
      }
      assert.ok(slipped / draws <= bound, `${name}, ${length} characters: ${((100 * slipped) / draws).toFixed(2)}% slipped, bound ${100 * bound}%`);
    }
  }
});

test('I-8 r4: the one-case bar is 4.0 bits: a 12-symbol repeating pattern (3.58 bits) loads, a random one-case token is refused', () => {
  // Twelve distinct symbols used evenly score log2(12) = 3.58: an ID pattern or a test string, not key material.
  const pattern = join('k3m9x2p7q4z8'.repeat(3), 'k3m9');
  assert.equal(pattern.length, 40);
  assert.equal(sensitiveContentReason(`id = "${pattern}"\n| id | ${pattern} |\n`), null);
  assert.equal(typeof sensitiveContentReason(`id = "${randomText('one-case-bar', LOWER_DIGIT, 40)}"\n`), 'string');
});

test('I-8 r4: hex is exempt by rule and not by chance: 64 hex digits that use every symbol four times score exactly 4.0 and load', () => {
  // log2(16) = 4.0 reaches the one-case bar, so only the hex test keeps a sha256 digest with an even spread out.
  const even = '9f3a7c1e5b2d8046'.repeat(4);
  assert.equal(even.length, 64);
  assert.equal(sensitiveContentReason(`"${even}"\n| sha256 | ${even} |\n${even}\n`), null);
  assert.equal(sensitiveContentReason(`"${even.toUpperCase()}"\n| sha256 | ${even.toUpperCase()} |\n`), null);
});

test('C-2 r4: a random token behind a long run of words is still found by its own part', () => {
  // The words cover more than half of the run, so the run as a whole is not scored; the token is, as a piece.
  const prefix = 'srv/configuration/deployments/production/environments/';
  for (const length of [36, 40]) {
    const token = length === 36 ? RANGE_TOKENS[36] : TOKEN_40;
    assert.ok(prefix.length > token.length, 'fixture: the prefix is longer than the token');
    assert.equal(typeof sensitiveContentReason(`path: ${prefix}${token}\n`), 'string', `${length} characters`);
    assert.equal(typeof sensitiveContentReason(`| path | ${prefix}${token} |\n`), 'string', `${length} characters, table cell`);
  }
  assert.equal(sensitiveContentReason(`path: ${prefix}index\n`), null);
});

// --- pin tests: the misses the header states --------------------------------------------------

test('C-6: the known misses stay as stated, so the header does not claim more than the code does', () => {
  const miss = (text, why) => assert.equal(sensitiveContentReason(text), null, why);
  miss(`password=${join('hunter', 'xyz')}\n`, 'a password with no digit');
  miss(`k = "${randomText('letters', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 40)}"\n`, 'a 40-character token of letters only');
  miss(`k = "${randomText('short', ALNUM, 31)}"\n`, 'a token of 31 characters');
  miss(`k = "${randomText('hex-miss', '0123456789abcdef', 40)}"\n`, 'a 40-digit hex secret');
  miss(`"integrity": "sha512-${randomText('integrity-512', ALNUM, 86)}=="\n`, 'a 64-byte secret written as a sha512 digest');
  miss(`<img src="data:image/png;base64,${randomText('data-uri', ALNUM, 120)}">\n`, 'a token after a data URI prefix');
  // Words that outweigh the secret cut it into pieces under 32 characters; fewer words leave the run scored whole.
  const cutBy = (words) => `k = "${join(TOKEN_40.slice(0, 22), words, TOKEN_40.slice(22))}"\n`;
  miss(cutBy('-community-support-forum-contributions-guidelines-'), 'a secret cut into pieces by more words than it has characters');
  assert.equal(typeof sensitiveContentReason(cutBy('-community-support-forum-')), 'string', 'a few words do not hide it');
  miss(`k = "${randomText('blob', ALNUM, 300)}"\n`, 'a token over 256 characters');
  miss(`password = "${join('two words ', 'Pr0d')}"\n`, 'a quoted password with a space in it');
  miss(`p = "${join('Pr0d', 'RootPw')}"\n`, 'a secret in a name the keywords do not list');
});

// --- false-positive tests: ordinary code and prose keep loading -------------------------------

test('C-2 r4: identifiers, paths, URLs, ARNs, test names and data URIs of 32 or more characters keep loading', (t) => {
  const files = {
    'src/names.rs': [
      'fn write_atomic_with_mode_uses_the_given_mode_not_the_0o644_default() {}',
      'fn dispatch_install_explicit_harness_kiro_v3_selects_kiro_v3_strategy() {}',
      'fn read_rejects_u64_schema_version_above_i64_max_as_unsupported_not_accepted() {}',
      'fn nat64_well_known_prefix_embedded_ipv4() {}',
    ].join('\n'),
    'src/socks.js': "InvalidSocks5InitialHandshakeNoAcceptedAuthType: 'Received invalid Socks5 initial handshake',\nthis.closeSocket(ERRORS.InvalidSocks5InitialHandshakeUnknownAuthType);\n",
    'src/arn.js': "const arn = 'arn:aws:iam::*:role/aws-service-role/channels.lexv2.amazonaws.com/AWSServiceRoleForLexV2Channels*';\n",
    'docs/advisories.md': 'See https://github.com/advisories/GHSA-9g45-5xwm-f3wc and https://github.com/aws-solutions/konductor/tree/v1\n',
    'docs/workshop.md': 'aws/workshops/00000000-0000-4000-8000-000000000000\n',
    'docs/apple.md': 'http://developer.apple.com/library/mac/#documentation/DeveloperTools/Reference/XcodeBuildSettingRef/1-Build_Setting_Reference/build_setting_ref.html#//apple_ref/doc/uid/TP40003931-CH3-SW153\n',
    'docs/env.md': 'E2E_COGNITO_USER_POOL_ID=us-west-2_ABC123\ntest-analysis-reports/coverage-2025-01-15\ndocs/ui-reviews/2025-01-15-audit\n',
    'docs/manifest.txt': `content_sha256=${randomText('manifest', '0123456789abcdef', 64)}\nsource_commit=${randomText('commit', '0123456789abcdef', 40)}\n`,
    'docs/json.json': `{"imageDigest": "sha256:example${randomText('digest', '0123456789abcdef', 40)}"}\n`,
    'web/index.html': `<link href="data:image/x-icon;base64,${randomText('icon', ALNUM, 90)}=">\n`,
    'web/path.txt': 'WORKDIR/plugins/cache/market/konductor/1\nConsole-CreateStack-7f59c3cf-00d2-40c7-b2ff-e75db0987002\nstream=b79a46f7-1473-4636-a23f-da9c45c208EX\n',
    'package-lock.json': `{"integrity": "sha512-${randomText('lock', ALNUM, 86)}==", "resolved": "https://registry.npmjs.org/x/-/x-1.0.0.tgz"}\n`,
  };
  const root = makeTree(t, files);
  assert.deepEqual(Object.keys(loadSnapshot(root)), Object.keys(files).sort());
});

test('C-2 r4: a name=value pair does not join the label to the value', () => {
  // `package_id=UGFja2FnZS01NzA4OTExNg` is a base64 value of 22 characters behind an 11-character label.
  assert.equal(sensitiveContentReason('package_id=UGFja2FnZS01NzA4OTExNg\n'), null);
  // A long random value behind a label is still judged by itself.
  assert.equal(typeof sensitiveContentReason(`session_key=${TOKEN_40}\n`), 'string');
  assert.equal(typeof sensitiveContentReason(`--api-key-${TOKEN_40}\n`), 'string');
});

// --- scan cost: the unrestricted scan must stay linear ----------------------------------------

test('C-2 r4: hostile files cannot make the widened entropy or PEM scan slow', () => {
  const megabyte = 1024 * 1024;
  const hostile = {
    'one-slash-separated run': `${randomText('slashes', ALNUM, 31)}/`.repeat(megabyte / 32),
    'many 33-character runs': `${randomText('runs', ALNUM, 33)}\n`.repeat(megabyte / 34),
    'many near-structural runs': 'Service-Channels-Handshake-2019-Role\n'.repeat(megabyte / 37),
    'many BEGIN markers and one END': `-----BEGIN CERTIFICATE-----\n${'A'.repeat(20)}\n`.repeat(megabyte / 50) + '-----END CERTIFICATE-----\n',
    'many BEGIN markers and no END': '-----BEGIN CERTIFICATE-----\n'.repeat(megabyte / 27),
    'many closed blocks': `-----BEGIN CERTIFICATE-----\n${'A'.repeat(20)}\n-----END CERTIFICATE-----\n`.repeat(megabyte / 70),
    'long base64 body in one block': `-----BEGIN CERTIFICATE-----\n${randomText('body', ALNUM, megabyte / 2)}\n-----END CERTIFICATE-----\n`,
    'many PGP-looking blocks': '-----BEGIN PGP MESSAGE-----\n\nAAAA\n=AAAA\n-----END PGP MESSAGE-----\n'.repeat(megabyte / 64),
    'many equals and slashes': '=/'.repeat(megabyte / 2),
  };
  for (const [label, text] of Object.entries(hostile)) {
    const started = Date.now();
    sensitiveContentReason(text);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 5000, `${label} took ${elapsed} ms`);
  }
});

// --- what was refused before is refused now ---------------------------------------------------

test('C-6: the names, formats and pins refused before this change are refused now', (t) => {
  const named = {
    '.env': 'MODE=test\n',
    '.aws/credentials': '[default]\n',
    id_rsa: 'x\n',
    'certs/server.pem': 'x\n',
    'backup/key.bak': join('-----BEGIN OPENSSH ', 'PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----\n'),
    'deploy.txt': join('AKIA', 'IOSFODNN7EXAMPLE\n'),
    '.env.': 'MODE=test\n',
    'id_rsa.': 'x\n',
    '.aws./credentials': '[default]\n',
  };
  for (const [relative, content] of Object.entries(named)) {
    const root = makeTree(t, { [relative]: content });
    assert.throws(() => loadSnapshot(root), new RegExp(`refusing to load ${escapeRegExp(relative)}`), relative);
  }
  // A private key wrapped like a certificate is still a private key.
  assert.equal(typeof sensitiveContentReason(join('-----BEGIN RSA ', 'PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----\n')), 'string');
  // The digest pin: the pinned bytes load, anything else at the path is scanned, including the new rules.
  const fixture = Buffer.from(`NOTE=1\n${join('pass', 'word')}=${join('$uper', 'S3cret!')}\n`);
  const pin = { path: 'fixtures/fake.env', sha256: contentDigest(fixture) };
  const pristine = makeTree(t, { 'fixtures/fake.env': fixture });
  assert.deepEqual(Object.keys(loadSnapshot(pristine, { allowSensitive: [pin] })), ['fixtures/fake.env']);
  const edited = makeTree(t, { 'fixtures/fake.env': Buffer.concat([fixture, Buffer.from(`| aws | ${AWS_SECRET} |\n`)]) });
  assert.throws(() => loadSnapshot(edited, { allowSensitive: [pin] }), /refusing to load fixtures\/fake\.env: its content holds /);
});
