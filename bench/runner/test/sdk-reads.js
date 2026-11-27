// SPDX-License-Identifier: Apache-2.0
// Test helper (D-285): which SDK helpers a plugin source reads, found from its text. It sees the four ways the bench
// plugins read the SDK: `const { a, b } = require('../../sdk').part`, `const x = require('../../sdk').part` (then
// `x.name`, or `x().name` when `x` is `() => require(..).part`), `require('../../sdk').part.name` and
// `const sdk = require('../../sdk')` (then `sdk.part.name`, `const { a } = sdk.part` and `const { part } = sdk`). No model call.
// shortcut: a text scan, so a read through a computed key (`sdk[x]`) or an alias of an alias is not seen; replace it
// with a parser if a plugin needs such a read.
'use strict';

const SDK = String.raw`require\(\s*['"][^'"]*sdk(?:\/index\.js)?['"]\s*\)`;
const PART = String.raw`(plant\.\w+|(?!plant\b)\w+)`;
const names = (list) => list.split(',').map((s) => s.trim().split(/\s*:\s*/)[0]).filter(Boolean);

/**
 * The reads in `src` (a plugin file's text) as `["part.name", ...]`: the part is `stream` or `plant.agentFile`, the
 * name a helper of that part. A part read whole with no member access (`const x = require(sdk).part`, never used as
 * `x.name`) gives `"part.*"`.
 * @param {string} text  the file's source; whole-line comments are ignored
 */
function sdkReads(text) {
  const src = text.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const out = new Set();
  const read = (part, name) => out.add(`${part}.${name}`);
  for (const m of src.matchAll(new RegExp(String.raw`const\s*\{([^}]+)\}\s*=\s*${SDK}\.${PART}`, 'g'))) names(m[1]).forEach((n) => read(m[2], n));
  for (const m of src.matchAll(new RegExp(String.raw`${SDK}\.${PART}\.(\w+)`, 'g'))) read(m[1], m[2]);
  for (const m of src.matchAll(new RegExp(String.raw`const\s+(\w+)\s*=\s*(\(\)\s*=>\s*)?${SDK}\.${PART}\s*;`, 'g'))) {
    const call = m[2] ? String.raw`\(\)` : '';
    const uses = [...src.matchAll(new RegExp(String.raw`\b${m[1]}${call}\.(\w+)`, 'g'))];
    if (uses.length) uses.forEach((u) => read(m[3], u[1]));
    else read(m[3], '*');
  }
  const sdkVar = src.match(new RegExp(String.raw`const\s+(\w+)\s*=\s*${SDK}\s*;`))?.[1];
  if (sdkVar) {
    for (const m of src.matchAll(new RegExp(String.raw`\b${sdkVar}\.${PART}\.(\w+)`, 'g'))) read(m[1], m[2]);
    for (const m of src.matchAll(new RegExp(String.raw`const\s*\{([^}]+)\}\s*=\s*${sdkVar}\.${PART}`, 'g'))) names(m[1]).forEach((n) => read(m[2], n));
    for (const m of src.matchAll(new RegExp(String.raw`const\s*\{([^}]+)\}\s*=\s*${sdkVar}\s*;`, 'g'))) {
      for (const [part, local = part] of m[1].split(',').map((s) => s.trim().split(/\s*:\s*/)).filter((a) => a[0])) {
        const uses = [...src.matchAll(new RegExp(String.raw`\b${local}\.(\w+)`, 'g'))];
        if (uses.length) uses.forEach((u) => read(part, u[1]));
        else read(part, '*');
      }
    }
  }
  return [...out].sort();
}

/**
 * The reads in `reads` that `sdk` does not list: a part it lacks, or a name its part lacks.
 * @param {string[]} reads  output of sdkReads
 * @param {object} sdk  the SDK object
 */
function unlistedReads(reads, sdk) {
  return reads.filter((r) => {
    const at = r.lastIndexOf('.');
    const part = r.slice(0, at).split('.').reduce((o, k) => o?.[k], sdk);
    const name = r.slice(at + 1);
    return !part || (name !== '*' && !Object.keys(part).includes(name));
  });
}

module.exports = { sdkReads, unlistedReads };
