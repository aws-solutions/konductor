'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sha256, writeAtomic } = require('./io');
const { toV2 } = require('./schema');

class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const paths = (dir) => ({
  file: path.join(dir, 'orders.jsonl'),
  backup: path.join(dir, 'orders.v1.bak'),
  rejects: path.join(dir, 'rejects.jsonl'),
  state: path.join(dir, '.migration-state.json'),
});

function convert(text) {
  const out = [];
  const rejects = [];
  const seen = new Set();
  let migrated = 0;
  let skipped = 0;
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === '') return;
    const reject = (reason) => {
      rejects.push({ line: i + 1, reason, raw: line });
      out.push(line);
    };
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      return reject('invalid json');
    }
    if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) return reject('invalid json');
    const dup = typeof rec.id === 'string' && rec.id !== '' && seen.has(rec.id);
    if (typeof rec.id === 'string') seen.add(rec.id);
    if (rec.schema === 2) {
      out.push(line);
      skipped += 1;
      return;
    }
    let converted;
    try {
      converted = toV2(rec);
    } catch (e) {
      return reject(e.message);
    }
    if (dup) return reject('duplicate id');
    out.push(JSON.stringify(converted));
    migrated += 1;
  });
  return { out, rejects, summary: { migrated, skipped, rejected: rejects.length } };
}

function up(dir, { dryRun = false } = {}) {
  const p = paths(dir);
  if (!fs.existsSync(p.file)) throw new CliError(2, `missing ${p.file}`);
  const original = fs.readFileSync(p.file);
  const { out, rejects, summary } = convert(original.toString('utf8'));
  const next = out.length ? `${out.join('\n')}\n` : '';
  const rejectText = rejects.length ? `${rejects.map((r) => JSON.stringify(r)).join('\n')}\n` : null;
  if (dryRun) return summary;

  const rejectsNow = fs.existsSync(p.rejects) ? fs.readFileSync(p.rejects, 'utf8') : null;
  if (next === original.toString('utf8') && rejectText === rejectsNow) return summary;

  if (!fs.existsSync(p.backup)) writeAtomic(p.backup, original);
  if (rejectText === null) fs.rmSync(p.rejects, { force: true });
  else writeAtomic(p.rejects, rejectText);
  writeAtomic(p.file, next);
  writeAtomic(p.state, JSON.stringify({ backupSha256: sha256(fs.readFileSync(p.backup)), resultSha256: sha256(Buffer.from(next)) }));
  return summary;
}

function down(dir, { dryRun = false, force = false } = {}) {
  const p = paths(dir);
  if (!fs.existsSync(p.backup) || !fs.existsSync(p.state)) throw new CliError(2, 'nothing to roll back: backup or state file is missing');
  const state = JSON.parse(fs.readFileSync(p.state, 'utf8'));
  const current = fs.existsSync(p.file) ? sha256(fs.readFileSync(p.file)) : null;
  if (current !== state.resultSha256 && !force) throw new CliError(3, 'orders.jsonl changed since the last up; use --force to restore anyway');
  if (dryRun) return { restored: false, dryRun: true };
  writeAtomic(p.file, fs.readFileSync(p.backup));
  for (const f of [p.backup, p.rejects, p.state]) fs.rmSync(f, { force: true });
  return { restored: true };
}

module.exports = { up, down, CliError };
