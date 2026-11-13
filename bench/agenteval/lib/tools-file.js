// SPDX-License-Identifier: Apache-2.0
'use strict';

// Where the declared tool names come from: a JSON file, or a descriptive context file with one bullet per tool.

const fs = require('node:fs');

const BULLET_TOOL = /^\s*(?:[-*+]|\d+[.)])\s+`?([A-Za-z_][A-Za-z0-9_]*)`?\s*\(/;

const unique = (names) => [...new Set(names)];

function readText(file, what) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { throw new Error(`cannot read ${what} ${file}: ${e.message}`); }
}

/** @returns {string[]} names from a JSON array of names or objects with a name, or {tools: [...]} */
function loadToolsJson(file) {
  let raw;
  try { raw = JSON.parse(readText(file, 'tools file')); } catch (e) { throw new Error(e.message.startsWith('cannot read') ? e.message : `tools file ${file} is not valid JSON: ${e.message}`); }
  const list = Array.isArray(raw) ? raw : raw && Array.isArray(raw.tools) ? raw.tools : null;
  if (!list) throw new Error(`tools file ${file} must be a JSON array of tool names, or an object with a "tools" array`);
  const names = list.map((t, i) => {
    const name = typeof t === 'string' ? t : t && typeof t === 'object' && !Array.isArray(t) ? t.name : undefined;
    if (typeof name !== 'string' || !name.trim()) throw new Error(`tools file ${file}: entry ${i + 1} has no tool name`);
    return name.trim();
  });
  if (!names.length) throw new Error(`tools file ${file} lists no tools`);
  return unique(names);
}

/** @returns {string[]} names from lines such as "- lookup_order(order_id: str) -> dict" */
function extractToolsFromText(file) {
  const names = [];
  for (const line of readText(file, 'context file').split(/\r?\n/)) {
    const m = line.match(BULLET_TOOL);
    if (m) names.push(m[1]);
  }
  if (!names.length) throw new Error(`no tool names found in ${file}; expected bullet lines such as "- lookup_order(order_id: str) -> ..."`);
  return unique(names);
}

module.exports = { loadToolsJson, extractToolsFromText };
