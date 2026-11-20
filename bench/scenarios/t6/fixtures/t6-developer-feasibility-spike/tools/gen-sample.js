#!/usr/bin/env node
'use strict';

// Writes the three synthetic sample files used for import-preview work.
//   node tools/gen-sample.js            -> data/sample-a.csv, sample-b.csv, sample-c.csv
// Output is deterministic: same seeds, same bytes.

const fs = require('node:fs');
const path = require('node:path');

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

const pick = (r, list) => list[Math.floor(r() * list.length)];
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const money = (r, lo, hi) => (lo + r() * (hi - lo)).toFixed(2);
const pad = (n, w) => String(n).padStart(w, '0');

function day(offset, start = Date.UTC(2024, 0, 1)) {
  return new Date(start + offset * 86400000).toISOString().slice(0, 10);
}

function field(v) {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const line = (cells) => cells.map(field).join(',') + '\n';

// ---- sample-a: web shop orders -------------------------------------------------------------

function sampleA(rows = 30000) {
  const r = rng(1101);
  const header = ['order_id', 'customer_ref', 'qty', 'unit_price', 'ordered_on', 'status', 'coupon'];
  const out = [line(header)];
  const status = ['paid', 'paid', 'paid', 'shipped', 'shipped', 'refunded', 'pending'];
  const coupons = ['SPRING10', 'WELCOME5', 'LOYAL15', 'FREESHIP'];
  for (let i = 1; i <= rows; i++) {
    out.push(line([
      100000 + i,
      `C-${pad(int(r, 1, 99999), 5)}`,
      int(r, 1, 40),
      money(r, 2, 180),
      day(Math.floor(i / 85)),
      pick(r, status),
      r() < 0.08 || i === 3 ? pick(r, coupons) : '',
    ]));
  }
  return out.join('');
}

// ---- sample-b: warehouse stock counts ------------------------------------------------------

function sampleB(rows = 36000) {
  const r = rng(2202);
  const header = ['sku', 'bin_code', 'on_hand', 'reorder_level', 'unit_cost', 'weight_kg', 'discount', 'counted_on', 'supplier_note'];
  const out = [line(header)];
  const notes = ['slow mover', 'new supplier, check pack size', 'damaged pallet, 2 units', 'seasonal', 'see PO 4471, partial', 'relabelled'];
  for (let i = 1; i <= rows; i++) {
    const inGap = i >= 2000 && i < 9500;
    let discount = '';
    if (inGap) discount = r() < 0.04 ? ' ' : '';
    else discount = r() < 0.3 || i < 4 ? (int(r, 1, 30) / 100).toFixed(2) : '';
    let note = '';
    const q = r();
    if (q < 0.03 || i === 7) note = pick(r, notes);
    else if (q < 0.034) note = `Counted twice,\nsecond count differs by ${int(r, 1, 6)}`;
    const w = r();
    out.push(line([
      `SKU-${pad(i, 6)}`,
      i === 1 ? '007' : pad(int(r, 1, 120), 3),
      int(r, -3, 400),
      int(r, 5, 60),
      money(r, 0.4, 90),
      i === 2 ? '0.45' : w < 0.35 ? String(int(r, 1, 25)) : (int(r, 5, 250) / 10).toFixed(1),
      discount,
      day(Math.floor(i / 120), Date.UTC(2024, 5, 1)),
      note,
    ]));
  }
  return out.join('');
}

// ---- sample-c: parcel scans ----------------------------------------------------------------

function sampleC(rows = 42000) {
  const r = rng(3303);
  const header = ['parcel_id', 'depot', 'weight_kg', 'bay', 'declared_value', 'cod_amount', 'scanned_on', 'delivered_on', 'service_note'];
  const out = [line(header)];
  const depots = ['Northgate', 'Quayside', 'Millbrook', 'Eastfield', 'Carrow', 'Hythe'];
  for (let i = 1; i <= rows; i++) {
    const scanned = Math.floor(i / 140);
    const weight = i >= 20500 && r() < 0.0015 ? (int(r, 10, 300) / 10).toFixed(1) : String(int(r, 1, 30));
    const bay = i >= 25000 && r() < 0.0005 ? pad(int(r, 1, 9), 3) : String(int(r, 1, 99));
    const cod = i >= 4000 && i < 8000 ? '' : r() < 0.15 || i < 3 ? money(r, 5, 400) : '';
    const delivered = i >= 31000 && r() < 0.0006 ? 'n/a' : day(scanned + int(r, 1, 4), Date.UTC(2024, 8, 1));
    let note = '';
    if (i % 997 === 0) note = `Left with neighbour,\nno signature (${pick(r, ['No. 4', 'No. 12', 'flat B'])})`;
    else if (r() < 0.02) note = pick(r, ['fragile', 'call before delivery', 'back door, ring twice']);
    out.push(line([
      7000000 + i,
      pick(r, depots),
      weight,
      bay,
      money(r, 8, 900),
      cod,
      day(scanned, Date.UTC(2024, 8, 1)),
      delivered,
      note,
    ]));
  }
  return out.join('');
}

function main() {
  const dir = path.join(__dirname, '..', 'data');
  fs.mkdirSync(dir, { recursive: true });
  const files = { 'sample-a.csv': sampleA, 'sample-b.csv': sampleB, 'sample-c.csv': sampleC };
  for (const [name, make] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), make());
    console.log(`wrote data/${name}`);
  }
}

if (require.main === module) main();

module.exports = { sampleA, sampleB, sampleC };
