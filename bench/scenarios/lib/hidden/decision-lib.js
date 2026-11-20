// SPDX-License-Identifier: Apache-2.0
'use strict';
// Shared helper for the T3 hidden tests. Copied into each task's hidden dir.
const fs = require('node:fs');

// Returns the JSON of the FIRST fenced block whose info string is exactly `decision`.
function readDecision(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = /^```decision[ \t]*\r?\n([\s\S]*?)\r?\n```/m.exec(text);
  if (!m) throw new Error(`no fenced decision block in ${file}`);
  return JSON.parse(m[1]);
}

// true when |a-b| <= tol * |b|
function near(a, b, tol = 0.1) {
  return typeof a === 'number' && Number.isFinite(a) && Math.abs(a - b) <= tol * Math.abs(b);
}

// limits[name] = {limit, value}; passes when value is a number, the stated limit matches the expected one
// and the value obeys it ('max' default: value <= limit; 'min': value >= limit).
function meets(limits, name, expectedLimit, dir = 'max') {
  const e = limits && limits[name];
  if (!e || typeof e.value !== 'number' || e.limit !== expectedLimit) return false;
  return dir === 'min' ? e.value >= expectedLimit : e.value <= expectedLimit;
}

module.exports = { readDecision, near, meets };
