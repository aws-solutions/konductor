// SPDX-License-Identifier: Apache-2.0
'use strict';

// Helpers for the black-box tests of the CardDemo port: build input records, run the command line in a
// scratch directory, read the outputs. Nothing here looks at the agent's code, only at its files and exit codes.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/;
const MASKED_STAMP = '0000-00-00 00:00:00.000000';
const POS = '{ABCDEFGHI';
const NEG = '}JKLMNOPQR';

const pad = (text, width) => String(text).padEnd(width, ' ');

/** Zoned decimal of `width` characters for an amount given as a string like "-12.30" (2 implied decimals). */
function zoned(amount, width) {
  const negative = String(amount).startsWith('-');
  const [whole, frac = ''] = String(amount).replace('-', '').split('.');
  const digits = (whole + frac.padEnd(2, '0')).replace(/^0+(?=\d)/, '').padStart(width, '0');
  if (digits.length !== width) throw new Error(`amount ${amount} does not fit ${width}`);
  return digits.slice(0, -1) + (negative ? NEG : POS)[Number(digits.slice(-1))];
}

/** One account record (300 characters). Money fields are strings like "100.00". */
function account(o = {}) {
  const d = { id: '00000000001', status: 'Y', balance: '100.00', limit: '1000.00', cash: '0.00', open: '2020-01-01', expiry: '2030-01-01', reissue: '2025-01-01', credit: '0.00', debit: '0.00', zip: '12345', group: 'A', ...o };
  return d.id + pad(d.status, 1) + zoned(d.balance, 12) + zoned(d.limit, 12) + zoned(d.cash, 12) + pad(d.open, 10) + pad(d.expiry, 10)
    + pad(d.reissue, 10) + zoned(d.credit, 12) + zoned(d.debit, 12) + pad(d.zip, 10) + pad(d.group, 10) + ' '.repeat(178);
}

/** One card cross reference record (50 characters). */
function xref(o = {}) {
  const d = { card: '4000000000000001', customer: '000000001', account: '00000000001', ...o };
  return pad(d.card, 16) + d.customer + d.account + ' '.repeat(14);
}

/** One category balance record (50 characters). */
function catbal(o = {}) {
  const d = { account: '00000000001', type: '01', cat: '0001', balance: '0.00', ...o };
  return d.account + pad(d.type, 2) + d.cat + zoned(d.balance, 11) + ' '.repeat(22);
}

/** One disclosure group (rate) record (50 characters). `rate` is a yearly percent such as "18.00". */
function disc(o = {}) {
  const d = { group: 'A', type: '01', cat: '0001', rate: '18.00', ...o };
  return pad(d.group, 10) + pad(d.type, 2) + d.cat + zoned(d.rate, 6) + ' '.repeat(28);
}

/** One transaction record (350 characters). The defaults make a valid small purchase. */
function tran(o = {}) {
  const d = {
    id: '0000000000000001', type: '01', cat: '0001', source: 'POS TERM', desc: 'test purchase', amount: '10.00', merchantId: '000000001',
    merchant: 'Shop', city: 'Town', zip: '11111', card: '4000000000000001', orig: '2026-11-01 08:00:00.000000', proc: '', ...o,
  };
  return pad(d.id, 16) + pad(d.type, 2) + d.cat + pad(d.source, 10) + pad(d.desc, 100) + zoned(d.amount, 11) + d.merchantId + pad(d.merchant, 50)
    + pad(d.city, 50) + pad(d.zip, 10) + pad(d.card, 16) + pad(d.orig, 26) + pad(d.proc, 26) + ' '.repeat(20);
}

/** A reject record: the daily record, a 4-digit code and a 76-character description. */
const reject = (tranRecord, code, text) => tranRecord + String(code).padStart(4, '0') + pad(text, 76);

const TEXT = { 100: 'INVALID CARD NUMBER FOUND', 101: 'ACCOUNT RECORD NOT FOUND', 102: 'OVERLIMIT TRANSACTION', 103: 'TRANSACTION RECEIVED AFTER ACCT EXPIRATION', 104: 'DUPLICATE TRANSACTION ID' };

/** `record` with the characters from offset `from` replaced by `text` (same length). */
const splice = (record, from, text) => record.slice(0, from) + text + record.slice(from + text.length);

/** The text of lines, each ended by a newline (an empty list gives an empty file). */
const lines = (records) => records.map((r) => `${r}\n`).join('');

/** Replace the timestamps of every 350-character transaction line with a fixed text after checking their shape. */
function maskStamps(text, { orig = false, proc = true } = {}) {
  return text.split('\n').map((line) => {
    if (line === '') return line;
    if (line.length < 350) throw new Error(`transaction line of ${line.length} characters`);
    let out = line;
    for (const [on, from] of [[orig, 278], [proc, 304]]) {
      if (!on) continue;
      const stamp = out.slice(from, from + 26);
      if (!STAMP.test(stamp)) throw new Error(`bad timestamp "${stamp}"`);
      out = out.slice(0, from) + MASKED_STAMP + out.slice(from + 26);
    }
    return out;
  }).join('\n');
}

/**
 * Run the port on `files` (name -> text) in a fresh scratch directory and return what it did.
 * `args` are the arguments after the job name (default: --in/--out only). `prepare(inDir, outDir, root)` may change
 * the directories first. `check(result)` runs before the scratch directory is removed.
 */
function run(job, files, check, { args = [], prepare = null, outName = 'out' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cdport-'));
  try {
    const inDir = path.join(root, 'in');
    const outDir = path.join(root, outName);
    fs.mkdirSync(inDir);
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(inDir, name), text);
    if (prepare) prepare(inDir, outDir, root);
    const r = spawnSync('python3', ['-m', 'carddemo_port', job, '--in', inDir, '--out', outDir, ...args], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, timeout: 60000,
    });
    const exists = fs.existsSync(outDir);
    const read = (name) => fs.readFileSync(path.join(outDir, name), 'utf8');
    return check({
      status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', inDir, outDir, root, exists, read,
      files: exists && fs.statSync(outDir).isDirectory() ? fs.readdirSync(outDir).sort() : null,
      siblings: fs.readdirSync(root).sort(),
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

const POST_FILES = ['acctdata.txt', 'dalyrejs.txt', 'summary.json', 'tcatbal.txt', 'transact.txt'];
const INTEREST_FILES = ['acctdata.txt', 'summary.json', 'transact.txt'];

/** The four posting inputs from record lists. */
const postInputs = ({ trans = [], accounts = [account()], xrefs = [xref()], catbals = [] } = {}) => ({
  'dailytran.txt': lines(trans), 'acctdata.txt': lines(accounts), 'cardxref.txt': lines(xrefs), 'tcatbal.txt': lines(catbals),
});

/** The four interest inputs from record lists. */
const interestInputs = ({ accounts = [account()], xrefs = [xref()], catbals = [], rates = [disc({ group: 'DEFAULT' })] } = {}) => ({
  'tcatbal.txt': lines(catbals), 'discgrp.txt': lines(rates), 'acctdata.txt': lines(accounts), 'cardxref.txt': lines(xrefs),
});

/** A run that must have failed with exit code 2 and written nothing. Returns the result for further checks. */
function assertRefused(assert, r) {
  assert.equal(r.status, 2, `exit code ${r.status}, stderr: ${r.stderr}`);
  assert.equal(r.exists, false, 'the output directory must not exist after a failed run');
  assert.deepEqual(r.siblings, ['in'], 'a failed run must leave no temporary file next to the output directory');
  assert.match(r.stderr, /error/i);
  return r;
}

module.exports = { ROOT, STAMP, MASKED_STAMP, zoned, account, xref, catbal, disc, tran, reject, TEXT, lines, splice, maskStamps, run, POST_FILES, INTEREST_FILES, postInputs, interestInputs, assertRefused };
