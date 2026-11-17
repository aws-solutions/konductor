// SPDX-License-Identifier: Apache-2.0
/**
 * Secret sweep. After a subject run, every file under the run folder is scanned in two tiers
 * (classifySecrets in redact.js):
 *
 *   stop tier  an exact match of a value the run itself knows is secret: the credential values handed to the child
 *              and the run's canary (pass both in `literals`). Precise, no false positive. A hit is in `hits`, can
 *              quarantine the file, and the caller skips judging it and stops the run with securityNote().
 *              Quarantine writes the file again as `<name>~quarantined-<time>` (mode 0600) with the matched values and
 *              every secret shape redacted, then removes the original, so no copy of the value stays on disk. A
 *              quarantined file is never scanned, but a later sweep lists it in `quarantined` and is not clean while
 *              one exists: a second sweep of the same run folder cannot read as clean after a stop.
 *   flag tier  any other secret-shaped string (key id, secret key, token, bearer). Security answers write these as
 *              examples. The file is left as it is, so the text is NOT redacted in it; it is redacted when the answer
 *              is prepared for judging. The sweep records a warning per file in `flagged` (pattern name and count)
 *              and does not stop. warningNote() prints them. A match of a documented example value (KNOWN_EXAMPLES)
 *              goes to `examples` instead, as an example value.
 *
 * It matches secret-shaped values, never bare names, so an answer that explains how to set AWS_SESSION_TOKEN is
 * clean. The result holds file names and counts, never the matching text. A file that is not scanned is listed in
 * `skipped`, with the reason in `skippedReasons`: it is over `maxBytes`, it is a symbolic link, or it was removed while
 * the sweep ran. A symbolic link is never followed, whether it points at a file or at a folder, because it could point
 * at any file or tree: the folder walk below does not enter a link, and the link itself is listed. The sweep is not
 * clean while any file is skipped, so a secret behind a link or in a file that went missing is never reported as
 * "scanned, nothing found". A run folder that does not exist is not clean either (`missing: true`): a wrong path or a
 * run folder that was never made must not read as a clean sweep. `clean` is about the stop tier only.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { checkLiterals, classifySecrets, createRedactor } = require('./redact');

const MAX_FILE_BYTES = 20 * 1024 * 1024;
// A quarantined file is named `<name>~quarantined-<time>`; a later sweep lists that exact form without reading it. "~" is a
// character that names.js never allows in a task id, seat, batch, skill or run id, so no file name the harness builds
// from them can have this form, and a task id such as `t.quarantined-1` is still scanned. A test pins the rule.
// Answers have only the Skill tool and cannot write into the run folder, so a subject cannot forge the form either.
const QUARANTINE_MARK = '~quarantined-';
// The time part is what Date#toISOString gives with ":" and "." turned into "-" (a year may carry a sign and extra
// digits outside 0000-9999).
const QUARANTINED = new RegExp(
  `${QUARANTINE_MARK}[+-]?\\d{4,6}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z$`,
);
const SKIP_REASONS = Object.freeze({
  tooLarge: 'too large to scan',
  symlink: 'a symbolic link, not followed',
  vanished: 'removed while the sweep ran',
});

/**
 * Every path below `dir`, relative to it, files and folders alike. A symbolic link is listed but never entered, also
 * when it points at a folder (fs.readdirSync with `recursive` would enter it). `dir` itself is the caller's run folder.
 * A folder that is gone is not an error here: a missing `dir` is empty, and a missing sub folder is left in the list
 * for the caller's own lstat to report as removed.
 */
function listBelow(dir, prefix = '') {
  let names;
  try {
    names = fs.readdirSync(path.join(dir, prefix));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return [];
  }
  const found = [];
  for (const name of names) {
    const relativePath = prefix ? path.join(prefix, name) : name;
    found.push(relativePath);
    let stats;
    try {
      stats = fs.lstatSync(path.join(dir, relativePath));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      continue; // sweepRun looks at it again and reports it as removed
    }
    if (stats.isDirectory()) found.push(...listBelow(dir, relativePath));
  }
  return found;
}

/**
 * { clean, missing, scanned, hits: [{ file, found, quarantined? }], flagged: [{ file, found }], examples: [{ file, found }],
 * quarantined: [file], skipped, skippedReasons: [{ file, reason }] } for the folder `dir` (relative file names).
 * `quarantined` lists the files an earlier sweep set aside; the sweep is not clean while there is one. `literals` is
 * checked before anything is read, also when the folder holds no file. A folder that does not exist gives
 * `missing: true` and `clean: false`.
 */
function sweepRun(
  dir,
  {
    literals = [],
    maxBytes = MAX_FILE_BYTES,
    quarantine = false,
    now = Date.now,
  } = {},
) {
  checkLiterals(literals);
  const redactCopy = createRedactor({ literals, maxChars: Infinity });
  const missing = !fs.existsSync(dir);
  const names = missing ? [] : listBelow(dir).sort();
  const result = {
    clean: true,
    missing,
    scanned: 0,
    hits: [],
    flagged: [],
    examples: [],
    quarantined: [],
    skipped: [],
    skippedReasons: [],
  };
  const skip = (file, reason) => {
    result.skipped.push(file);
    result.skippedReasons.push({ file, reason });
  };
  for (const relativePath of names) {
    const file = path.join(dir, relativePath);
    let stats;
    let text;
    try {
      stats = fs.lstatSync(file);
      // Only a regular file is read. A link is checked before anything else, so it is never opened.
      if (
        stats.isFile() &&
        !QUARANTINED.test(relativePath) &&
        stats.size <= maxBytes
      )
        text = fs.readFileSync(file, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      skip(relativePath, SKIP_REASONS.vanished);
      continue;
    }
    if (stats.isSymbolicLink()) {
      skip(relativePath, SKIP_REASONS.symlink);
      continue;
    }
    if (!stats.isFile()) continue; // a folder
    if (QUARANTINED.test(relativePath)) {
      result.quarantined.push(relativePath); // set aside by an earlier sweep: listed, never read
      continue;
    }
    if (text === undefined) {
      skip(relativePath, SKIP_REASONS.tooLarge);
      continue;
    }
    result.scanned += 1;
    const { stop, flag, example } = classifySecrets(text, literals);
    if (Object.keys(flag).length)
      result.flagged.push({ file: relativePath, found: flag });
    if (Object.keys(example).length)
      result.examples.push({ file: relativePath, found: example });
    if (!Object.keys(stop).length) continue;
    const hit = { file: relativePath, found: stop };
    if (quarantine) {
      hit.quarantined = `${relativePath}${QUARANTINE_MARK}${new Date(now()).toISOString().replace(/[:.]/g, '-')}`;
      // The copy is written before the original is removed, and 'wx' never overwrites a file that is there.
      fs.writeFileSync(path.join(dir, hit.quarantined), redactCopy(text), {
        mode: 0o600,
        flag: 'wx',
      });
      fs.unlinkSync(file);
    }
    result.hits.push(hit);
  }
  result.clean =
    !missing &&
    !result.hits.length &&
    !result.skipped.length &&
    !result.quarantined.length;
  return result;
}

const formatFound = (found, suffix = '') =>
  Object.entries(found)
    .map(([name, count]) => `${name} x${count}${suffix}`)
    .join(', ');

/** The security note for a run that must stop: what was found and where, without the values. '' when clean. */
function securityNote(result) {
  const parts = [
    ...(result.missing ? ['the run folder (it does not exist)'] : []),
    ...result.hits.map(
      (hit) =>
        `${hit.file} (${formatFound(hit.found)})${hit.quarantined ? ', quarantined (the copy is redacted)' : ''}`,
    ),
    ...(result.quarantined ?? []).map(
      (quarantinedFile) =>
        `${quarantinedFile} (set aside by an earlier sweep, still in the run folder)`,
    ),
    ...result.skipped.map(
      (skippedFile) =>
        `${skippedFile} (${result.skippedReasons?.find((entry) => entry.file === skippedFile)?.reason ?? SKIP_REASONS.tooLarge})`,
    ),
  ];
  return parts.length
    ? `SECURITY STOP: the secret sweep found a value the run knows is secret (a credential handed to the child, or the canary), could not scan, or still holds a quarantined file: ${parts.join('; ')}. The matching text is not shown.`
    : '';
}

/**
 * The warning for secret-shaped text that does not stop the run, one entry per file with pattern names and counts,
 * documented example values labelled as such. '' when there is none. The matching text is not shown.
 */
function warningNote(result) {
  const parts = [
    ...result.flagged.map(
      (entry) => `${entry.file} (${formatFound(entry.found)})`,
    ),
    ...result.examples.map(
      (entry) =>
        `${entry.file} (${formatFound(entry.found, ' example value')})`,
    ),
  ];
  return parts.length
    ? `SWEEP WARNING: secret-shaped text found. It is not redacted in the file; it is redacted when the text is prepared for judging. The run continues: ${parts.join('; ')}.`
    : '';
}

module.exports = {
  MAX_FILE_BYTES,
  QUARANTINE_MARK,
  sweepRun,
  securityNote,
  warningNote,
};
