// SPDX-License-Identifier: Apache-2.0
/**
 * Setting a stored file aside when it is replaced or rejected. A paid output, an answer, a checklist and a judgment
 * are evidence: a file that is no longer current is renamed `<file><mark><time>` and kept, never overwritten and
 * never read again.
 */
'use strict';

const fs = require('fs');

const SUPERSEDED_MARK = '.superseded-';

/** The time part of a renamed file: an ISO time with ":" and "." turned into "-". */
const fileTime = (now) => new Date(now()).toISOString().replace(/[:.]/g, '-');

/**
 * Renames `file` to `<file><mark><time>` and returns the new path. rename() replaces an existing target without a
 * word, and the time has millisecond resolution, so two set-asides in one millisecond (a zero retry backoff, or a
 * fixed test clock) or a name left by an earlier job would destroy a file that is meant to be kept. When the name is
 * taken, `-2`, `-3`, ... is added after the time.
 */
function setAside(file, mark, now = Date.now) {
  const base = `${file}${mark}${fileTime(now)}`;
  let target = base;
  for (let copy = 2; fs.existsSync(target); copy += 1)
    target = `${base}-${copy}`;
  fs.renameSync(file, target);
  return target;
}

/** Renames `file` to `<file>.superseded-<time>` (see setAside) and returns the new path, or null when there is no file. */
function supersede(file, now = Date.now) {
  if (!fs.existsSync(file)) return null;
  return setAside(file, SUPERSEDED_MARK, now);
}

module.exports = { SUPERSEDED_MARK, fileTime, setAside, supersede };
