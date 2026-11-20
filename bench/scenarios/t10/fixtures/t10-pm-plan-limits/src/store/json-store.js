'use strict';
const fs = require('node:fs');
const path = require('node:path');
const locks = new Map();
async function withLock(key, work) {
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  locks.set(key, current);
  await previous;
  try { return await work(); } finally { release(); if (locks.get(key) === current) locks.delete(key); }
}
function createJsonStore(file, initial = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify(initial, null, 2) + '\n');
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  const write = value => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
  return { file, read, write, withLock: work => withLock(file, work) };
}
module.exports = { createJsonStore, withLock };
