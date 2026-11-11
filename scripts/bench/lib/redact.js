// SPDX-License-Identifier: Apache-2.0
/**
 * Redactor. A caller passes error text, log lines and answers through it before they are stored or shown. It
 * replaces:
 *
 *   AWS access key ids, secret access keys, session tokens (named, or the base64 prefix of an STS token),
 *   Bedrock API keys, bearer tokens, the run's canary, and any exact value the caller lists (`literals`).
 *
 * A pattern needs a value of real secret length, so prose that only names a variable (AWS_SESSION_TOKEN) is left
 * alone. The secret sweep (sweep.js) shares these patterns, but only as a warning tier: a secret-shaped string in an
 * answer is often harmless text (a sample bearer header, a documented example key), so it is reported, not a stop.
 * Only the run's canary and the exact values handed to the child stop a run (classifySecrets). It finds the formats
 * it knows: a secret of another shape passes.
 *
 * Size caps: input over INPUT_CEILING characters is dropped whole, not scanned in part, so nothing unscanned
 * is ever returned. Output is cut to `maxChars` (4000 by default) after redaction, so a cut cannot split a secret.
 */
'use strict';

const crypto = require('crypto');

/** The child environment variable that holds the canary, under a secret-shaped name. */
const CANARY_ENV = 'BENCH_CANARY_TOKEN';
const CANARY_PREFIX = 'bench-canary-';
const INPUT_CEILING = 5000000;
const DEFAULT_MAX_CHARS = 4000;
const MIN_LITERAL = 8;

// The rules that match a variable name have no leading word boundary, so a name that ends a longer identifier
// (MY_AWS_SECRET_ACCESS_KEY, TF_VAR_aws_secret_access_key, awsSecretAccessKey) is matched too.
const RULES = Object.freeze([
  {
    name: 'aws_key_id',
    pattern:
      /(?<![A-Z0-9])(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA)[A-Z0-9]{16}(?![A-Z0-9])/g,
    replacement: '[REDACTED_AWS_KEY_ID]',
  },
  {
    name: 'secret_key',
    pattern:
      /(aws_secret_access_key|secret_?access_?key)(["']?\s*[:=]\s*["']?)[A-Za-z0-9/+=]{40,}/gi,
    replacement: '$1$2[REDACTED]',
  },
  {
    name: 'session_token',
    pattern:
      /(aws_session_token|aws_security_token|session_?token|x-amz-security-token)(["']?\s*[:=]\s*["']?)[A-Za-z0-9/+=_%-]{100,}/gi,
    replacement: '$1$2[REDACTED]',
  },
  {
    name: 'sts_token',
    pattern: /\b(?:IQoJb3JpZ2lu|FwoGZXIvYXdz)[A-Za-z0-9+/=_-]{40,}/g,
    replacement: '[REDACTED_SESSION_TOKEN]',
  },
  {
    name: 'bedrock_key',
    pattern: /\bABSK[A-Za-z0-9+/=]{20,}/g,
    replacement: '[REDACTED_BEDROCK_KEY]',
  },
  {
    name: 'bedrock_key',
    pattern:
      /(AWS_BEARER_TOKEN_BEDROCK)(\s*[:=]\s*["']?)[A-Za-z0-9+/=_-]{20,}/g,
    replacement: '$1$2[REDACTED]',
  },
  {
    name: 'bearer',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi,
    replacement: 'Bearer [REDACTED]',
  },
  {
    name: 'canary',
    pattern: new RegExp(`\\b${CANARY_PREFIX}[0-9a-f]{16,}`, 'g'),
    replacement: '[REDACTED_CANARY]',
  },
]);

/**
 * Values the cloud provider's documentation uses as examples. They have a real secret's shape and no power, and
 * security answers quote them. classifySecrets reports a match of one of these as an example value, not as a secret.
 * The redactor still replaces them in stored text. Matched whole: the example plus extra characters is not an example.
 */
const KNOWN_EXAMPLES = Object.freeze([
  'AKIAIOSFODNN7EXAMPLE',
  'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  'AKIAI44QH8DHBEXAMPLE',
  'je7MtGbClwBF/2Zp9Utk/h3yCo8nvbEXAMPLEKEY',
]);

/** A fresh canary for one run: random, and recognizable by its prefix so a canary from any run is found. */
const newCanary = () =>
  `${CANARY_PREFIX}${crypto.randomBytes(16).toString('hex')}`;

/** Exact secret values, longest first. A value under MIN_LITERAL characters would shred ordinary text, so it is refused. */
function checkLiterals(literals) {
  for (const literal of literals) {
    if (typeof literal !== 'string' || literal.length < MIN_LITERAL)
      throw new TypeError(
        `a literal secret must be a string of at least ${MIN_LITERAL} characters`,
      );
  }
  return [...new Set(literals)].sort((a, b) => b.length - a.length);
}

/** A redact(value, { maxChars }) function that also removes the exact `literals`. null and undefined become ''. */
function createRedactor({ literals = [], maxChars = DEFAULT_MAX_CHARS } = {}) {
  const exactLiterals = checkLiterals(literals);
  return function redact(value, { maxChars: charLimit = maxChars } = {}) {
    let text = value === null || value === undefined ? '' : String(value);
    if (text.length > INPUT_CEILING)
      return `[REDACTED: ${text.length} characters is too long to scan]`;
    for (const literal of exactLiterals)
      text = text.split(literal).join('[REDACTED]');
    for (const { pattern, replacement } of RULES)
      text = text.replace(pattern, replacement);
    return text.length > charLimit
      ? `${text.slice(0, charLimit)}[truncated ${text.length - charLimit} characters]`
      : text;
  };
}

/** The secret part of a rule match: after the name and separator for the named rules, the whole match otherwise. */
const getSecretValue = (match) =>
  match[2] === undefined
    ? match[0]
    : match[0].slice(match[1].length + match[2].length);

/**
 * Splits what `text` holds into three tiers, each a count by pattern name ({} when none). Never returns the text.
 *   stop     the run's canary (by its prefix) and the exact `literals`: values the run itself knows are secret. No false positive.
 *   flag     any other secret-shaped string (key id, secret key, token, bearer). The redactor replaces these in stored text.
 *   example  a match that is exactly one of KNOWN_EXAMPLES, counted here instead of in `flag`.
 */
function classifySecrets(text, literals = []) {
  const tiers = { stop: {}, flag: {}, example: {} };
  const addCount = (tier, name, count = 1) =>
    (tiers[tier][name] = (tiers[tier][name] || 0) + count);
  for (const { name, pattern } of RULES) {
    for (const match of text.matchAll(pattern))
      addCount(
        name === 'canary'
          ? 'stop'
          : KNOWN_EXAMPLES.includes(getSecretValue(match))
            ? 'example'
            : 'flag',
        name,
      );
  }
  const literalCount = checkLiterals(literals).reduce(
    (sum, literal) => sum + text.split(literal).length - 1,
    0,
  );
  if (literalCount) addCount('stop', 'literal', literalCount);
  return tiers;
}

const redact = createRedactor();

module.exports = {
  CANARY_ENV,
  INPUT_CEILING,
  DEFAULT_MAX_CHARS,
  MIN_LITERAL,
  KNOWN_EXAMPLES,
  newCanary,
  createRedactor,
  redact,
  checkLiterals,
  classifySecrets,
};
