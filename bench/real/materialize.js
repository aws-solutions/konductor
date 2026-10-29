#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Writes the BASE commit of a manifest task into a directory: the plain tree, no .git directory and no
// object store, so nothing in it leads to the fix. Works only from the local cache filled by fetch.js and
// never uses the network.
//
//   node bench/real/materialize.js <id> <dest> [--cache DIR] [--list-out FILE]
//
// <dest> must be absent or empty. The content hash and file count are printed as JSON; --list-out also
// writes the file list (one path per line) to a file outside <dest>.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const lib = require('./lib.js');

function assertEmpty(dest) {
  if (fs.existsSync(dest) && fs.readdirSync(dest).length > 0) throw new Error(`destination is not empty: ${dest}`);
  fs.mkdirSync(dest, { recursive: true });
}

// Writes the tree of `sha` from the bare repository `gitDir` into `dest` (no .git, modes and symlinks kept).
function exportTree(gitDir, sha, dest) {
  const ls = lib.git(gitDir, ['ls-tree', '-r', '-z', sha]).split('\0').filter(Boolean);
  if (ls.some((l) => l.startsWith('160000 '))) throw new Error(`${sha} contains a submodule`);
  assertEmpty(dest);
  const idx = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'real-idx-')), 'index');
  try {
    const env = { GIT_INDEX_FILE: idx };
    lib.git(gitDir, ['read-tree', sha], { env });
    lib.git(gitDir, ['--work-tree', path.resolve(dest), '-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'checkout-index', '-a', '-f'], { env });
  } catch (e) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw e;
  } finally {
    fs.rmSync(path.dirname(idx), { recursive: true, force: true });
  }
}

// Exports the tree of entry.baseSha into dest and checks it against the manifest pins.
// Returns {contentSha256, fileCount, files}.
function materialize(entry, dest, { cache } = {}) {
  const { gitDir } = lib.entryPaths(lib.resolveCache(cache), entry.id);
  if (!fs.existsSync(gitDir)) throw new Error(`${entry.id}: not in the cache (run bench/real/fetch.js first): ${gitDir}`);
  const tree = lib.git(gitDir, ['rev-parse', '--verify', `${entry.baseSha}^{tree}`]).trim();
  if (entry.baseTreeSha && tree !== entry.baseTreeSha) throw new Error(`${entry.id}: base tree is ${tree}, manifest pins ${entry.baseTreeSha}`);
  exportTree(gitDir, entry.baseSha, dest);
  const { sha256, files } = lib.hashTree(dest);
  if (entry.contentSha256 && sha256 !== entry.contentSha256) {
    fs.rmSync(dest, { recursive: true, force: true });
    throw new Error(`${entry.id}: content hash ${sha256} differs from the manifest (${entry.contentSha256})`);
  }
  return { contentSha256: sha256, fileCount: files.length, files };
}

function main(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[++i];
    else args._.push(argv[i]);
  }
  const [id, dest] = args._;
  if (!id || !dest) throw new Error('usage: materialize.js <id> <dest> [--cache DIR] [--list-out FILE]');
  const entry = lib.findEntry(lib.loadManifest(), id);
  const r = materialize(entry, path.resolve(dest), { cache: args.cache });
  if (args['list-out']) fs.writeFileSync(args['list-out'], `${r.files.join('\n')}\n`);
  console.log(JSON.stringify({ id, baseSha: entry.baseSha, contentSha256: r.contentSha256, fileCount: r.fileCount }));
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(`error: ${e.message}`); process.exit(1); }
}

module.exports = { materialize, exportTree };
