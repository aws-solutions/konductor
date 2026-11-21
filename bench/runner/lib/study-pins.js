// SPDX-License-Identifier: Apache-2.0
'use strict';

// An arm id names a directory of results in --out. A ref such as main or origin/main resolves to whatever the local
// remote-tracking ref holds when the command starts, so a fetch between two commands on the same study directory would
// silently put two commits under one arm id. Each command compares the commits it resolved with the ones already
// recorded there and refuses a change.

const fs = require('node:fs');
const path = require('node:path');
const { readRunConfigs } = require('./run-configs.js');

const { readJsonOrNull: readJson } = require('./util.js');

const listDirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };

/** What identifies an arm's content: the commit of a git arm, the snapshot hash of a directory arm, null for an arm with no ref. */
function pinOf(rec) {
  if (!rec) return null;
  if (rec.commitSha) return { kind: 'commit', value: rec.commitSha };
  if (rec.source === 'dir' && rec.contentHash) return { kind: 'content', value: rec.contentHash };
  return null;
}

/** The pins already recorded in `outDir` for the given arm ids: from run-config.json and every result.json under <arm>/<task>/<rep>. */
function recordedPins(outDir, armIds) {
  const found = new Map();
  const note = (armId, rec, file) => {
    const pin = pinOf(rec);
    if (!pin) return;
    const list = found.get(armId) ?? [];
    if (!list.some((p) => p.kind === pin.kind && p.value === pin.value)) list.push({ ...pin, file });
    found.set(armId, list);
  };
  const wanted = new Set(armIds);
  const cfgFile = path.join(outDir, 'run-config.json');
  for (const cfg of readRunConfigs(outDir)) for (const a of cfg.arms ?? []) if (wanted.has(a?.id)) note(a.id, a, cfgFile);
  for (const armId of wanted) {
    const armDir = path.join(outDir, armId);
    for (const task of listDirs(armDir)) {
      for (const rep of listDirs(path.join(armDir, task))) {
        const file = path.join(armDir, task, rep, 'result.json');
        const r = readJson(file);
        if (r && r.armId === armId) note(armId, r, file);
      }
    }
  }
  return found;
}

/** Arms whose resolved content differs from what `outDir` already holds for the same arm id. */
function pinConflicts(outDir, arms) {
  const recorded = recordedPins(outDir, arms.map((a) => a.id));
  const conflicts = [];
  for (const a of arms) {
    const now = pinOf(a);
    if (!now) continue;
    for (const old of recorded.get(a.id) ?? []) {
      if (old.kind !== now.kind || old.value !== now.value) conflicts.push({ armId: a.id, ref: a.ref ?? null, recorded: old.value, now: now.value, kind: now.kind, file: old.file });
    }
  }
  return conflicts;
}

/** The error text for `conflicts`, naming each arm, both values and the ways out. */
function describeConflicts(conflicts, outDir) {
  const lines = conflicts.map((c) => `  arm ${c.armId}${c.ref ? ` (${c.ref})` : ''}: ${outDir} holds ${c.kind} ${c.recorded.slice(0, 12)} (${path.relative(outDir, c.file)}), this command resolved ${c.now.slice(0, 12)}`);
  return [
    `arm content changed since earlier results were written to ${outDir}:`,
    ...lines,
    'Results of one arm id must come from one commit. Give a name=<ref> arm the recorded commit (name=<sha>); the built-in',
    'main arm follows origin/main, so use a new --out for it. Or pass --allow-arm-drift to mix them anyway (run-config records it).',
  ].join('\n');
}

module.exports = { pinOf, recordedPins, pinConflicts, describeConflicts };
