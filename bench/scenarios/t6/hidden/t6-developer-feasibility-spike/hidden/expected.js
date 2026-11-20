'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT } = require('./doc-key.js');

// Facts of the three checked-in samples (measured with an independent parser).
const SAMPLES = {
  'sample-a': { rows: 30000, drift: { order_id: null, customer_ref: null, qty: null, unit_price: null, ordered_on: null, status: null, coupon: null } },
  'sample-b': { rows: 36000, drift: { sku: null, bin_code: null, on_hand: null, reorder_level: null, unit_cost: null, weight_kg: null, discount: null, counted_on: null, supplier_note: null } },
  'sample-c': { rows: 42000, drift: { parcel_id: null, depot: null, weight_kg: 21535, bay: 26739, declared_value: null, cod_amount: null, scanned_on: null, delivered_on: 31296, service_note: null } },
};

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pad = (n, w) => String(n).padStart(w, '0');
const q = (s) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const isoDay = (n) => new Date(Date.UTC(2023, 0, 1) + n * 86400000).toISOString().slice(0, 10);

/** File X: LF, quoted line breaks, 24000 rows. Drift is planted at known rows. */
function makeX() {
  const r = rng(9001);
  const N = 24000;
  const lines = ['id,amount,code,stamp,memo,flag'];
  for (let i = 1; i <= N; i++) {
    const amount = i === 7321 ? '10.25' : i > 7321 && r() < 0.3 ? (5 + r() * 400).toFixed(2) : String(5 + Math.floor(r() * 495));
    const code = i === 12004 ? '007' : String(1 + Math.floor(r() * 90));
    let stamp = isoDay(i % 700);
    if (i === 60) stamp = '2024-02-29';
    if (i === 9000) stamp = ' ';
    if (i === 18000) stamp = '2024-13-40';
    let memo = r() < 0.5 ? `batch ${i % 17}` : '';
    if (i % 700 === 0) memo = `moved, "rush"\nsee desk ${i % 9}`;
    const flagCell = i >= 10000 && (i === 10000 || i % 3 === 0) ? 'yes' : String(1 + (i % 2));
    lines.push([i, amount, code, stamp, q(memo), flagCell].join(','));
  }
  return { text: lines.join('\n') + '\n', rows: N, drift: { id: null, amount: 7321, code: 12004, stamp: 18000, memo: null, flag: 10000 } };
}

/** File Y: CRLF, a BOM, 20000 rows, boundary cases around row 500. */
function makeY() {
  const r = rng(4242);
  const N = 20000;
  const lines = ['k,qty,late_text,price,edge_a,edge_b,mixed,late_date'];
  for (let i = 1; i <= N; i++) {
    const qty = i >= 400 && i <= 5000 ? '' : String(1 + Math.floor(r() * 50));
    const late = i <= 3000 ? '' : `abc${i % 13}`;
    const price = i === 14500 ? 'N/A' : (1 + r() * 20).toFixed(2);
    const edgeA = i === 500 ? 'x' : i < 500 ? String(1 + (i % 9)) : r() < 0.5 ? String(i % 11) : 'y';
    const edgeB = i === 501 ? 'x' : String(1 + (i % 9));
    const mixed = i === 1 ? '1.5' : i % 2 ? String(i % 40) : (r() * 40).toFixed(1);
    const lateDate = i === 2001 ? '5' : isoDay(i % 400);
    lines.push([pad(i, 5), qty, late, price, edgeA, edgeB, mixed, lateDate].join(','));
  }
  return { text: '\uFEFF' + lines.join('\r\n') + '\r\n', rows: N, drift: { k: null, qty: null, late_text: null, price: 14500, edge_a: null, edge_b: 501, mixed: null, late_date: 2001 } };
}

function withTempFile(text, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spike-'));
  const file = path.join(dir, 'input.csv');
  fs.writeFileSync(file, text);
  try { return fn(file); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** Runs spike/measure.js on `file`; returns { status, out (parsed or null), stdout, stderr }. */
function runMeasure(file) {
  const r = spawnSync(process.execPath, ['spike/measure.js', file], { cwd: ROOT, encoding: 'utf8', timeout: 12000, maxBuffer: 1 << 24 });
  let out = null;
  try { out = JSON.parse(r.stdout.trim()); } catch { /* leave null */ }
  return { status: r.status, out, stdout: r.stdout, stderr: r.stderr };
}

module.exports = { SAMPLES, makeX, makeY, withTempFile, runMeasure };
