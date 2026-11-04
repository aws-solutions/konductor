// SPDX-License-Identifier: Apache-2.0
/**
 * The files a run changed, as the judge sees them.
 *
 * Many benchmark tasks ask for edits to files, and the reply text alone ("Done.") says nothing
 * about the work. `workspaceChanges(start, final, limits)` compares the workspace a run started
 * from with the workspace it ended in and lists what changed, so a judge can grade the work as
 * well as the reply. It is pure and deterministic: no I/O, no clock, no randomness.
 *
 * Inputs. `start` and `final` are snapshots: plain objects from a relative path to the file's
 * text. Both must come from `loadSnapshot` (bench/lib/snapshot-loader.js), which skips symbolic
 * links and bounds the number and size of files. This module does not scan content for secrets or
 * credentials, and it does not read files itself. A path that is absolute, empty, contains `..`
 * anywhere or holds a control character is rejected in either snapshot, even for a file the run
 * did not touch, so a bad snapshot fails loudly and never reaches a prompt.
 *
 * Output. One entry per added, edited or deleted path, sorted by path (by UTF-16 code unit, not by
 * locale), each `{ path, change, content, truncated, omitted }`:
 *  - `change` is `added` (only in `final`), `edited` (in both, different text) or `deleted` (only
 *    in `start`). A file that is identical in both is left out.
 *  - `content` is the final text, or null when the file was deleted or its entry was omitted.
 *  - `truncated` is true when `content` was cut at a limit. `omitted` is true when a limit was
 *    already reached, so the entry lists the path and change only.
 *
 * Limits. All three count entries or UTF-16 code units, not bytes, and all are integers of at
 * least 1. Both arms of a pair must be judged with the same limits so that neither is favoured.
 *  - `maxFileChars`: a file longer than this is cut at it.
 *  - `maxTotalChars`: the content shown across all entries. A file that would pass it is cut to
 *    what is left, and once nothing is left the remaining entries are omitted.
 *  - `maxFiles`: the entries that may show content. Entries past it are omitted.
 * Entries are taken in path order, so which entry is cut or omitted depends only on the two
 * snapshots and the limits. A cut never splits a surrogate pair. An unknown option or a limit that
 * is not a positive integer throws.
 *
 * Cleaning before cutting. The optional fourth argument `clean(text) => text` is applied to the
 * final text of every file that will show content, before any limit is applied. The limits then
 * count the cleaned text, and `truncated` compares the cleaned length with the cut. A caller that
 * must hide something (the judge prompt hides the skill's name) passes its cleaner here. Cutting
 * a file first and cleaning the piece would let a cut leave the start of a name that the cleaner,
 * seeing only the piece, no longer recognises. A file that is deleted or omitted is never passed
 * to `clean`, so its cost is bounded by `maxFiles` files of at most the snapshot's own size
 * limit each. Change detection uses the raw texts. `clean` must be deterministic and must return
 * a string.
 */

/** The limits used when the caller passes none, or leaves one out. */
const DEFAULT_LIMITS = Object.freeze({
  maxFileChars: 6000,
  maxTotalChars: 24000,
  maxFiles: 20,
});

const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const WINDOWS_DRIVE = /^[A-Za-z]:/;

/** Throws unless `value` is a relative path with no `..` segment and no control character. */
function assertRelativePath(value, where) {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${where}: a file path must be a non-empty string`);
  }
  const shown = JSON.stringify(value.length > 80 ? `${value.slice(0, 80)}...` : value);
  if (CONTROL_CHARS.test(value)) {
    throw new Error(`${where}: file path ${shown} contains a control character`);
  }
  if (value.startsWith('/') || value.startsWith('\\') || WINDOWS_DRIVE.test(value)) {
    throw new Error(`${where}: file path ${shown} is absolute; use a relative path`);
  }
  if (value.includes('..')) {
    throw new Error(`${where}: file path ${shown} contains ".."`);
  }
}

/** The snapshot as a Map from path to text, or a throw naming what is wrong with it. */
function readSnapshot(snapshot, name) {
  const isPlain =
    snapshot !== null &&
    typeof snapshot === 'object' &&
    (Object.getPrototypeOf(snapshot) === Object.prototype ||
      Object.getPrototypeOf(snapshot) === null);
  if (!isPlain) throw new TypeError(`${name} must be a plain object from path to file text`);
  const files = new Map();
  for (const [filePath, text] of Object.entries(snapshot)) {
    assertRelativePath(filePath, name);
    if (typeof text !== 'string') {
      throw new TypeError(`${name}: the content of ${JSON.stringify(filePath)} must be a string`);
    }
    files.set(filePath, text);
  }
  return files;
}

/** The limits with defaults filled in. Throws on an unknown option or a non-positive integer. */
function resolveLimits(limits) {
  if (limits === undefined || limits === null) return { ...DEFAULT_LIMITS };
  const isPlain =
    typeof limits === 'object' &&
    (Object.getPrototypeOf(limits) === Object.prototype ||
      Object.getPrototypeOf(limits) === null);
  if (!isPlain) throw new TypeError('limits must be a plain object');
  const unknown = Object.keys(limits).filter((key) => !Object.hasOwn(DEFAULT_LIMITS, key));
  if (unknown.length) {
    throw new Error(
      `unknown limit ${unknown.map((k) => JSON.stringify(k)).join(', ')}; ` +
        `use ${Object.keys(DEFAULT_LIMITS).join(', ')}`,
    );
  }
  const resolved = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(DEFAULT_LIMITS)) {
    if (!Object.hasOwn(limits, key) || limits[key] === undefined) continue;
    const value = limits[key];
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(`limit ${key} must be an integer of at least 1, got ${String(value)}`);
    }
    resolved[key] = value;
  }
  return resolved;
}

/** `text` cut to at most `max` code units, never between the halves of a surrogate pair. */
function cutText(text, max) {
  if (text.length <= max) return text;
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end);
}

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The files that differ between `start` and `final`, sorted by path and bounded by `limits`.
 * See the module header for the entry shape and the limits.
 */
function workspaceChanges(start, final, limits, clean) {
  if (clean !== undefined && typeof clean !== 'function') {
    throw new TypeError('clean must be a function from text to text');
  }
  const before = readSnapshot(start, 'start');
  const after = readSnapshot(final, 'final');
  const caps = resolveLimits(limits);

  const changed = [];
  for (const filePath of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(filePath);
    const now = after.get(filePath);
    if (was !== undefined && now !== undefined && was === now) continue;
    const change = was === undefined ? 'added' : now === undefined ? 'deleted' : 'edited';
    changed.push({ path: filePath, change, text: now });
  }
  changed.sort((a, b) => byCodeUnit(a.path, b.path));

  let shown = 0;
  return changed.map(({ path: filePath, change, text }, index) => {
    const entry = { path: filePath, change, content: null, truncated: false, omitted: false };
    const remaining = caps.maxTotalChars - shown;
    if (index >= caps.maxFiles || (change !== 'deleted' && remaining <= 0)) {
      return { ...entry, omitted: true };
    }
    if (change === 'deleted') return entry;
    // The cleaner sees the whole file, then the cut is made, so a cut can never leave the start
    // of something the cleaner would have removed.
    const whole = clean === undefined ? text : clean(text);
    if (typeof whole !== 'string') throw new TypeError('clean must return a string');
    const content = cutText(whole, Math.min(caps.maxFileChars, remaining));
    shown += content.length;
    return { ...entry, content, truncated: content.length < whole.length };
  });
}

module.exports = { DEFAULT_LIMITS, resolveLimits, workspaceChanges };
