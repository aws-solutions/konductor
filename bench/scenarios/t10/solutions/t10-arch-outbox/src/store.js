'use strict';
const fs = require('node:fs');
const path = require('node:path');
function empty() { return { orders: [], payments: [], statusEvents: [] }; }
function readFile(file) {
  try { return { ...empty(), ...JSON.parse(fs.readFileSync(file, 'utf8')) }; }
  catch (e) { if (e.code === 'ENOENT') return empty(); throw e; }
}
function atomicWrite(file, collections) {
  const dir = path.dirname(file); fs.mkdirSync(dir, { recursive: true });
  const next = { ...readFile(file), ...collections };
  const temp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  fs.writeFileSync(temp, JSON.stringify(next, null, 2) + '\n'); fs.renameSync(temp, file); return next;
}
function createJsonStore(file) {
  return { file,
    read(name) { return readFile(file)[name] ?? []; },
    save(name, value) { return atomicWrite(file, { [name]: value }); },
    atomicWrite(changes) { return atomicWrite(file, changes); },
    snapshot() { return readFile(file); }
  };
}
module.exports = { createJsonStore, atomicWrite, readFile };
