// SPDX-License-Identifier: Apache-2.0
'use strict';

// Writes a versioned task file next to its base: `<id>-vN.json` with id `<id>-vN`, version N, and `hidden` pointing at
// `hidden/<id>-vN` (the fixed key), on the same fixture. The base task and its key stay as they are, so scores taken
// with them stay reproducible. Bookkeeping that belongs to the old version (pilot.dryRun, review.recheck.version)
// is dropped; run the batch dry run with --record to score the new key, and a non-Claude recheck before locking.
//   node bench/scenarios/make-version.js <batch> <id> <N> "<who and why>"
// The hidden dir hidden/<id>-vN must already exist (it holds the new key); nothing is copied into it.

const fs = require('node:fs');
const path = require('node:path');

function makeVersion(packDir, batch, id, version, editor, { now = () => new Date().toISOString().slice(0, 10) } = {}) {
  const dir = path.join(packDir, batch);
  const base = JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), 'utf8'));
  if (!(version > base.version)) throw new Error(`${id}: version ${version} is not above the base version ${base.version}`);
  const vid = `${id}-v${version}`;
  if (!fs.existsSync(path.join(dir, 'hidden', vid))) throw new Error(`${vid}: hidden/${vid} does not exist; write the new key first`);
  const out = path.join(dir, `${vid}.json`);
  if (fs.existsSync(out)) throw new Error(`${out} exists`);
  const task = { ...base, id: vid, version, fixture: base.fixture ?? id, hidden: vid };
  task.handEdited = { family: 'claude', editor, log: 'HAND-EDITS.md', version };
  if (task.review?.recheck) task.review = { ...task.review, recheck: Object.fromEntries(Object.entries(task.review.recheck).filter(([k]) => k !== 'version')) };
  if (task.pilot) task.pilot = { ...task.pilot, dryRun: undefined, date: now() };
  fs.writeFileSync(out, `${JSON.stringify(task, null, 2)}\n`);
  return out;
}

if (require.main === module) {
  const [batch, id, n, editor] = process.argv.slice(2);
  if (!batch || !id || !n || !editor) { console.error('usage: node bench/scenarios/make-version.js <batch> <id> <N> "<who and why>"'); process.exit(2); }
  console.log(makeVersion(__dirname, batch, id, Number(n), editor));
}

module.exports = { makeVersion };
