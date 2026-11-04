// SPDX-License-Identifier: Apache-2.0
'use strict';

// Interpreter versions at run start, and the pin file bench/tasks/toolchain/pins.json that says which versions the task checks
// were validated with. A mismatch is reported, never fatal: a different Python can change a test result, and the reader
// should know, but the run is still worth having.
//
// { "global": { "node": "24", "python3": "3.12" }, "tasks": { "<task id>": { "pytest": "8.4" } } }
// A pin is a dotted version prefix: "3.12" matches 3.12.13 and does not match 3.1.

const fs = require('node:fs');
const path = require('node:path');
const sandbox = require('./sandbox.js');

const PINS_FILE = path.join('toolchain', 'pins.json');

/** { node, python3, python, pytest }: the first line of each --version, or null when the program is missing. */
function interpreterVersions(run = sandbox.versionOf) {
  return {
    node: process.version,
    python3: run('python3', ['--version']),
    python: run('python', ['--version']),
    pytest: run('python3', ['-m', 'pytest', '--version']),
  };
}

const numbers = (s) => String(s).replace(/^[^\d]*/, '').split(/[^\d]+/).filter(Boolean);

function versionMatches(expected, actual) {
  if (actual === null || actual === undefined) return false;
  const want = numbers(expected);
  const have = numbers(actual);
  return want.length > 0 && want.every((part, i) => have[i] === part);
}

function loadPins(benchDir) {
  const file = path.join(benchDir, 'tasks', PINS_FILE);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return null; }
  let pins;
  try { pins = JSON.parse(text); } catch (e) { throw new Error(`${PINS_FILE}: not valid JSON (${e.message})`); }
  const scopes = [['global', pins.global], ...Object.entries(pins.tasks || {}).map(([id, p]) => [`tasks.${id}`, p])];
  for (const [scope, set] of scopes) {
    for (const [name, v] of Object.entries(set || {})) if (typeof v !== 'string' || !v) throw new Error(`${PINS_FILE}: ${scope}.${name} must be a string version prefix`);
  }
  return pins;
}

/** { pinned, mismatches: [{ interpreter, expected, actual, scope }] }. Task pins count only for the tasks in `taskIds`. */
function checkPins(pins, versions, taskIds = []) {
  const sets = [['all tasks', pins?.global || {}], ...taskIds.filter((id) => pins?.tasks?.[id]).map((id) => [id, pins.tasks[id]])];
  const wanted = sets.flatMap(([scope, set]) => Object.entries(set).map(([interpreter, expected]) => ({ interpreter, expected, scope })));
  if (!wanted.length) return { pinned: false, mismatches: [] };
  const mismatches = wanted.filter((w) => !versionMatches(w.expected, versions[w.interpreter])).map((w) => ({ ...w, actual: versions[w.interpreter] ?? null }));
  return { pinned: true, mismatches };
}

const describeMismatch = (m) => `${m.interpreter} is ${m.actual ?? 'not installed'}, expected ${m.expected} (${m.scope})`;

module.exports = { interpreterVersions, versionMatches, loadPins, checkPins, describeMismatch, PINS_FILE };
