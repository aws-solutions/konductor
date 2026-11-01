// SPDX-License-Identifier: Apache-2.0
'use strict';

// Rewrites the stream-derived fields of finished engine v3 runs whose result.json was written before the runner could
// read v3: credits null, tools unknown, no spawns. The figures come from stream.jsonl through the runner's own parsers.
// A run that was killed has no credit data in v3 and stays censored.

const fs = require('node:fs');
const path = require('node:path');
const { loadRun } = require('../../report/load.js');
const { aggregateRunDir } = require('./harness/kiro.js');
const { runtimeOf } = require('./harness/runtime.js');
const { orchMetricsOfRunDir } = require('./orch-metrics.js');
const { streamFields, validateResult } = require('./result.js');
const { openLedger, readLedger } = require('./credit-ledger.js');

const PRE_BACKFILL = '.pre-backfill';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// A killed run's result.json cannot be corrected, but its spawn count can be stale; say so.
function staleOrchNote(dir, result) {
  try {
    const orch = orchMetricsOfRunDir(dir);
    if (!orch || orch.spawns === (result.orch?.spawns ?? 0)) return undefined;
    return `stream shows ${plural(orch.spawns, 'spawn')}, result.json has ${result.orch?.spawns ?? 0}`;
  } catch { return undefined; }
}

// What the backfill would do with one run: { status, reason?, note?, next? }.
function assess({ dir, result, now }) {
  if (runtimeOf(result) !== 'kiro-cli') return { status: 'skipped', reason: 'not a kiro-cli run' };
  if (result.status === 'budget_skipped') return { status: 'skipped', reason: 'budget-skipped run' };
  if (result.credits != null) return { status: 'complete' };
  if (result.status === 'timeout' || result.creditsCensored) {
    return { status: 'unrecoverable', reason: `${result.status === 'timeout' ? 'timed out' : 'killed'} before its turn ended; credits stay censored`, note: staleOrchNote(dir, result) };
  }
  let agg;
  try { agg = aggregateRunDir(dir); } catch { return { status: 'unrecoverable', reason: 'no stream.jsonl' }; }
  if (agg.meteringEntries === 0) {
    const units = agg.nonCreditUnits.length ? `its turn_completion reports ${agg.nonCreditUnits.join(', ')}, not credits` : 'no turn_completion in the stream (a v2 stream, or the run ended before its turn did)';
    return { status: 'unrecoverable', reason: units };
  }
  if (agg.runFinishedStatus === null) return { status: 'unrecoverable', reason: 'the stream has a turn_completion but no runFinished' };
  const fromStream = streamFields(agg, orchMetricsOfRunDir(dir) ?? result.orch ?? null);
  const next = {
    ...result,
    turnDurationMs: fromStream.turnDurationMs,
    credits: fromStream.credits,
    creditsCharged: fromStream.credits,
    modelCalls: { ...(result.modelCalls ?? {}), meteringEntries: fromStream.meteringEntries, totalRequestCount: result.modelCalls?.totalRequestCount ?? null },
    toolCalls: fromStream.toolCalls,
    workToolCalls: fromStream.workToolCalls,
    toolNames: fromStream.toolNames,
    subagentCalls: fromStream.subagentCalls,
    orch: fromStream.orch,
    flags: [...new Set([...(result.flags ?? []), ...fromStream.flags])],
    creditsBackfill: { at: now(), source: 'stream.jsonl' },
  };
  const errors = validateResult(next);
  if (errors.length) return { status: 'unrecoverable', reason: `the rewritten result.json would not validate: ${errors[0]}` };
  return { status: 'recovered', next };
}

// Credits already charged to this run by earlier ledger lines, so a corrected line adds only the difference.
function chargedBefore(entries, { armId, taskId, replicate }) {
  return entries
    .filter((e) => (e.kind === 'run' || e.kind === 'backfill') && e.arm === armId && e.task === taskId && e.replicate === replicate)
    .reduce((n, e) => n + (finite(e.charged) ? e.charged : finite(e.credits) ? e.credits : 0), 0);
}

// Order: keep a copy of the original, append the ledger line, then replace result.json. A run interrupted between the
// last two is finished by the next call, which finds no difference left to charge.
function applyOne({ entry, ledger, ledgerEntries }) {
  const file = path.join(entry.dir, 'result.json');
  const copy = `${file}${PRE_BACKFILL}`;
  const original = fs.readFileSync(file, 'utf8');
  if (fs.existsSync(copy)) {
    if (fs.readFileSync(copy, 'utf8') !== original) return { status: 'unrecoverable', reason: `result.json${PRE_BACKFILL} already exists and differs; not overwritten` };
  } else {
    fs.copyFileSync(file, copy, fs.constants.COPYFILE_EXCL);
  }
  const failuresBefore = ledger.totals().writeFailures;
  const previous = chargedBefore(ledgerEntries, entry);
  const { next } = entry.plan;
  ledger.record({
    kind: 'backfill', unit: 'credits', arm: entry.armId, task: entry.taskId, replicate: entry.replicate, status: next.status,
    credits: next.credits, charged: next.credits - previous, censored: false, previousCharged: previous, source: 'stream.jsonl',
  });
  if (ledger.totals().writeFailures > failuresBefore) return { status: 'unrecoverable', reason: 'the ledger line could not be written; result.json left as it was' };
  writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
  return { status: 'recovered' };
}

/**
 * runDir: one results cell (<arm>/<task>/<rep>/result.json and credit-ledger.jsonl). Returns one entry per run:
 * { armId, taskId, replicate, dir, status: recovered|complete|unrecoverable|skipped, reason?, note?, credits?, before? }.
 * Nothing is written unless write is true.
 */
function backfillAll({ runDir, write = false, now = () => new Date().toISOString() }) {
  const run = loadRun(runDir);
  const ledgerEntries = readLedger(run.dir).entries;
  const ledger = write ? openLedger({ dir: run.dir, now: () => new Date(now()) }) : null;
  return run.runs.map((r) => {
    const entry = { armId: r.armId, taskId: r.taskId, replicate: r.replicate, dir: r.dir, before: r.result.credits ?? null };
    const plan = assess({ dir: r.dir, result: r.result, now });
    if (plan.status !== 'recovered') return { ...entry, status: plan.status, reason: plan.reason, note: plan.note };
    const out = { ...entry, credits: plan.next.credits, plan };
    const applied = write ? applyOne({ entry: out, ledger, ledgerEntries }) : { status: 'recovered' };
    const { plan: _plan, ...rest } = out;
    return { ...rest, ...applied };
  });
}

module.exports = { backfillAll, PRE_BACKFILL };
