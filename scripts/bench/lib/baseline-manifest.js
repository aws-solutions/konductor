// SPDX-License-Identifier: Apache-2.0
/**
 * The hash list of the committed baseline files (bench/baselines/MANIFEST.json) and the check that holds the files
 * to it. Baselines are frozen: a run never writes them, so a change to one is a change to what every later run is
 * measured against, and a reviewer must see it as a changed hash.
 *
 *   writeManifest(layout)    hashes every baseline file and writes MANIFEST.json. Run it after a baseline file
 *                            changes; the diff of MANIFEST.json then lists exactly which files changed.
 *   verifyBaselines(layout)  problems that stop a baseline from being committed:
 *                              - a file that is not rules.json, tasks-<batch>.json or tasks-<batch>.buckets.json,
 *                                or that is not a regular file;
 *                              - a file the manifest does not list, a listed file that is gone, a changed hash;
 *                              - credential-shaped text (redact.js, and the key and token shapes below), a
 *                                home-directory path, or a 12-digit number that is not an AWS documentation account
 *                                id, in any file, read as the file's bytes and as the text a reader sees (every
 *                                string and key of the JSON, so `\n` or `\u0041` cannot hide a value; a leading
 *                                byte order mark is dropped first, as the JSON reader of the bench does);
 *                              - a skill whose files fail their format or disagree with each other (baseline.js).
 *                            A stale rules or tasks file is not a problem (`plan` reports it); it comes back as a warning.
 *
 * A finding names the file and the kind of text, never the matched value: the value may be the very thing that must
 * not be written down. (A 12-digit number shows its last four digits, so a person can find it.) The messages of the
 * format check quote the value they refuse, so they go through the redactor and mask a 12-digit number as well.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { loadChecked, FormatError, MANIFEST_KEY } = require('./formats');
const { loadBaseline } = require('./baseline');
const { BATCH_NAME } = require('./names');
const { sha256 } = require('./provenance');
const { classifySecrets, redact } = require('./redact');
const { BYTE_ORDER_MARK, readFile } = require('./read-file');

const MANIFEST_NAME = 'MANIFEST.json';

/**
 * Account ids that AWS documentation uses in its examples. A 12-digit number of any other value could belong to a
 * real account, so it is refused.
 */
const AWS_EXAMPLE_ACCOUNTS = Object.freeze([
  '123456789012',
  '111122223333',
  '444455556666',
]);
// Key and token shapes beyond the AWS ones the redactor knows. Each needs the full length of a real value, so prose that
// only names the kind of secret is not a finding.
const OTHER_SECRET_SHAPES = Object.freeze([
  { name: 'private_key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  {
    name: 'github_token',
    pattern: /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{30,}/g,
  },
  { name: 'slack_token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{20,}/g },
  { name: 'google_api_key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  {
    name: 'jwt',
    pattern:
      /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
]);
// A run of digits inside a longer word is not an account id: a SHA-256 in a hash field often holds 12 digits in a row.
const TWELVE_DIGITS = /(?<![0-9A-Za-z])[0-9]{12}(?![0-9A-Za-z])/g;
const HOME_PATH =
  /\/(?:Users|home)\/[^\s/"'\\]+\/|[A-Za-z]:\\{1,2}Users\\{1,2}/;

/** The entries of a folder in name order, so the manifest and the findings read the same on every file system. */
const listFolder = (folder) =>
  fs
    .readdirSync(folder, { withFileTypes: true })
    .sort((first, second) => (first.name < second.name ? -1 : 1));

/**
 * Every baseline file as a Map of "<skill>/<file>" to its absolute path, plus the problems of what else is there.
 * `unchecked` holds the skills with an entry that is not a baseline file: their formats are not read, because
 * `layout.batches` would count a folder or link named like a task file.
 */
function listBaselineFiles(layout) {
  const files = new Map();
  const problems = [];
  const unchecked = new Set();
  for (const entry of listFolder(layout.baselinesDir)) {
    if (entry.name === MANIFEST_NAME && entry.isFile()) continue;
    if (entry.name === MANIFEST_NAME) {
      problems.push(
        `${MANIFEST_NAME}: must be a regular file, not a folder or a link`,
      );
      continue;
    }
    if (!entry.isDirectory() || !BATCH_NAME.test(entry.name)) {
      problems.push(
        `${entry.name}: only a skill folder and ${MANIFEST_NAME} belong in bench/baselines/`,
      );
      continue;
    }
    const folder = path.join(layout.baselinesDir, entry.name);
    for (const file of listFolder(folder)) {
      const key = `${entry.name}/${file.name}`;
      if (!file.isFile() || !MANIFEST_KEY.test(key)) {
        unchecked.add(entry.name);
        problems.push(
          `${key}: not a baseline file (rules.json, tasks-<batch>.json or tasks-<batch>.buckets.json)`,
        );
      } else files.set(key, path.join(folder, file.name));
    }
  }
  return { files, problems, unchecked };
}

/** What one text holds: { credentials: { kind: count }, homePath, numbers: [12-digit values] }. */
function scanKinds(text) {
  const { stop, flag } = classifySecrets(text);
  const credentials = { ...stop, ...flag };
  for (const { name, pattern } of OTHER_SECRET_SHAPES) {
    const found = text.match(pattern);
    if (found) credentials[name] = found.length;
  }
  return {
    credentials,
    homePath: HOME_PATH.test(text),
    numbers: (text.match(TWELVE_DIGITS) || []).filter(
      (digits) => !AWS_EXAMPLE_ACCOUNTS.includes(digits),
    ),
  };
}

/** The finding lines of `kinds` for the file `key`. */
function findingsOf(key, { credentials, homePath, numbers }) {
  const findings = Object.entries(credentials).map(
    ([name, count]) =>
      `${key}: credential-shaped text (${name}, ${count} found)`,
  );
  if (homePath) findings.push(`${key}: a home-directory path`);
  if (numbers.length)
    findings.push(
      `${key}: ${numbers.length} 12-digit number(s) that are not AWS documentation account ids (first ends in ${numbers[0].slice(-4)})`,
    );
  return findings;
}

/** Findings for the text of one file: credential-shaped strings, home-directory paths, 12-digit numbers. */
const scanText = (key, text) => findingsOf(key, scanKinds(text));

/** Every string and every key of a parsed JSON value, in document order. */
function* jsonStrings(value) {
  if (typeof value === 'string') yield value;
  else if (Array.isArray(value))
    for (const item of value) yield* jsonStrings(item);
  else if (value !== null && typeof value === 'object')
    for (const [key, item] of Object.entries(value)) {
      yield key;
      yield* jsonStrings(item);
    }
}

/**
 * The findings of one baseline file, read twice: as its bytes (a bare number is not a string) and, when it parses,
 * as the strings and keys a reader sees. A JSON escape such as `\n`, `\t`, `\/` or `\u0041` hides a value from the
 * bytes only: `\n987654321098` has a letter in front of the number. The larger count of each kind is kept.
 */
function scanFile(key, text) {
  const kinds = scanKinds(text);
  let parsed;
  try {
    // parseJson (read-file.js) drops a leading byte order mark, so the format check accepts a file that has one; the
    // decoded scan has to read that file too, or a mark in front of the text would turn it off.
    parsed = JSON.parse(
      text.startsWith(BYTE_ORDER_MARK)
        ? text.slice(BYTE_ORDER_MARK.length)
        : text,
    );
  } catch {
    return findingsOf(key, kinds); // the format check reports a file that does not parse
  }
  const seen = scanKinds([...jsonStrings(parsed)].join('\n'));
  for (const [name, count] of Object.entries(seen.credentials))
    kinds.credentials[name] = Math.max(kinds.credentials[name] || 0, count);
  kinds.homePath = kinds.homePath || seen.homePath;
  if (seen.numbers.length > kinds.numbers.length) kinds.numbers = seen.numbers;
  return findingsOf(key, kinds);
}

/**
 * A format message made safe to print: it quotes the value it refuses, which may be a secret or an account number.
 * The redactor removes secret shapes, and a 12-digit number that is not an example shows only its last four digits.
 */
const printable = (message) =>
  redact(message, { maxChars: Infinity }).replace(TWELVE_DIGITS, (digits) =>
    AWS_EXAMPLE_ACCOUNTS.includes(digits)
      ? digits
      : `[12-digit number ending ${digits.slice(-4)}]`,
  );

/** { format_version, files } for the baseline files on disk, keys in name order. Throws if a file cannot be read. */
function buildManifest(layout) {
  const { files } = listBaselineFiles(layout);
  return {
    format_version: 1,
    files: Object.fromEntries(
      [...files.entries()].map(([key, file]) => [key, sha256(readFile(file))]),
    ),
  };
}

/** Writes MANIFEST.json through a temporary file in the same folder, so a cut-off write never leaves half a manifest. */
function writeManifest(layout) {
  const text = `${JSON.stringify(buildManifest(layout), null, 2)}\n`;
  const temporary = `${layout.manifestFile}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, text, { flag: 'wx' });
    fs.renameSync(temporary, layout.manifestFile);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    error.writing = true;
    // The manifest, not its temporary file: that is the file the person asked for.
    error.path = layout.manifestFile;
    throw error;
  }
}

/** The manifest's files as an object, or null with the reason added to `problems`. */
function readManifest(layout, problems) {
  try {
    return loadChecked('manifest', layout.manifestFile).data.files;
  } catch (error) {
    if (error instanceof FormatError)
      problems.push(
        ...error.errors.map(
          (message) => `${MANIFEST_NAME}: ${printable(message)}`,
        ),
      );
    else if (error.code === 'ENOENT')
      problems.push(`${MANIFEST_NAME}: file is missing`);
    else throw error;
    return null;
  }
}

/**
 * @returns {{ problems: string[], warnings: string[], fileCount: number, skillCount: number }}
 * Throws the system error of a folder or file that cannot be read, so the driver can say which.
 */
function verifyBaselines(layout) {
  const { files, problems, unchecked } = listBaselineFiles(layout);
  const warnings = [];
  const listed = readManifest(layout, problems);
  if (listed) {
    for (const key of Object.keys(listed))
      if (!files.has(key))
        problems.push(`${key}: listed in ${MANIFEST_NAME} but not on disk`);
  }
  for (const [key, file] of files) {
    // One read serves the hash and the scan, so they describe the same bytes.
    const bytes = readFile(file);
    if (listed) {
      if (!Object.hasOwn(listed, key))
        problems.push(`${key}: not listed in ${MANIFEST_NAME}`);
      else if (listed[key] !== sha256(bytes))
        problems.push(`${key}: hash differs from ${MANIFEST_NAME}`);
    }
    problems.push(...scanFile(key, bytes.toString('utf8')));
  }

  const skills = [
    ...new Set([...files.keys()].map((key) => key.split('/')[0])),
  ];
  for (const skill of skills.filter((name) => !unchecked.has(name))) {
    let baseline;
    try {
      baseline = loadBaseline(layout, skill);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      problems.push(
        `${skill}: a file it needs is missing (${path.relative(layout.root, error.path || '')})`,
      );
      continue;
    }
    problems.push(
      ...baseline.problems.map((message) => `${skill}/${printable(message)}`),
    );
    if (baseline.rulesStale)
      warnings.push(
        `${skill}: rules.json is stale, SKILL.md changed since the rules were written`,
      );
    for (const batch of baseline.batches)
      if (batch.stale)
        warnings.push(
          `${skill}: tasks-${batch.batch}.json is stale, rules.json changed since the tasks were written`,
        );
  }
  return {
    problems,
    warnings,
    fileCount: files.size,
    skillCount: skills.length,
  };
}

module.exports = {
  MANIFEST_NAME,
  buildManifest,
  writeManifest,
  verifyBaselines,
  scanText,
  scanFile,
};
