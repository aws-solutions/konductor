// SPDX-License-Identifier: Apache-2.0
'use strict';

// Workspaces for dry runs and answer files: the fixture copied the way the runner copies it, with an answer laid over.
// An overlay is a directory (its DELETE.txt lists paths to remove first; ASKS.json is a scripted conversation, not a
// file of the answer) or a function that edits the workspace, as a scripted agent would.

const fs = require('node:fs');
const path = require('node:path');
const { copyFixture } = require('../../runner/lib/sandbox.js');

const NOT_ANSWER_FILES = new Set(['DELETE.txt', 'ASKS.json']);

/** Every regular file under `root`, as paths relative to it. */
function listTree(root, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) out.push(...listTree(root, r));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

/** Lays `overlay` (a directory, a function of the workspace, or null) over the workspace `ws`. */
function applyOverlay(ws, overlay) {
  if (!overlay) return;
  if (typeof overlay === 'function') { overlay(ws); return; }
  const del = path.join(overlay, 'DELETE.txt');
  if (fs.existsSync(del)) {
    for (const p of fs.readFileSync(del, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)) fs.rmSync(path.join(ws, p), { recursive: true, force: true });
  }
  fs.cpSync(overlay, ws, { recursive: true, force: true, verbatimSymlinks: true, filter: (p) => p === overlay || !NOT_ANSWER_FILES.has(path.relative(overlay, p)) });
}

/** A fresh workspace at `ws`: the fixture (as the runner copies it) plus the overlay. */
function makeWorkspace(ws, fixtureDir, overlay) {
  fs.rmSync(ws, { recursive: true, force: true });
  copyFixture(fixtureDir, ws);
  applyOverlay(ws, overlay);
  return ws;
}

/** Copies to `to` the files of `ws` that are new or differ from `base`; returns how many. */
function overlayOf(ws, base, to) {
  fs.rmSync(to, { recursive: true, force: true });
  let n = 0;
  for (const rel of listTree(ws)) {
    const orig = path.join(base, rel);
    if (fs.existsSync(orig) && fs.readFileSync(orig).equals(fs.readFileSync(path.join(ws, rel)))) continue;
    fs.mkdirSync(path.dirname(path.join(to, rel)), { recursive: true });
    fs.copyFileSync(path.join(ws, rel), path.join(to, rel));
    n++;
  }
  return n;
}

module.exports = { listTree, applyOverlay, makeWorkspace, overlayOf };
