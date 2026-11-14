// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { runtimeOf } = require('../runner/lib/harness/runtime.js');
const { RUBRIC_POLICY } = require('../judge/exclusion.js');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Run layout: <runDir>/<arm>/<task>/<replicate>/result.json. Other directories
// (probes, caches) have no result.json at that depth and are ignored.
function loadRun(runDir) {
  const dir = path.resolve(runDir);
  if (!fs.existsSync(dir)) throw new Error(`run directory not found: ${runDir}`);
  const subdirs = (d) => fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const runs = [];
  for (const arm of subdirs(dir)) {
    for (const task of subdirs(path.join(dir, arm))) {
      for (const rep of subdirs(path.join(dir, arm, task))) {
        const file = path.join(dir, arm, task, rep, 'result.json');
        if (fs.existsSync(file)) {
          runs.push({ armId: arm, taskId: task, replicate: Number(rep), dir: path.dirname(file), result: readJson(file) });
        }
      }
    }
  }
  if (!runs.length) throw new Error(`no result.json files found under ${runDir}`);
  // One harness per run: kiro-cli and opencode report different cost units, so they never share a table.
  const harnesses = [...new Set(runs.map((r) => runtimeOf(r.result)))].sort();
  if (harnesses.length > 1) throw new Error(`run directory mixes harnesses (${harnesses.join(', ')}); report each harness from its own run`);
  const cfgFile = path.join(dir, 'run-config.json');
  const judgFile = path.join(dir, 'judgments.json');
  return {
    dir,
    harness: harnesses[0],
    config: fs.existsSync(cfgFile) ? readJson(cfgFile) : {},
    runs,
    judgments: fs.existsSync(judgFile) ? readJson(judgFile) : null,
  };
}

const keyOf = (arm, task, rep) => `${arm}\u0000${task}\u0000${rep}`;

/**
 * Several run directories as one run (for example one directory per task, or one per replicate). A replicate number that
 * is already taken by an earlier directory is moved to the next free one, and the judgment records follow it.
 * One directory gives exactly what loadRun gives.
 */
function loadRuns(dirs) {
  if (dirs.length === 1) return loadRun(dirs[0]);
  const loaded = dirs.map((d) => loadRun(d));
  const harnesses = [...new Set(loaded.map((r) => r.harness))];
  if (harnesses.length > 1) throw new Error(`run directories mix harnesses (${harnesses.join(', ')}); report each harness from its own run`);
  const used = new Map();
  const runs = [];
  const remap = [];
  loaded.forEach((r, di) => {
    const map = new Map();
    for (const e of r.runs) {
      const slot = `${e.armId}\u0000${e.taskId}`;
      const taken = used.get(slot) || new Set();
      let rep = e.replicate;
      while (taken.has(rep)) rep++;
      taken.add(rep);
      used.set(slot, taken);
      map.set(keyOf(e.armId, e.taskId, e.replicate), rep);
      runs.push({ ...e, replicate: rep, sourceReplicate: e.replicate, sourceDir: r.dir, result: { ...e.result, replicate: rep } });
    }
    remap[di] = map;
  });
  const cfgs = loaded.map((r) => r.config);
  const first = cfgs[0] || {};
  const union = (k) => [...new Set(cfgs.flatMap((c) => c[k] || []))];
  const config = { ...first, taskIds: union('taskIds'), armIds: union('armIds'), arms: [...new Map(cfgs.flatMap((c) => c.arms || []).map((a) => [a.id, a])).values()] };
  const withJudg = loaded.map((r, i) => ({ j: r.judgments, map: remap[i] })).filter((x) => x.j);
  let judgments = null;
  if (withJudg.length) {
    const fix = (rec, map) => ({ ...rec, replicate: map.get(keyOf(rec.armId, rec.taskId, rec.replicate)) ?? rec.replicate });
    const judges = [...new Set(withJudg.flatMap((x) => x.j.judges || []))];
    const families = [...new Set(withJudg.flatMap((x) => x.j.panel?.families || []))];
    const spentByJudge = {};
    for (const x of withJudg) for (const [k, v] of Object.entries(x.j.spentByJudge || {})) spentByJudge[k] = (spentByJudge[k] || 0) + v;
    // Judgments from before the backend label existed came from kiro. Verdicts from different backends are not comparable.
    const backends = [...new Set(withJudg.map((x) => x.j.backend ?? 'kiro'))].sort();
    const usdDirs = withJudg.filter((x) => x.j.spentUsd !== undefined);
    const spentUsdByJudge = {};
    for (const x of usdDirs) for (const [k, v] of Object.entries(x.j.spentUsdByJudge || {})) spentUsdByJudge[k] = (spentUsdByJudge[k] || 0) + v;
    const infos = withJudg.map((x) => x.j.backendInfo).filter(Boolean);
    judgments = {
      ...withJudg[0].j,
      backend: backends.length > 1 ? 'mixed' : backends[0], backends,
      backendInfo: backends.length === 1 && infos.length ? { ...infos[0], models: Object.assign({}, ...infos.map((i) => i.models || {})) } : undefined,
      ...(usdDirs.length ? { spentUsd: usdDirs.reduce((n, x) => n + x.j.spentUsd, 0), spentUsdByJudge } : {}),
      judges, modes: [...new Set(withJudg.flatMap((x) => x.j.modes || []))],
      panel: { families, small: families.length < 3 },
      spentCredits: withJudg.reduce((n, x) => n + (x.j.spentCredits || 0), 0), spentByJudge,
      invocations: withJudg.flatMap((x) => x.j.invocations || []),
      notJudged: withJudg.flatMap((x) => (x.j.notJudged || []).map((n) => fix(n, x.map))),
      rubric: withJudg.flatMap((x) => (x.j.rubric || []).map((rec) => fix(rec, x.map))),
      pairwise: withJudg.flatMap((x) => (x.j.pairwise || []).map((rec) => fix(rec, x.map))),
      graded: withJudg.flatMap((x) => (x.j.graded || []).map((rec) => fix(rec, x.map))),
    };
    // The merged set follows the new rubric policy only when every judged directory does; one older directory makes it legacy.
    if (!withJudg.every((x) => x.j.rubricPolicy === RUBRIC_POLICY)) delete judgments.rubricPolicy;
  }
  return { dir: loaded.map((r) => r.dir).join(', '), dirs: loaded.map((r) => r.dir), harness: harnesses[0], config, configs: loaded.map((r) => ({ dir: r.dir, config: r.config })), runs, judgments, merged: true };
}

module.exports = { loadRun, loadRuns, readJson };
