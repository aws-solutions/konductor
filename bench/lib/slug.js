// SPDX-License-Identifier: Apache-2.0
/**
 * Name checks for every value that becomes part of a file path or a directory name: skill names,
 * task ids and judge seat labels. A name that passes cannot contain a path separator, a `..`
 * segment, a newline or a leading dot, so joining it onto a directory cannot leave that directory.
 */
const path = require('node:path');

const MAX_NAME_LENGTH = 160;
/** Lower-case letters and digits, then those plus `.`, `_` and `-`. */
const SLUG_RE = /^[a-z0-9][a-z0-9._-]*$/;
/** A slug that may also carry `+`, as in the joined skill list of a batch file name. */
const FILE_KEY_RE = /^[a-z0-9][a-z0-9._+-]*$/;

function matches(re, value) {
  return (
    typeof value === 'string' &&
    value.length <= MAX_NAME_LENGTH &&
    !value.includes('..') &&
    re.test(value)
  );
}

const isSlug = (value) => matches(SLUG_RE, value);
const isFileKey = (value) => matches(FILE_KEY_RE, value);

function assertWith(ok, value, what, rule) {
  if (!ok(value)) {
    throw new Error(`invalid ${what} ${JSON.stringify(String(value).slice(0, 80))}: ${rule}`);
  }
  return value;
}

const RULE =
  'use lower-case letters, digits, ".", "_" and "-", start with a letter or digit, and avoid ".."';
const assertSlug = (value, what = 'name') => assertWith(isSlug, value, what, RULE);
const assertFileKey = (value, what = 'name') =>
  assertWith(isFileKey, value, what, `${RULE}; "+" is also allowed`);

/** Returns `file` (resolved) after checking it lies strictly inside `dir`; throws otherwise. */
function assertUnder(dir, file) {
  const root = path.resolve(dir);
  const resolved = path.resolve(file);
  const rel = path.relative(root, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`path ${JSON.stringify(resolved)} is outside ${JSON.stringify(root)}`);
  }
  return resolved;
}

module.exports = { SLUG_RE, isSlug, isFileKey, assertSlug, assertFileKey, assertUnder };
