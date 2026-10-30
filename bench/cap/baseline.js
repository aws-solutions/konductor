// SPDX-License-Identifier: Apache-2.0
'use strict';

// The shrink-only ratchet for audit lint findings: bench/capabilities/audit-baseline.json lists the findings that exist
// today and are tolerated. A finding not in the file fails the audit, and so does a listed finding that no longer
// occurs, so the file can only get shorter. `cap audit --update-baseline` is the only thing that writes it.

const fs = require('node:fs');
const path = require('node:path');

const BASELINE_FILE = 'audit-baseline.json';

// The rules a baseline can waive: the lint checks and the warn-level description checks.
const RATCHET_RULES = new Set(['description-no-cue', 'description-short', 'description-long', 'description-block-scalar']);
const isRatchetRule = (rule) => rule.startsWith('lint-') || RATCHET_RULES.has(rule);

const fileOf = (benchDir) => path.join(benchDir, 'capabilities', BASELINE_FILE);

/** The parsed baseline, or null when there is no file. A damaged file throws. */
function readBaseline(benchDir) {
  const file = fileOf(benchDir);
  if (!fs.existsSync(file)) return null;
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${BASELINE_FILE} is not valid JSON (${e.message.slice(0, 80)}); fix or delete it`); }
  if (!j || j.schemaVersion !== 1 || !j.waived || typeof j.waived !== 'object') throw new Error(`${BASELINE_FILE} must have schemaVersion 1 and a waived object`);
  return j;
}

/**
 * Marks the ratchet findings of a list: waived ones stay warnings, new ones become errors, and each waiver with no
 * finding becomes a `ratchet-stale` error. Returns { findings, summary }.
 */
function applyBaseline(findings, baseline) {
  if (!baseline) return { findings, summary: null };
  const waived = new Set(Object.keys(baseline.waived));
  const seen = new Set();
  const out = findings.map((f) => {
    if (!isRatchetRule(f.rule) || !f.fid) return f;
    seen.add(f.fid);
    if (waived.has(f.fid)) return { ...f, waived: true };
    return { ...f, level: 'error', ratchet: 'new', msg: `new, not in the baseline: ${f.msg}` };
  });
  const stale = [...waived].filter((fid) => !seen.has(fid)).sort();
  for (const fid of stale) out.push({ level: 'error', id: null, rule: 'ratchet-stale', msg: `waiver "${fid}" now passes; remove it from ${BASELINE_FILE} (cap audit --update-baseline)`, fid });
  return { findings: out, summary: { waived: [...seen].filter((x) => waived.has(x)).length, new: out.filter((f) => f.ratchet === 'new').length, stale: stale.length } };
}

/**
 * Writes the baseline from a report. With no file it records every current ratchet finding. With a file it only
 * removes waivers that no longer match; adding any needs `force`. Returns { written, added, removed, count, file }.
 */
function baselineUpdate({ report, benchDir, force = false, now = new Date() }) {
  const current = new Map();
  for (const f of report.findings) if (f.fid && isRatchetRule(f.rule)) current.set(f.fid, { rule: f.rule, id: f.id });
  const existing = readBaseline(benchDir);
  const file = fileOf(benchDir);
  const old = existing ? Object.keys(existing.waived) : [];
  const added = [...current.keys()].filter((k) => !old.includes(k)).sort();
  const removed = old.filter((k) => !current.has(k)).sort();
  if (existing && added.length && !force) return { written: false, added, removed, count: old.length, file };
  const keep = existing && !force ? old.filter((k) => current.has(k)) : [...current.keys()];
  const waived = Object.fromEntries(keep.sort().map((k) => [k, current.get(k) ?? existing.waived[k]]));
  const doc = {
    schemaVersion: 1,
    note: 'Findings tolerated today. A finding not listed fails `cap audit`; a listed finding that no longer occurs also fails until it is removed. Edit with `cap audit --update-baseline`.',
    base: { ref: report.base.ref ?? report.base.spec, commitSha: report.base.commitSha ?? null },
    updatedAt: now.toISOString(),
    waived,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  return { written: true, added: existing && !force ? [] : added, removed, count: keep.length, file };
}

module.exports = { readBaseline, applyBaseline, baselineUpdate, isRatchetRule, BASELINE_FILE, RATCHET_RULES };
