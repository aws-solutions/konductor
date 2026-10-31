// SPDX-License-Identifier: Apache-2.0
'use strict';

// Minimal well-formedness checker for the SVG the chart library emits, plus xmllint when the host has it.

const { spawnSync } = require('node:child_process');

const NAME = '[A-Za-z_][\\w.:-]*';
const ENTITY = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/;

/** Returns null when the text is well-formed XML (elements, quoted attributes, legal entities), else a message. */
function wellFormed(xml) {
  if (typeof xml !== 'string' || !xml.startsWith('<svg')) return 'does not start with <svg';
  const stack = [];
  const tag = new RegExp(`<(/?)(${NAME})((?:\\s+${NAME}="[^"<]*")*)\\s*(/?)>`, 'y');
  let i = 0;
  let roots = 0;
  while (i < xml.length) {
    if (xml[i] !== '<') {
      const next = xml.indexOf('<', i);
      const text = xml.slice(i, next === -1 ? xml.length : next);
      if (ENTITY.test(text)) return `bad entity near ${JSON.stringify(text.slice(0, 40))}`;
      if (text.includes('>')) return `raw ">" in text near ${JSON.stringify(text.slice(0, 40))}`;
      if (stack.length === 0 && text.trim()) return 'text outside the root element';
      i = next === -1 ? xml.length : next;
      continue;
    }
    tag.lastIndex = i;
    const m = tag.exec(xml);
    if (!m) return `bad tag at ${i}: ${JSON.stringify(xml.slice(i, i + 60))}`;
    const [whole, closing, name, attrs, selfClose] = m;
    if (ENTITY.test(attrs)) return `bad entity in attributes of <${name}>`;
    const seen = new Set();
    for (const a of attrs.matchAll(new RegExp(`\\s+(${NAME})="`, 'g'))) {
      if (seen.has(a[1])) return `duplicate attribute ${a[1]} on <${name}>`;
      seen.add(a[1]);
    }
    if (closing) {
      if (stack.pop() !== name) return `mismatched </${name}> at ${i}`;
    } else if (!selfClose) {
      if (stack.length === 0) roots++;
      stack.push(name);
    } else if (stack.length === 0) roots++;
    i += whole.length;
  }
  if (stack.length) return `unclosed <${stack[stack.length - 1]}>`;
  return roots === 1 ? null : `expected one root element, found ${roots}`;
}

let xmllint;
function hasXmllint() {
  if (xmllint === undefined) xmllint = spawnSync('xmllint', ['--version'], { encoding: 'utf8' }).error ? false : true;
  return xmllint;
}

/** xmllint verdict: null when well-formed or xmllint is missing, else its message. */
function lint(xml) {
  if (!hasXmllint()) return null;
  const r = spawnSync('xmllint', ['--noout', '-'], { input: xml, encoding: 'utf8' });
  return r.status === 0 ? null : r.stderr.slice(0, 300);
}

module.exports = { wellFormed, lint, hasXmllint };
