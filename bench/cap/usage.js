// SPDX-License-Identifier: Apache-2.0
'use strict';

// Recomputes which skills each run loaded from its stream.jsonl, for `cap prune-report`. Run directories are only read.
// Layout: <runDir>/<arm>/<task>/<replicate>/{result.json,stream.jsonl,installed-agent.json}, run-config.json beside the arms.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { parseStream, aggregateStream } = require('../runner/lib/stream.js');
const { runtimeOf } = require('../runner/lib/harness/runtime.js');
const { extractSkills, startupKiro, has } = require('../runner/lib/skills.js');

const UNNAMED = '(unnamed)';
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const subdirs = (d) => { try { return fs.readdirSync(d).filter((n) => isDir(path.join(d, n))).sort(); } catch { return []; } };

/** Directories matching a glob whose segments may hold `*` and `?`. Files never match. Sorted. */
function expandGlob(pattern) {
  let level = [path.sep];
  for (const seg of path.resolve(pattern).split(path.sep).filter(Boolean)) {
    const next = [];
    for (const dir of level) {
      if (!/[*?]/.test(seg)) { const p = path.join(dir, seg); if (isDir(p)) next.push(p); continue; }
      const re = new RegExp(`^${seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
      for (const name of subdirs(dir)) if (re.test(name)) next.push(path.join(dir, name));
    }
    level = next;
  }
  return level.sort();
}

// A ref is reported with its commit, so a moving branch is not one row; a variant arm gets its own key.
function refOf({ ref, sha, label }) {
  if (typeof ref === 'string' && ref.startsWith('dir:')) {
    const hash = /@([0-9a-f]{6,})$/.exec(label ?? '');
    return { key: `variant:${hash ? hash[1] : crypto.createHash('sha256').update(ref).digest('hex').slice(0, 12)}`, variant: true };
  }
  return { key: sha ? `${ref}@${sha.slice(0, 7)}` : String(ref), variant: false };
}

function skillFilterOf(agent) {
  if (!agent || typeof agent !== 'object') return null;
  return startupKiro({ mcpServers: agent.mcpServers }).skillFilter;
}

/**
 * One record per counted run, plus how many runs were left out and why. Vanilla arms (no ref) are left out before
 * anything else; then runs without a stream, without a result.json (still running or aborted), with an infra error,
 * with a stream already seen (a copied directory) and runs of a harness that is not being assessed.
 */
function scanRunDirs(dirs, { harnesses = ['kiro-cli', 'opencode'] } = {}) {
  const runs = [];
  const skipped = { vanilla: 0, noStream: 0, noResult: 0, infraError: 0, duplicate: 0, otherHarness: 0 };
  const seen = new Set();
  const dirInfo = [];
  for (const dir of dirs) {
    const config = readJson(path.join(dir, 'run-config.json')) ?? {};
    const info = { dir, counted: 0, skipped: 0, duplicateOf: null };
    for (const arm of subdirs(dir)) {
      const rec = (config.arms ?? []).find((a) => a.id === arm);
      for (const task of subdirs(path.join(dir, arm))) {
        for (const rep of subdirs(path.join(dir, arm, task))) {
          const runPath = path.join(dir, arm, task, rep);
          const result = readJson(path.join(runPath, 'result.json'));
          const vanilla = rec ? rec.ref == null : result ? result.ref == null : /(^|-)vanilla$/.test(arm);
          const skip = (reason) => { skipped[reason]++; info.skipped++; };
          if (vanilla) { skip('vanilla'); continue; }
          const streamFile = path.join(runPath, 'stream.jsonl');
          if (!fs.existsSync(streamFile)) { skip('noStream'); continue; }
          if (!result) { skip('noResult'); continue; }
          if (result.infraError) { skip('infraError'); continue; }
          const raw = fs.readFileSync(streamFile);
          const sha = crypto.createHash('sha256').update(raw).digest('hex');
          if (seen.has(sha)) { skip('duplicate'); continue; }
          const harness = runtimeOf(result) === 'opencode' || runtimeOf(rec) === 'opencode' ? 'opencode' : 'kiro-cli';
          if (!harnesses.includes(harness)) { skip('otherHarness'); continue; }
          seen.add(sha);
          const { events } = parseStream(raw.toString('utf8'));
          const ex = extractSkills(events, harness);
          const loads = {};
          for (const s of ex.skillsLoaded) loads[s.name.toLowerCase()] = { name: s.name, count: s.count, bytes: ex.bytesByName[s.name.toLowerCase()] ?? 0 };
          const agg = harness === 'kiro-cli' ? aggregateStream(events) : null;
          const delegatedTo = agg?.delegatedTo ?? {};
          const installed = harness === 'kiro-cli' ? readJson(path.join(runPath, 'installed-agent.json')) : null;
          const r = refOf({ ref: rec?.ref ?? result.ref, sha: rec?.commitSha ?? result.commitSha, label: rec?.label ?? result.armLabel ?? arm });
          runs.push({
            dir: runPath, runDir: dir, arm, task, replicate: Number(rep), harness, refKey: r.key, variant: r.variant,
            entryAgent: result.agent ?? installed?.name ?? 'konductor', entryFilter: skillFilterOf(installed),
            delegated: Object.keys(delegatedTo).filter((n) => n !== UNNAMED), delegationUnnamed: (delegatedTo[UNNAMED] ?? 0) > 0,
            loads, status: result.status ?? null, credits: typeof result.credits === 'number' ? result.credits : null, wallClockMs: typeof result.wallClockMs === 'number' ? result.wallClockMs : null,
            model: result.model ?? null, armConfig: result.armConfig ?? null,
          });
          info.counted++;
        }
      }
    }
    dirInfo.push(info);
  }
  return { runs, skipped, dirs: dirInfo };
}

/**
 * Is the capability offered to this run, and how do we know? kiro: the entry agent's installed skill filter when the run
 * kept it, else the agents that list the skill in the base tree; any agent the run delegated to; a load proves it. opencode:
 * every skill is in the index of every session. `uncertain` marks a run whose unnamed delegation may have reached an agent
 * that lists the skill, so the run was counted as not exposed.
 */
function exposureOf(run, cap, listedBy) {
  const loaded = run.loads[cap.name.toLowerCase()] ?? null;
  if (run.harness === 'opencode') return { exposed: true, via: 'index', uncertain: false, loaded };
  let via = null;
  if (run.entryFilter) { if (has(run.entryFilter, cap.name)) via = 'entry-filter'; } else if (listedBy.includes(run.entryAgent)) via = 'entry-listing';
  if (!via && run.delegated.some((a) => listedBy.includes(a))) via = 'delegated';
  if (!via && loaded) via = 'loaded';
  return { exposed: via !== null, via, uncertain: via === null && run.delegationUnnamed, loaded };
}

const blank = () => ({ exposed: 0, uncertain: 0, runsLoaded: 0, loads: 0, bytes: 0 });

/**
 * Usage per harness, capability and ref. `caps` are { id, name }; `listedBy(id)` names the agents that list a skill in
 * the base tree. Returns { [harness]: { [capId]: { ...totals, byRef, basis } } }.
 */
function tallyUsage(runs, caps, listedBy, harnesses) {
  const out = {};
  for (const h of harnesses) {
    out[h] = {};
    for (const c of caps) out[h][c.id] = { ...blank(), basis: {}, byRef: {} };
  }
  for (const run of runs) {
    if (!out[run.harness]) continue;
    for (const c of caps) {
      const e = exposureOf(run, c, listedBy(c.id));
      const t = out[run.harness][c.id];
      const ref = (t.byRef[run.refKey] ??= blank());
      for (const bucket of [t, ref]) {
        if (e.exposed) bucket.exposed++;
        if (e.uncertain) bucket.uncertain++;
        if (e.loaded) { bucket.runsLoaded++; bucket.loads += e.loaded.count; bucket.bytes += e.loaded.bytes; }
      }
      if (e.via) t.basis[e.via] = (t.basis[e.via] ?? 0) + 1;
    }
  }
  return out;
}

module.exports = { scanRunDirs, tallyUsage, exposureOf, expandGlob, refOf };
