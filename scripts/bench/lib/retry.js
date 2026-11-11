// SPDX-License-Identifier: Apache-2.0
/**
 * Retry helper for a model call. `withRetry(call)` runs call(attempt) and sorts a failure into a class:
 *
 *   fatal       the error says so (`error.fatal`: a spend STOP, a ledger error). Rethrown as it is, never retried.
 *   credential  AWS credentials missing or expired, or a request signature the provider rejects. Never retried.
 *               Thrown as a fatal CallError: stop everything.
 *   refusal     the provider blocked the reply. A retry gives the same block, so the call is tried at most
 *               `maxRefusals` times (2: the block, then one repeat to confirm it), then thrown as a CallError.
 *   permanent   the call can never work as it is: access denied, a request the provider calls invalid, a model or
 *               file that does not exist. Not retried, so it is not paid for again, and thrown at once as a CallError
 *               that is not fatal. It is not counted by the breaker, because it is not bad luck.
 *   transient   anything else, including a timeout or a throttle. Retried with a growing pause, up to `attempts`
 *               tries (3: the call and 2 retries). The last failure is thrown as a CallError.
 *
 * The pause before try n is 0 for n = 1, then `baseMs` doubling per try up to `maxMs`.
 *
 * A breaker shared by the calls of one job turns "4 calls in a row failed every try" into a fatal
 * SystemicFailureError (a credential or provider problem, not bad luck). A refusal means the provider answered,
 * so it neither counts nor resets the streak. There is no retry budget shared across calls.
 *
 * Classes are matched on the error's message text, by the exception names and by phrases the CLIs print (for example
 * "requires AWS credentials" or "The provided model identifier is invalid"). A message that matches none is transient.
 *
 * Every message in a thrown CallError and SystemicFailureError passes through the redactor; the original error is not
 * attached. A fatal error from the call is rethrown as it is.
 */
'use strict';

const { redact } = require('./redact');

const BASE_MS = 5000;
const MAX_MS = 60000;
const ATTEMPTS = 3;
// Refusals are counted inside one withRetry call: a caller that runs the same call again starts a new count.
const MAX_REFUSALS = 2;
const SYSTEMIC_AFTER = 4;
const MESSAGE_CHARS = 500;

const CREDENTIAL =
  /could not load credentials|credential chain failed|nocredentials|expiredtoken|expired token|security token (included in the request )?is (expired|invalid)|unrecognizedclientexception|invalidclienttokenid|unable to locate credentials|signaturedoesnotmatch|invalidsignature|authfailure|missing authentication token|requires aws credentials|unauthorized|\bhttp\s*401\b/i;
const REFUSAL =
  /provider blocked the response|safeguards flagged|content filtering policy|stop_reason["':\s]*refusal/i;

const PERMANENT =
  /accessdenied|access denied|do(?:n't| not) have access to the model|validationexception|model identifier is invalid|resourcenotfound|model not found|\bENOENT\b|\bEACCES\b/i;

/** A call that failed for good. `kind` is credential, refusal, permanent or transient; only a credential failure is fatal. */
class CallError extends Error {
  constructor(kind, message, attempts) {
    super(message);
    this.name = 'CallError';
    this.kind = kind;
    this.attempts = attempts;
    this.fatal = kind === 'credential';
  }
}
/** Too many calls in a row failed every try. */
class SystemicFailureError extends Error {
  constructor(message) {
    super(`ABORT-SYSTEMIC: ${message}`);
    this.name = 'SystemicFailureError';
    this.fatal = true;
  }
}

/** fatal, credential, refusal, permanent or transient (the default for any other error). */
function classifyError(error) {
  if (error && error.fatal) return 'fatal';
  const message = String((error && error.message) || error || '');
  if (CREDENTIAL.test(message)) return 'credential';
  if (REFUSAL.test(message)) return 'refusal';
  return PERMANENT.test(message) ? 'permanent' : 'transient';
}

/** Milliseconds to wait before try number `attempt` (1 is the first try): 0, baseMs, 2 x baseMs, ... up to maxMs. */
const retryDelayMs = (attempt, { baseMs = BASE_MS, maxMs = MAX_MS } = {}) =>
  attempt <= 1 || baseMs <= 0
    ? 0
    : Math.min(baseMs * 2 ** (attempt - 2), maxMs);

/** Counts calls in a row that failed every try. recordFailure() throws SystemicFailureError at `after`; recordSuccess() resets. */
function createBreaker({ after = SYSTEMIC_AFTER } = {}) {
  let streak = 0;
  return {
    recordSuccess: () => {
      streak = 0;
    },
    recordFailure(message) {
      if (++streak >= after)
        throw new SystemicFailureError(
          `${streak} calls in a row failed every try (last: ${message}). The backend or the credentials are likely at fault; not retrying. Work the caller already stored is kept.`,
        );
    },
    get streak() {
      return streak;
    },
  };
}

const sleepForMs = (delayMs) =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

async function withRetry(
  call,
  {
    attempts = ATTEMPTS,
    maxRefusals = MAX_REFUSALS,
    baseMs = BASE_MS,
    maxMs = MAX_MS,
    sleep = sleepForMs,
    breaker,
    classify = classifyError,
  } = {},
) {
  if (!Number.isInteger(attempts) || attempts < 1)
    throw new TypeError(
      'withRetry: attempts must be a whole number, 1 or more',
    );
  let refusals = 0;
  for (let attempt = 1; ; attempt++) {
    try {
      const value = await call(attempt);
      if (breaker) breaker.recordSuccess();
      return value;
    } catch (error) {
      const kind = classify(error);
      if (kind === 'fatal') throw error;
      const message = redact((error && error.message) || error, {
        maxChars: MESSAGE_CHARS,
      });
      const isLastAttempt = attempt >= attempts;
      if (kind === 'credential')
        throw new CallError(
          'credential',
          `AWS credentials missing or expired: ${message}`,
          attempt,
        );
      if (kind === 'permanent')
        throw new CallError(
          'permanent',
          `the call can never work as it is, so it was not retried: ${message}`,
          attempt,
        );
      if (kind === 'refusal') {
        refusals += 1;
        if (isLastAttempt || refusals >= maxRefusals)
          throw new CallError(
            'refusal',
            `the provider blocked the reply ${refusals} time(s): ${message}`,
            attempt,
          );
      } else if (isLastAttempt) {
        if (breaker) breaker.recordFailure(message);
        throw new CallError(
          'transient',
          `the call failed ${attempt} time(s): ${message}`,
          attempt,
        );
      }
      await sleep(retryDelayMs(attempt + 1, { baseMs, maxMs }));
    }
  }
}

module.exports = {
  BASE_MS,
  MAX_MS,
  ATTEMPTS,
  MAX_REFUSALS,
  SYSTEMIC_AFTER,
  CallError,
  SystemicFailureError,
  classifyError,
  retryDelayMs,
  createBreaker,
  withRetry,
};
