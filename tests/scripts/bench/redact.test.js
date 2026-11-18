// SPDX-License-Identifier: Apache-2.0
// Tests for the redactor (lib/redact.js). Every secret below is built at run time from pieces, so no
// credential-shaped string sits in the source, and none is a real value.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  newCanary,
  cutAtCodePoint,
  createRedactor,
  redact,
  classifySecrets,
  CANARY_ENV,
  INPUT_CEILING,
} = require('../../../scripts/bench/lib/redact');

const AKID = ['AK', 'IA'].join('') + 'Q'.repeat(16);
const SECRET = 'Zk'.repeat(20);
const LONG = 'T'.repeat(120);
const STS = ['IQoJb3', 'JpZ2lu'].join('') + 'x'.repeat(80);
const BED = ['AB', 'SK'].join('') + 'k'.repeat(30);
const CANARY_HEX_DIGITS = 'ab12'.repeat(8);
const CANARY = `${['bench', 'canary'].join('-')}-${CANARY_HEX_DIGITS}`;

// [name, input, expected output]
const REDACTED = [
  ['access key id', `key ${AKID} used`, 'key [REDACTED_AWS_KEY_ID] used'],
  [
    'temporary key id, after an underscore',
    `id_${['AS', 'IA'].join('')}${'7'.repeat(16)}`,
    'id_[REDACTED_AWS_KEY_ID]',
  ],
  [
    'secret key, env style',
    `AWS_SECRET_ACCESS_KEY=${SECRET}`,
    'AWS_SECRET_ACCESS_KEY=[REDACTED]',
  ],
  [
    'secret key, JSON style',
    `"SecretAccessKey": "${SECRET}"`,
    '"SecretAccessKey": "[REDACTED]"',
  ],
  [
    'secret key, name at the end of a longer variable',
    `MY_AWS_SECRET_ACCESS_KEY=${SECRET}`,
    'MY_AWS_SECRET_ACCESS_KEY=[REDACTED]',
  ],
  [
    'secret key, Terraform variable',
    `TF_VAR_aws_secret_access_key=${SECRET}`,
    'TF_VAR_aws_secret_access_key=[REDACTED]',
  ],
  [
    'secret key, camelCase JSON',
    `{"awsSecretAccessKey":"${SECRET}"}`,
    '{"awsSecretAccessKey":"[REDACTED]"}',
  ],
  [
    'session token, name at the end of a longer variable',
    `X_AWS_SESSION_TOKEN=${LONG}`,
    'X_AWS_SESSION_TOKEN=[REDACTED]',
  ],
  [
    'Bedrock key, name at the end of a longer variable',
    `export X_AWS_BEARER_TOKEN_BEDROCK=${'q'.repeat(30)}`,
    'export X_AWS_BEARER_TOKEN_BEDROCK=[REDACTED]',
  ],
  [
    'session token, named',
    `aws_session_token = ${LONG}`,
    'aws_session_token = [REDACTED]',
  ],
  [
    'session token, header',
    `x-amz-security-token: ${LONG}`,
    'x-amz-security-token: [REDACTED]',
  ],
  [
    'session token, STS prefix alone',
    `see ${STS} here`,
    'see [REDACTED_SESSION_TOKEN] here',
  ],
  ['Bedrock key', `key ${BED}`, 'key [REDACTED_BEDROCK_KEY]'],
  [
    'Bedrock key, env style',
    `AWS_BEARER_TOKEN_BEDROCK=${'q'.repeat(30)}`,
    'AWS_BEARER_TOKEN_BEDROCK=[REDACTED]',
  ],
  [
    'bearer token',
    `Authorization: Bearer ${LONG}`,
    'Authorization: Bearer [REDACTED]',
  ],
  [
    'bearer, lower case, JWT shape',
    `bearer ${'a'.repeat(10)}.${'b'.repeat(10)}.${'c'.repeat(10)}`,
    'Bearer [REDACTED]',
  ],
  ['canary', `leaked ${CANARY} ok`, 'leaked [REDACTED_CANARY] ok'],
  [
    'two in one string',
    `${AKID} and ${AKID}`,
    '[REDACTED_AWS_KEY_ID] and [REDACTED_AWS_KEY_ID]',
  ],
];
for (const [name, input, expected] of REDACTED)
  test(`redact: ${name}`, () => assert.equal(redact(input), expected));

// Near misses stay as written: too short, wrong case, a name with no value, ordinary prose.
const UNCHANGED = [
  ['key id one character short', ['AK', 'IA'].join('') + 'Q'.repeat(15)],
  ['key id one character long', ['AK', 'IA'].join('') + 'Q'.repeat(17)],
  ['key id in lower case', ['ak', 'ia'].join('') + 'q'.repeat(16)],
  ['key id glued to a capital letter before it', `X${AKID}`],
  [
    'secret key one character short',
    `AWS_SECRET_ACCESS_KEY=${SECRET.slice(1)}`,
  ],
  ['session token one character short', `aws_session_token=${LONG.slice(21)}`],
  [
    'bare variable names',
    'Set AWS_SESSION_TOKEN and AWS_SECRET_ACCESS_KEY before you run it.',
  ],
  [
    'a name with an empty value',
    'AWS_SESSION_TOKEN= and AWS_BEARER_TOKEN_BEDROCK=',
  ],
  ['a name assigned from code', 'aws_secret_access_key = os.environ["SECRET"]'],
  [
    'placeholder values',
    'export AWS_SESSION_TOKEN=$TOKEN; AWS_SECRET_ACCESS_KEY=<your-secret>',
  ],
  [
    'the word bearer in prose',
    'Bearer token auth; a bearer of news; Bearer short',
  ],
  ['Bedrock prefix one short', ['AB', 'SK'].join('') + 'k'.repeat(19)],
  [
    'STS prefix with a short tail',
    ['IQoJb3', 'JpZ2lu'].join('') + 'x'.repeat(39),
  ],
  [
    'canary-like, too few hex digits',
    `bench-canary-${CANARY_HEX_DIGITS.slice(1, 16)}`,
  ],
  ['the canary variable name', `${CANARY_ENV} holds a random value`],
];
for (const [name, input] of UNCHANGED)
  test(`redact leaves alone: ${name}`, () =>
    assert.equal(redact(input), input));

test('redact: null and undefined become an empty string, other values are stringified, and a second pass changes nothing', () => {
  assert.deepEqual(
    [redact(null), redact(undefined), redact(42)],
    ['', '', '42'],
  );
  const once = redact(
    `${AKID} AWS_SECRET_ACCESS_KEY=${SECRET} Bearer ${LONG} ${CANARY}`,
  );
  assert.equal(redact(once), once);
});

test('exact values: every copy is removed, the longest first; a short or non-string value is refused', () => {
  const redactWithLiterals = createRedactor({
    literals: ['handed-out-1234', 'handed-out-1234-extra'],
  });
  assert.equal(
    redactWithLiterals('a handed-out-1234-extra b handed-out-1234'),
    'a [REDACTED] b [REDACTED]',
  );
  for (const invalidLiteral of ['short', '', 12345678, null])
    assert.throws(
      () => createRedactor({ literals: [invalidLiteral] }),
      TypeError,
    );
});

test('size caps: output is cut after redaction, a secret on the cut is gone, and oversize input is dropped whole', () => {
  assert.equal(redact('a'.repeat(4000)), 'a'.repeat(4000));
  assert.equal(
    redact('a'.repeat(4005)),
    `${'a'.repeat(4000)}[truncated 5 characters]`,
  );
  assert.equal(
    redact('b'.repeat(10), { maxChars: 4 }),
    'bbbb[truncated 6 characters]',
  );
  assert.equal(
    redact('x'.repeat(3990) + AKID),
    `${'x'.repeat(3990)}[REDACTED_[truncated 11 characters]`,
  );
  assert.equal(redact('y'.repeat(9000), { maxChars: Infinity }).length, 9000);
  assert.equal(
    redact('z'.repeat(INPUT_CEILING + 1)),
    `[REDACTED: ${INPUT_CEILING + 1} characters is too long to scan]`,
  );
});

test('cutAtCodePoint: the cut never ends inside a surrogate pair', () => {
  const emoji = '\u{1F600}'; // two UTF-16 units
  assert.equal(emoji.length, 2);
  assert.equal(cutAtCodePoint('abc', 3), 'abc');
  assert.equal(cutAtCodePoint('abcdef', 3), 'abc');
  assert.equal(
    cutAtCodePoint(`ab${emoji}cd`, 3),
    'ab',
    'a pair on the cut goes whole',
  );
  assert.equal(
    cutAtCodePoint(`ab${emoji}cd`, 4),
    `ab${emoji}`,
    'a pair that fits stays',
  );
  assert.equal(cutAtCodePoint(`ab${emoji}cd`, 5), `ab${emoji}c`);
  assert.equal(
    cutAtCodePoint(`${emoji}${emoji}`, 1),
    '',
    'a limit that splits the first pair leaves nothing',
  );
  assert.equal(cutAtCodePoint(`${emoji}ab`, 0), '');
  assert.equal(cutAtCodePoint(`ab${emoji}`, Infinity), `ab${emoji}`);
  assert.equal(cutAtCodePoint('', 0), '');
  for (let limit = 0; limit <= 8; limit++) {
    const cut = cutAtCodePoint(`a${emoji}b${emoji}c${emoji}`, limit);
    assert.ok(cut.length <= limit);
    assert.equal(
      cut,
      cut.toWellFormed(),
      `limit ${limit} leaves no lone surrogate`,
    );
  }
});

test('cutAtCodePoint: a lone surrogate already in the text is kept, and only a split pair is dropped', () => {
  assert.equal(
    cutAtCodePoint('ab\ud83dcd', 3),
    'ab\ud83d',
    'a lone high half followed by a letter',
  );
  assert.equal(cutAtCodePoint('ab\ude00cd', 3), 'ab\ude00', 'a lone low half');
  assert.equal(
    cutAtCodePoint('ab\ud83d', 3),
    'ab\ud83d',
    'text that fits is returned as it is',
  );
  assert.equal(
    cutAtCodePoint('ab\ud83d\ud83dcd', 3),
    'ab\ud83d',
    'two high halves in a row',
  );
  assert.equal(
    cutAtCodePoint('\ude00\ud83d\ude00', 2),
    '\ude00',
    'a low half, then a pair split in the middle',
  );
});

test('cutAtCodePoint: the first and the last pair of the surrogate ranges are kept whole too', () => {
  const lowest = '\u{10000}'; // \ud800\udc00
  const highest = '\u{10FFFF}'; // \udbff\udfff
  assert.equal(lowest, '\ud800\udc00');
  assert.equal(highest, '\udbff\udfff');
  assert.equal(cutAtCodePoint(`a${lowest}b`, 2), 'a');
  assert.equal(cutAtCodePoint(`a${highest}b`, 2), 'a');
  assert.equal(cutAtCodePoint(`a${lowest}${highest}`, 3), `a${lowest}`);
  assert.equal(cutAtCodePoint(`a${highest}${lowest}`, 3), `a${highest}`);
});

test('cutAtCodePoint: a lone low half after the cut, or a lone high half before a letter, is not a split pair', () => {
  assert.equal(cutAtCodePoint('abc\ude00d', 3), 'abc');
  assert.equal(cutAtCodePoint('ab\ud83dc', 3), 'ab\ud83d');
  assert.equal(cutAtCodePoint('ab\ud83d', 3), 'ab\ud83d');
});

test('cutAtCodePoint: a limit that is not a whole number of 0 or more is a TypeError', () => {
  for (const limit of [-1, 1.5, NaN, '3', null, undefined])
    assert.throws(() => cutAtCodePoint('abcdef', limit), TypeError);
});

test('size caps: a cut that falls inside an emoji drops it whole and counts what was dropped', () => {
  const emoji = '\u{1F600}';
  const cut = redact(`${'a'.repeat(3999)}${emoji}tail`);
  assert.equal(cut, `${'a'.repeat(3999)}[truncated 6 characters]`);
  assert.equal(cut, cut.toWellFormed());
  assert.equal(
    redact(`ab${emoji}cd`, { maxChars: 3 }),
    'ab[truncated 4 characters]',
  );
  assert.equal(
    redact(`ab${emoji}cd`, { maxChars: 4 }),
    `ab${emoji}[truncated 2 characters]`,
  );
});

test('size caps: a limit below 0 is refused instead of cutting from the end', () => {
  assert.throws(() => redact('abcdef', { maxChars: -2 }), TypeError);
});

test('newCanary: fresh each time, found by the redactor and by classifySecrets', () => {
  const [firstCanary, secondCanary] = [newCanary(), newCanary()];
  assert.notEqual(firstCanary, secondCanary);
  assert.match(firstCanary, /^bench-canary-[0-9a-f]{32}$/);
  assert.equal(redact(`x ${firstCanary} y`), 'x [REDACTED_CANARY] y');
  assert.deepEqual(classifySecrets(`${firstCanary} ${secondCanary}`).stop, {
    canary: 2,
  });
});

// classifySecrets: the stop tier is only what the run itself knows; shapes are flagged; documented examples are examples.
test('classifySecrets: stop is the canary and exact literals, flag is any other secret shape, example is a documented value', () => {
  const {
    classifySecrets,
    KNOWN_EXAMPLES,
  } = require('../../../scripts/bench/lib/redact');
  const canary = newCanary();
  const jwt =
    'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl';
  const text = `${AKID} ${jwt} ${KNOWN_EXAMPLES[0]} AWS_SECRET_ACCESS_KEY=${KNOWN_EXAMPLES[1]} ${canary} handed-out-1234`;
  assert.deepEqual(classifySecrets(text, ['handed-out-1234']), {
    stop: { canary: 1, literal: 1 },
    flag: { aws_key_id: 1, bearer: 1 },
    example: { aws_key_id: 1, secret_key: 1 },
  });
  assert.deepEqual(classifySecrets(`${jwt}\nSet AWS_SESSION_TOKEN first.`), {
    stop: {},
    flag: { bearer: 1 },
    example: {},
  });
  assert.deepEqual(classifySecrets('nothing here'), {
    stop: {},
    flag: {},
    example: {},
  });
  assert.throws(() => classifySecrets('x', ['short']), TypeError);
});

test('classifySecrets: an example value only counts when it is the whole value, and the redactor still replaces it', () => {
  const {
    classifySecrets,
    KNOWN_EXAMPLES,
  } = require('../../../scripts/bench/lib/redact');
  assert.deepEqual(
    classifySecrets(`AWS_SECRET_ACCESS_KEY=${KNOWN_EXAMPLES[1]}ZZZZ`).flag,
    { secret_key: 1 },
  );
  assert.deepEqual(classifySecrets(`${KNOWN_EXAMPLES[0]}`).example, {
    aws_key_id: 1,
  });
  assert.equal(
    redact(KNOWN_EXAMPLES[0]),
    '[REDACTED_AWS_KEY_ID]',
    'stored text keeps no key-shaped value',
  );
  assert.ok(KNOWN_EXAMPLES.every((example) => example.includes('EXAMPLE')));
});
