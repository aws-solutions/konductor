// SPDX-License-Identifier: Apache-2.0
'use strict';

// The evidence file for `cap prune-report`: a JSON list of controlled results a person measured and entered by hand.
// The report reads it; nothing writes it.

const fs = require('node:fs');
const { ID_RE } = require('./registry.js');

const KINDS = ['lift', 'trigger', 'ablation'];
const VERDICTS = ['helps', 'hurts', 'none', 'unmeasurable'];
const HARNESSES = ['kiro-cli', 'opencode'];
const ALIAS = { kiro: 'kiro-cli' };
const KEYS = ['capId', 'harness', 'kind', 'task', 'n', 'delta', 'aaSpread', 'verdict', 'runId', 'note', 'behaviorChange', 'withValue', 'withoutValue'];

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

function checkRow(r, i, errors, warnings) {
  const at = `row ${i + 1}`;
  if (!r || typeof r !== 'object' || Array.isArray(r)) { errors.push(`${at}: must be an object`); return null; }
  const before = errors.length;
  const bad = (msg) => errors.push(`${at}: ${msg}`);
  for (const k of Object.keys(r)) if (!KEYS.includes(k)) bad(`unknown key "${k}" (known: ${KEYS.join(', ')})`);
  if (typeof r.capId !== 'string' || !ID_RE.test(r.capId)) bad(`capId must look like skill:name (got ${JSON.stringify(r.capId)})`);
  const harness = ALIAS[r.harness] ?? r.harness;
  if (!HARNESSES.includes(harness)) bad(`harness must be ${HARNESSES.join(' or ')} (got ${JSON.stringify(r.harness)})`);
  if (!KINDS.includes(r.kind)) bad(`kind must be ${KINDS.join(', ')} (got ${JSON.stringify(r.kind)})`);
  if (typeof r.task !== 'string' || !r.task.trim()) bad('task must be a non-empty string');
  if (!Number.isInteger(r.n) || r.n < 1) bad(`n must be an integer of at least 1 (got ${JSON.stringify(r.n)})`);
  if (r.delta !== null && r.delta !== undefined && !finite(r.delta)) bad(`delta must be a number or null (got ${JSON.stringify(r.delta)})`);
  if (r.aaSpread !== null && r.aaSpread !== undefined && (!finite(r.aaSpread) || r.aaSpread < 0)) bad(`aaSpread must be a number of 0 or more, or null (got ${JSON.stringify(r.aaSpread)})`);
  if (!VERDICTS.includes(r.verdict)) bad(`verdict must be ${VERDICTS.join(', ')} (got ${JSON.stringify(r.verdict)})`);
  if (r.runId !== undefined && r.runId !== null && typeof r.runId !== 'string') bad('runId must be a string or null');
  if (r.note !== undefined && typeof r.note !== 'string') bad('note must be a string');
  if (r.behaviorChange !== undefined && typeof r.behaviorChange !== 'boolean') bad('behaviorChange must be true or false');
  for (const k of ['withValue', 'withoutValue']) if (r[k] !== undefined && r[k] !== null && (!finite(r[k]) || r[k] < 0 || r[k] > 1)) bad(`${k} must be a rate between 0 and 1, or null (got ${JSON.stringify(r[k])})`);
  if (errors.length > before) return null;
  const out = {
    capId: r.capId, harness, kind: r.kind, task: r.task, n: r.n, delta: r.delta ?? null, aaSpread: r.aaSpread ?? null,
    verdict: r.verdict, runId: r.runId ?? null, note: r.note ?? '', behaviorChange: r.behaviorChange ?? false,
    withValue: r.withValue ?? null, withoutValue: r.withoutValue ?? null,
  };
  if (['helps', 'hurts'].includes(out.verdict)) {
    if (out.delta === null) warnings.push(`${at}: verdict ${out.verdict} without a delta; the effect size is unknown`);
    else if (out.aaSpread !== null && Math.abs(out.delta) <= out.aaSpread) warnings.push(`${at}: verdict ${out.verdict} but |delta| ${Math.abs(out.delta)} is inside the A/A spread ${out.aaSpread}`);
  }
  return out;
}

/** { rows, errors, warnings } for the text of an evidence file. Rows are normalised (harness alias, defaults filled). */
function parseEvidence(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return { rows: [], errors: [`not valid JSON (${e.message})`], warnings: [] }; }
  if (!Array.isArray(data)) return { rows: [], errors: ['the file must hold a JSON list of evidence rows'], warnings: [] };
  const errors = [];
  const warnings = [];
  const rows = data.map((r, i) => checkRow(r, i, errors, warnings)).filter(Boolean);
  const seen = new Set();
  for (const r of rows) {
    const key = [r.capId, r.harness, r.kind, r.task, r.runId].join('|');
    if (seen.has(key)) warnings.push(`duplicate evidence for ${r.capId} on ${r.harness} (${r.kind}, task ${r.task}, run ${r.runId ?? '-'})`);
    seen.add(key);
  }
  return { rows, errors, warnings };
}

/** Reads and validates a file; throws one error that lists every problem. */
function loadEvidence(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { throw new Error(`--evidence ${file}: ${e.code === 'ENOENT' ? 'file not found' : e.message}`); }
  const parsed = parseEvidence(text);
  if (parsed.errors.length) throw new Error(`--evidence ${file} is invalid:\n  ${parsed.errors.join('\n  ')}`);
  return { file, rows: parsed.rows, warnings: parsed.warnings };
}

module.exports = { parseEvidence, loadEvidence, KINDS, VERDICTS, HARNESSES };
