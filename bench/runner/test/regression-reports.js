// SPDX-License-Identifier: Apache-2.0
'use strict';

// Builds a kiro-cli run and an opencode run on disk and renders their reports with the code under `benchRoot`.
// The golden files were produced with the code from before the Claude Code harness was added, so a test that
// renders the same runs with the current code and compares proves existing results still report the same.

const fs = require('node:fs');
const path = require('node:path');
const { tmp, write, makeBench, makeRun } = require('./helpers.js');

const STREAM = fs.readFileSync(path.join(__dirname, 'fixtures', 'opencode-vanilla.stream.jsonl'), 'utf8');
const tokens = (total) => ({ input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: total - 2, total });

function buildResults(benchRoot) {
  const { buildResult } = require(path.join(benchRoot, 'runner/lib/result.js'));
  const task = { id: 't1', class: 'simple', checks: [], timeoutSec: 60 };
  const agg = {
    sessionId: 's1', sessionIds: ['s1'], runFinishedStatus: 'success', stopReason: 'end_turn', credits: 1.5, meteringEntries: 2, nonCreditUnits: [], turnDurationMs: 900,
    contextUsagePercentage: 3, toolCalls: 4, workToolCalls: 3, subagentCalls: 1, toolNames: { read: 3, subagent: 1 }, skillsMcpOk: true, finalText: 'done', finalTextTruncated: false, askedUser: false,
  };
  const exec = { timedOut: false, exitCode: 0, wallClockMs: 1000, startedAt: '2026-01-01T00:00:00.000Z' };
  const kiro = buildResult({
    arm: { id: 'v1', label: 'v1', ref: 'v1.2.0', commitSha: 'a'.repeat(40), harness: 'kiro-cli-v2', runtime: 'kiro-cli', agent: 'konductor', vanilla: false },
    task, replicate: 1, config: { model: 'claude-sonnet-5.5', effort: 'high', agentEngine: 'v3' }, exec, agg, session: { model: 'claude-sonnet-5.5', totalRequestCount: 2 },
    checks: [], transcript: { bytes: 400, chars: 400, partial: false }, env: { kiroCliVersion: 'kiro-cli 2.35.1', modelListSnapshotPath: null }, meta: { flags: [], agentStarted: true },
  });
  const oc = buildResult({
    arm: { id: 'oc-v1', label: 'oc-v1', ref: 'v1.2.0', commitSha: 'a'.repeat(40), harness: 'claude', runtime: 'opencode', agent: 'konductor', vanilla: false },
    task, replicate: 1, config: { model: 'global.anthropic.claude-sonnet-5-5', effort: 'high' }, exec: { ...exec, timedOut: true, exitCode: null },
    agg: { ...agg, runFinishedStatus: null, credits: 0, meteringEntries: 0 }, session: { model: 'global.anthropic.claude-sonnet-5-5', totalRequestCount: 2 },
    usage: { tokens: { input: 1, output: 2, reasoning: 0, cacheRead: 3, cacheWrite: 4, total: 10 }, costUsd: 0.5, modelCalls: 2, sessions: 2, variants: [] },
    checks: [], transcript: { bytes: 400, chars: 400, partial: false }, env: { harnessVersion: '1.19.5', region: 'us-east-1' }, meta: { flags: [], agentStarted: true },
  });
  return { kiro, oc };
}

function produce(benchRoot) {
  const { buildReport } = require(path.join(benchRoot, 'report/aggregate.js'));
  const { renderMarkdown } = require(path.join(benchRoot, 'report/render.js'));
  const { loadRun } = require(path.join(benchRoot, 'report/load.js'));
  const { loadTasks } = require(path.join(benchRoot, 'runner/lib/tasks.js'));
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const out = {};
    const kiroRuns = [1, 2, 3].flatMap((rep) => [
      { arm: 'vanilla', rep, credits: 1 + rep }, { arm: 'v1.2.0', rep, credits: 3 + rep },
    ]);
    makeRun(path.join(root, 'kiro'), bench, kiroRuns);
    const ocRuns = [1, 2, 3].flatMap((rep) => [
      { arm: 'oc-vanilla', rep, usd: 0.03 }, { arm: 'oc-k', rep, usd: 0.1 * rep },
    ]).map(({ arm, rep, usd }) => ({
      arm, rep, harness: 'opencode', credits: null, kiroCliVersion: null, harnessVersion: '1.19.5', model: 'global.anthropic.claude-sonnet-5-5',
      costUsd: usd, costCensored: false, tokens: tokens(1000 * rep), estTokens: { value: 1000 * rep, isEstimate: false },
    }));
    makeRun(path.join(root, 'oc'), bench, ocRuns, { harness: 'opencode', harnessVersion: '1.19.5', model: 'global.anthropic.claude-sonnet-5-5' });
    for (const s of ocRuns) write(path.join(root, 'oc', s.arm, 't1', String(s.rep), 'stream.jsonl'), STREAM);
    for (const name of ['kiro', 'oc']) {
      const run = loadRun(path.join(root, name));
      const r = buildReport({ run, tasks: loadTasks(bench) });
      const norm = (text) => text.split(path.join(root, name)).join('<DIR>');
      out[name] = { harness: run.harness, json: JSON.parse(norm(JSON.stringify(r.report))), md: norm(renderMarkdown(r.report)) };
    }
    out.results = buildResults(benchRoot);
    return out;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = { produce };
