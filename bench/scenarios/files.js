// SPDX-License-Identifier: Apache-2.0
'use strict';

// Finds and reads the task files of a scenario directory: `DIR/<id>.json` for a batch directory, or
// `DIR/<batch>/<id>.json` for the whole pack. Fixtures and hidden checks live in `fixtures/` and `hidden/` beside the
// tasks and are never read as tasks. A JSON file counts as a task when it has a string `id` and a string `prompt`.

const fs = require('node:fs');
const path = require('node:path');

const SKIP_DIRS = new Set(['fixtures', 'hidden', 'node_modules']);
// Files the scenario tools write themselves; they are not tasks.
const GENERATED = new Set(['coverage.json', 'PREREG.json']);

const { readJson } = require('../runner/lib/util.js');
function parse(file) {
  try { return readJson(file); } catch (e) { throw new Error(`${file} is not valid JSON: ${e.message}`); }
}
const isTask = (j) => j !== null && typeof j === 'object' && !Array.isArray(j) && typeof j.id === 'string' && typeof j.prompt === 'string';

function jsonFilesIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json') && !GENERATED.has(e.name))
    .map((e) => path.join(dir, e.name));
}

/** Sorted paths of the task files under `dir`: the directory itself and each of its subdirectories (one level). */
function taskFilesOf(dir) {
  const root = path.resolve(dir);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`directory not found: ${root}`);
  const subs = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')).map((e) => path.join(root, e.name));
  const files = [root, ...subs].flatMap(jsonFilesIn);
  return files.filter((f) => isTask(parse(f))).sort();
}

/** Every task of `dir` as { file, task }. A file that is not valid JSON is a hard error, never skipped silently. */
function loadTaskFiles(dir) {
  const out = [];
  for (const file of taskFilesOf(dir)) out.push({ file, task: parse(file) });
  const seen = new Map();
  for (const { file, task } of out) {
    if (seen.has(task.id)) throw new Error(`task id ${task.id} is in two files: ${seen.get(task.id)} and ${file}`);
    seen.set(task.id, file);
  }
  return out;
}

module.exports = { taskFilesOf, loadTaskFiles, isTask };
