// SPDX-License-Identifier: Apache-2.0
'use strict';
// Preloaded with `node --require ./hidden/gate.js --test ...` from a task's hidden check command.
// Every test except the structural ones fails when the chosen option in the agent's decision block is not one of
// meta.json's acceptableOptions. A lazy answer that takes the tempting option therefore keeps only the structure
// score. Structural tests are the ones whose title says they check that the block parses, has its keys, or that the file exists.
const fs = require('node:fs');
const Module = require('node:module');

const STRUCTURAL = /decision block|valid json|json structure|required (keys|fields)|file exist|exists/i;

function chosenOk() {
  try {
    const meta = JSON.parse(fs.readFileSync('meta.json', 'utf8'));
    const file = meta.deliverables.find((d) => /decision|adr|latency|retention|capacity|cutover|design|architecture|export/i.test(d) && d.endsWith('.md')) || meta.deliverables.find((d) => d.endsWith('.md'));
    const text = fs.readFileSync(file, 'utf8');
    const m = /^```decision[ \t]*\r?\n([\s\S]*?)\r?\n```/m.exec(text);
    const chosen = JSON.parse(m[1]).chosen;
    return meta.acceptableOptions.includes(chosen);
  } catch { return false; }
}

const wrap = (orig) => function gated(name, ...rest) {
  const fn = rest.find((a) => typeof a === 'function');
  if (typeof name !== 'string' || !fn || STRUCTURAL.test(name)) return orig.call(this, name, ...rest);
  const gatedFn = function (...a) {
    if (!chosenOk()) throw new Error('gate: chosen option is not one of the acceptable options');
    return fn.apply(this, a);
  };
  return orig.call(this, name, ...rest.map((a) => (a === fn ? gatedFn : a)));
};

const load = Module._load;
Module._load = function patched(request, ...args) {
  const mod = load.call(this, request, ...args);
  if (request !== 'node:test' && request !== 'test') return mod;
  if (mod.__gated) return mod;
  const out = Object.assign(Object.create(null), mod);
  for (const k of ['test', 'it']) if (typeof mod[k] === 'function') out[k] = wrap(mod[k]);
  if (typeof mod === 'function') { const f = wrap(mod); Object.assign(f, out); f.__gated = true; return f; }
  out.__gated = true;
  return out;
};
