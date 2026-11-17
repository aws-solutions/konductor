// SPDX-License-Identifier: Apache-2.0
// Tests for the retry helper (lib/retry.js). The pause is a fake sleep that records its argument, so no test waits.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  withRetry,
  classifyError,
  retryDelayMs,
  createBreaker,
  CallError,
  SystemicFailureError,
} = require('../../../scripts/bench/lib/retry');
const { SpendStopError } = require('../../../scripts/bench/lib/ledger');
const { createRedactor } = require('../../../scripts/bench/lib/redact');

const AKID = ['AK', 'IA'].join('') + 'Q'.repeat(16);
const makeError = (message) => new Error(message);
const TRANSIENT = [
  makeError('Request timed out after 720000 ms'),
  makeError('ThrottlingException: Rate exceeded'),
  makeError('HTTP 429 Too Many Requests'),
  makeError('socket hang up'),
  'a bare string',
  undefined,
];
const CREDENTIAL = [
  makeError(
    'ExpiredTokenException: The security token included in the request is expired',
  ),
  makeError('Unable to locate credentials'),
  makeError('Could not load credentials from any providers'),
  makeError(
    'SignatureDoesNotMatch: The request signature we calculated does not match',
  ),
  makeError('InvalidSignatureException: Signature expired'),
  makeError(
    'AuthFailure: AWS was not able to validate the provided access credentials',
  ),
  makeError('Missing Authentication Token'),
  // Texts the CLIs printed in live runs, with no exception name in them.
  makeError('AWS SigV4 authentication requires AWS credentials'),
  // The AWS SSO login behind a profile: the session ran out or could not be refreshed.
  makeError(
    'The SSO session associated with this profile has expired or is otherwise invalid. To refresh this SSO session run aws sso login with the corresponding profile.',
  ),
  makeError('Token has expired and refresh failed'),
  makeError('the sso session is gone'),
  makeError('refresh failed'),
  // "unauthorized" and 401 count only in an AWS shape.
  makeError('UnrecognizedClientException: HTTP 401'),
  makeError('401 Unauthorized: InvalidSignatureException'),
  makeError(
    'UnauthorizedOperation: You are not authorized to perform this operation',
  ),
  makeError('Unauthorized: User is not authorized to perform sts:AssumeRole'),
];
// "401" and "unauthorized" from some other tool (a package registry, a Git host) are not an AWS credential problem:
// they stay transient, so a job does not stop everything for them.
const NOT_CREDENTIAL = [
  makeError('HTTP 401 Unauthorized'),
  makeError('Request failed with status 401'),
  makeError('Unauthorized'),
  makeError('npm ERR! 401 Unauthorized - GET https://registry.example/pkg'),
];
// Calls that can never work as they are. Paying for a second try would only buy the same answer.
const PERMANENT = [
  makeError(
    'AccessDeniedException: User is not authorized to perform bedrock:InvokeModel',
  ),
  makeError('ValidationException: The provided model identifier is invalid'),
  makeError(
    'ResourceNotFoundException: Could not resolve the foundation model',
  ),
  makeError('spawn opencode ENOENT'),
  makeError("EACCES: permission denied, open '/x/y'"),
  makeError('The provided model identifier is invalid.'),
  makeError(
    'Access denied. You do not have access to the model with the specified model ID.',
  ),
  makeError("You don't have access to the model with the specified model ID."),
  makeError('Error: Model not found: amazon-bedrock/foo'),
];
const REFUSAL = [
  makeError('The provider blocked the response'),
  makeError('stop_reason: "refusal"'),
  makeError('blocked by the content filtering policy'),
];

test('classifyError: fatal, credential, refusal, and everything else (timeout, throttle, unknown) is transient', () => {
  const rows = [
    ...TRANSIENT.map((error) => [error, 'transient']),
    ...CREDENTIAL.map((error) => [error, 'credential']),
    ...NOT_CREDENTIAL.map((error) => [error, 'transient']),
    ...REFUSAL.map((error) => [error, 'refusal']),
    ...PERMANENT.map((error) => [error, 'permanent']),
    [new SpendStopError('over', 'total_cap_usd'), 'fatal'],
    [Object.assign(makeError('timed out'), { fatal: true }), 'fatal'],
  ];
  for (const [error, kind] of rows)
    assert.equal(
      classifyError(error),
      kind,
      String(error && error.message ? error.message : error),
    );
});

test('retryDelayMs: none before the first try, then the base doubling up to the cap', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 30].map((attempt) => retryDelayMs(attempt)),
    [0, 5000, 10000, 20000, 40000, 60000, 60000, 60000],
  );
  assert.deepEqual(
    [
      retryDelayMs(3, { baseMs: 100, maxMs: 150 }),
      retryDelayMs(2, { baseMs: 0 }),
      retryDelayMs(0),
    ],
    [150, 0, 0],
  );
});

/** Runs withRetry over a script: each entry is an Error to throw or a value to return. Returns what happened. */
async function driveRetry(script, options = {}) {
  const calls = [];
  const pauses = [];
  const call = async (attempt) => {
    calls.push(attempt);
    const step = script[Math.min(calls.length, script.length) - 1];
    if (step instanceof Error) throw step;
    return step;
  };
  try {
    return {
      value: await withRetry(call, {
        sleep: async (delayMs) => pauses.push(delayMs),
        ...options,
      }),
      calls,
      pauses,
    };
  } catch (error) {
    return { error, calls, pauses };
  }
}

test('success needs one try and no pause; a transient failure is retried after a growing pause', async () => {
  assert.deepEqual(await driveRetry(['ok']), {
    value: 'ok',
    calls: [1],
    pauses: [],
  });
  assert.deepEqual(
    await driveRetry([makeError('timed out'), makeError('throttled'), 'ok']),
    { value: 'ok', calls: [1, 2, 3], pauses: [5000, 10000] },
  );
});

test('transient failures stop at the attempt limit with a CallError that is not fatal', async () => {
  const outcome = await driveRetry([makeError('timed out')]);
  assert.deepEqual(
    [
      outcome.calls,
      outcome.pauses,
      outcome.error instanceof CallError,
      outcome.error.kind,
      outcome.error.attempts,
      outcome.error.fatal,
    ],
    [[1, 2, 3], [5000, 10000], true, 'transient', 3, false],
  );
  assert.equal(
    (await driveRetry([makeError('timed out')], { attempts: 1 })).pauses.length,
    0,
  );
  assert.deepEqual(
    (
      await driveRetry([makeError('timed out')], {
        attempts: 5,
        baseMs: 10,
        maxMs: 25,
      })
    ).pauses,
    [10, 20, 25, 25],
  );
});

test('a credential error is never retried and stops everything (fatal)', async () => {
  for (const credentialError of CREDENTIAL) {
    const outcome = await driveRetry([credentialError, 'ok']);
    assert.deepEqual(
      [outcome.calls, outcome.pauses, outcome.error.kind, outcome.error.fatal],
      [[1], [], 'credential', true],
    );
  }
});

test('a permanent error is not retried, so it is not paid for twice, and it is not fatal', async () => {
  for (const permanentError of PERMANENT) {
    const outcome = await driveRetry([permanentError, 'ok']);
    assert.deepEqual(
      [
        outcome.calls,
        outcome.pauses,
        outcome.error instanceof CallError,
        outcome.error.kind,
        outcome.error.attempts,
        outcome.error.fatal,
      ],
      [[1], [], true, 'permanent', 1, false],
      permanentError.message,
    );
  }
});

test('permanent errors do not feed the breaker, so they never end a job as a systemic failure; transient ones still do', async () => {
  const breaker = createBreaker();
  for (let call = 0; call < 10; call++) {
    const outcome = await driveRetry([PERMANENT[0]], { breaker });
    assert.equal(outcome.error.kind, 'permanent');
  }
  assert.equal(breaker.streak, 0);
  let stopped;
  for (let call = 0; call < 4 && !stopped; call++) {
    const outcome = await driveRetry([makeError('timed out')], { breaker });
    if (outcome.error instanceof SystemicFailureError) stopped = call + 1;
  }
  assert.equal(stopped, 4, 'four calls that fail every try still stop the job');
});

test('a fatal error from the call (a spend STOP) is rethrown as it is, never retried', async () => {
  const stop = new SpendStopError('over', 'total_cap_usd');
  const outcome = await driveRetry([stop, 'ok']);
  assert.deepEqual([outcome.error, outcome.calls], [stop, [1]]);
});

test('a provider block is tried twice at most, not fatal; a repeat that succeeds is accepted', async () => {
  const outcome = await driveRetry([
    makeError('The provider blocked the response'),
  ]);
  assert.deepEqual(
    [
      outcome.calls,
      outcome.pauses,
      outcome.error.kind,
      outcome.error.attempts,
      outcome.error.fatal,
    ],
    [[1, 2], [5000], 'refusal', 2, false],
  );
  assert.deepEqual(
    (await driveRetry([makeError('stop_reason: "refusal"'), 'ok'])).value,
    'ok',
  );
  assert.deepEqual(
    (
      await driveRetry([makeError('stop_reason: "refusal"')], {
        maxRefusals: 1,
      })
    ).calls,
    [1],
  );
  assert.deepEqual(
    (
      await driveRetry([makeError('stop_reason: "refusal"')], {
        maxRefusals: 9,
        attempts: 1,
      })
    ).calls,
    [1],
    'the attempt limit also ends it',
  );
});

test('messages in a thrown CallError are redacted and capped, and the original error is not attached', async () => {
  const outcome = await driveRetry([
    makeError(`failed with ${AKID} ${'z'.repeat(2000)}`),
  ]);
  assert.ok(
    !outcome.error.message.includes(AKID) &&
      outcome.error.message.includes('[REDACTED_AWS_KEY_ID]'),
  );
  assert.ok(
    outcome.error.message.length < 700 && outcome.error.cause === undefined,
  );
  assert.ok(
    !(
      await driveRetry([makeError(`Unable to locate credentials ${AKID}`)])
    ).error.message.includes(AKID),
  );
});

test('a run redactor passed as redact cleans a bare value with no secret shape, in every kind of CallError and in the breaker', async () => {
  const bare = 'plain-handed-out-value-91';
  const redact = createRedactor({ literals: [bare] });
  assert.ok(
    (
      await driveRetry([makeError(`failed with ${bare}`)])
    ).error.message.includes(bare),
    'the module redactor does not know a bare value',
  );
  const scripts = {
    transient: makeError(`timed out for ${bare}`),
    permanent: makeError(`AccessDeniedException ${bare}`),
    refusal: makeError(`The provider blocked the response ${bare}`),
    credential: makeError(`Unable to locate credentials ${bare}`),
  };
  for (const [kind, error] of Object.entries(scripts)) {
    const outcome = await driveRetry([error], { redact, maxRefusals: 1 });
    assert.equal(outcome.error.kind, kind);
    assert.ok(
      !outcome.error.message.includes(bare) &&
        outcome.error.message.includes('[REDACTED]'),
      `${kind}: ${outcome.error.message}`,
    );
  }
  const breaker = createBreaker({ after: 2, redact });
  breaker.recordFailure(`last: ${bare}`);
  assert.throws(
    () => breaker.recordFailure(`last: ${bare}`),
    (error) =>
      error instanceof SystemicFailureError &&
      !error.message.includes(bare) &&
      error.message.includes('[REDACTED]'),
  );
  const viaRetry = createBreaker({ after: 1, redact });
  const outcome = await driveRetry([makeError(`timed out ${bare}`)], {
    breaker: viaRetry,
    redact,
    attempts: 1,
  });
  assert.ok(
    outcome.error instanceof SystemicFailureError &&
      !outcome.error.message.includes(bare),
  );
});

test('withRetry rejects an attempt limit that is not a whole number of 1 or more', async () => {
  for (const attempts of [0, 1.5, '3', -1])
    await assert.rejects(
      withRetry(async () => 1, { attempts }),
      TypeError,
    );
});

// Each letter is one call: F fails every try, O succeeds, R is blocked by the provider.
// A refusal neither counts toward the streak nor resets it. [calls, index of the call that trips the breaker or null]
const STREAKS = [
  ['FFF', null],
  ['FFFF', 3],
  ['FFFOFFF', null],
  ['FFFOFFFF', 7],
  ['FFRFF', 4],
  ['FFROFFF', null],
];
for (const [calls, trips] of STREAKS) {
  test(`breaker: ${calls} ${trips === null ? 'does not trip' : `trips on call ${trips + 1}`}`, async () => {
    const breaker = createBreaker();
    const script = {
      F: makeError('timed out'),
      O: 'ok',
      R: makeError('The provider blocked the response'),
    };
    let tripped = null;
    for (const [index, letter] of [...calls].entries()) {
      const outcome = await driveRetry([script[letter]], {
        breaker,
        attempts: 2,
        maxRefusals: 1,
      });
      if (outcome.error instanceof SystemicFailureError) {
        tripped = index;
        assert.deepEqual(
          [
            outcome.error.fatal,
            /^ABORT-SYSTEMIC: 4 calls in a row failed every try/.test(
              outcome.error.message,
            ),
          ],
          [true, true],
        );
        break;
      }
    }
    assert.equal(tripped, trips);
  });
}
