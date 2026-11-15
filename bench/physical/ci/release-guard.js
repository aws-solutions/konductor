#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Refuses plant release content anywhere in a repository's full git history (SR-13): by path, by file type, and by
// hashed release lines. Never prints a matched line, only where it was found.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Release file names (9.5). manifest.json alone is too common a name to refuse.
const RELEASE_NAMES = new Set(['manifest.json.sig', 'refusal-rule.json', 'refusal-labels.json', 'seeds.json', 'truth-table.json', 'sensor-limits.json', 'analysis-plan.md']);
const RELEASE_DIR = /^(plant-r\d+|held-back.*)$/;
const RELEASE_TYPES = new Set(['.cedar', '.cedarschema', '.age', '.gpg', '.pgp']);
const ENCRYPTED_HEADERS = ['age-encryption.org/v1', '-----BEGIN PGP MESSAGE-----'].map((h) => Buffer.from(h));
// Shorter lines are too generic to hash: a brace, a field name, a common JSON pair.
const MIN_LINE_CHARS = 40;
const MAX_OUTPUT = 1024 * 1024 * 1024;

/** The form a line is hashed in: trimmed, inner whitespace runs as one space. */
const normalLine = (line) => line.trim().replace(/\s+/g, ' ');

/** SHA-256 hex of every line of `text` long enough to hash, in order. */
function lineHashes(text) {
  return text.split('\n').map(normalLine).filter((l) => l.length >= MIN_LINE_CHARS)
    .map((l) => crypto.createHash('sha256').update(l, 'utf8').digest('hex'));
}

/** Why `file` (a repository path) is refused by name or type, or null. */
function pathFinding(file) {
  const parts = file.split('/');
  const base = parts.at(-1);
  if (RELEASE_NAMES.has(base)) return `release file name ${base}`;
  if (parts.slice(0, -1).some((p) => RELEASE_DIR.test(p))) return 'inside a release directory';
  if (RELEASE_TYPES.has(path.extname(base))) return `release file type ${path.extname(base)}`;
  return null;
}

/** Why blob `data` is refused by content (an encrypted bundle, or a hashed release line), or null. `hashes` is a Set. */
function contentFinding(data, hashes) {
  if (ENCRYPTED_HEADERS.some((h) => data.subarray(0, h.length).equals(h))) return 'encrypted bundle';
  if (data.includes(0)) return null;
  return lineHashes(data.toString('utf8')).some((h) => hashes.has(h)) ? 'holds a hashed release line' : null;
}

/** Runs git in `repo` and returns stdout as a Buffer. Throws with git's message on a failure. */
function git(repo, args, input) {
  const r = spawnSync('git', ['-C', repo, ...args], { input, maxBuffer: MAX_OUTPUT });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${r.stderr.toString().trim()}`);
  return r.stdout;
}

/** Every path any commit of `repo` ever added or changed, across all refs and HEAD. */
function historyPaths(repo) {
  const out = git(repo, ['log', '--all', 'HEAD', '--format=', '--name-only', '--no-renames']).toString();
  return [...new Set(out.split('\n').filter(Boolean))].sort();
}

/** `[{sha, path}]` for every blob reachable from all refs and HEAD. Throws when the clone lacks objects (a partial or shallow clone). */
function historyBlobs(repo) {
  if (git(repo, ['rev-parse', '--is-shallow-repository']).toString().trim() === 'true') throw new Error('the clone is shallow; run on a full clone');
  const rows = git(repo, ['rev-list', '--objects', '--all', 'HEAD', '--missing=print']).toString().split('\n').filter(Boolean);
  const missing = rows.filter((r) => r.startsWith('?'));
  if (missing.length) throw new Error(`history is incomplete: ${missing.length} objects are missing; run on a full clone`);
  const named = rows.map((r) => {
    const [sha, ...name] = r.split(' ');
    return { sha, path: name.join(' ') };
  });
  const types = git(repo, ['cat-file', '--batch-check=%(objecttype)'], named.map((n) => n.sha).join('\n') + '\n').toString().split('\n');
  return named.filter((n, i) => types[i] === 'blob');
}

/** Calls `onBlob(sha, data)` for each blob in `shas`, read in one `git cat-file --batch`. */
function eachBlob(repo, shas, onBlob) {
  const out = git(repo, ['cat-file', '--batch'], shas.join('\n') + '\n');
  let at = 0;
  for (const sha of shas) {
    const eol = out.indexOf(0x0a, at);
    const size = Number(out.subarray(at, eol).toString().split(' ')[2]);
    onBlob(sha, out.subarray(eol + 1, eol + 1 + size));
    at = eol + 1 + size + 1;
  }
}

/** Every finding `{path, blob, why}` in the full history of `repo`, given the release line `hashes` (a Set). */
function scanHistory(repo, hashes) {
  const findings = historyPaths(repo).flatMap((p) => {
    const why = pathFinding(p);
    return why ? [{ path: p, blob: null, why }] : [];
  });
  const blobs = historyBlobs(repo);
  const pathOf = new Map(blobs.map((b) => [b.sha, b.path]));
  eachBlob(repo, blobs.map((b) => b.sha), (sha, data) => {
    const why = contentFinding(data, hashes);
    if (why) findings.push({ path: pathOf.get(sha), blob: sha, why });
  });
  return findings;
}

/** The hash set in `file`: one SHA-256 hex per line; blank lines and `#` comments skipped. Throws on anything else. */
function readHashes(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const bad = lines.find((l) => !/^[0-9a-f]{64}$/.test(l));
  if (bad !== undefined) throw new Error(`${file}: not a SHA-256 hex line`);
  return new Set(lines);
}

/** The sorted, unique line hashes of every file under the release directory `dir`, for the custodian to keep outside the repo. */
function hashRelease(dir) {
  const hashes = new Set();
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) for (const h of lineHashes(fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8'))) hashes.add(h);
  }
  return [...hashes].sort();
}

const USAGE = 'usage: release-guard.js check --hashes FILE [--repo DIR]\n       release-guard.js hash-release DIR\n';

/** Runs the command in `argv`; returns the exit code (0 clean, 1 findings, 2 usage or a git error). */
function main(argv, out = process.stdout, err = process.stderr) {
  const [command, ...rest] = argv;
  const flag = (name) => { const i = rest.indexOf(name); return i < 0 ? undefined : rest[i + 1]; };
  try {
    if (command === 'hash-release' && rest.length === 1) {
      out.write(hashRelease(rest[0]).join('\n') + '\n');
      return 0;
    }
    if (command !== 'check' || !flag('--hashes')) {
      err.write(USAGE);
      return 2;
    }
    const findings = scanHistory(flag('--repo') ?? '.', readHashes(flag('--hashes')));
    for (const f of findings) out.write(`refused: ${f.path}${f.blob ? ` (blob ${f.blob})` : ''}: ${f.why}\n`);
    if (!findings.length) out.write('release guard: no release content in history\n');
    return findings.length ? 1 : 0;
  } catch (e) {
    err.write(`release guard: ${e.message}\n`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main, scanHistory, hashRelease, lineHashes, pathFinding, contentFinding, MIN_LINE_CHARS };
