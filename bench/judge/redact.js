// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('node:fs');

// Strings that would tell a judge which arm produced an output. The phrase is deleted, not
// replaced: a marker such as "[agent]" would itself appear only in the arms that name agents.
// Version redaction targets konductor release tags only, so fixture versions like 0.1.0 survive.
// Paths of deliverable files are never touched; the specs rule only matches a bare directory mention.
const DEFAULT_REDACTIONS = [
  { id: 'agent-name', pattern: '\\bk-(?:developer|architect|researcher|browser|quality-assurance|product-manager|tpm|media-analyzer)\\b', flags: 'gi' },
  { id: 'tool-name', pattern: '\\bkonductor(?:-[a-z-]+)?\\b|\\b(?:find_skills|get_skill)\\b|\\bkiro[_-]default\\b', flags: 'gi' },
  { id: 'delegation', pattern: '\\bsub-?agents?\\b|\\bdelegat(?:e|es|ed|ing|ion)\\b|\\borchestrat(?:or|ors|ion)\\b|\\bspecialist agents?\\b', flags: 'gi' },
  { id: 'version', pattern: '\\bv1\\.\\d+\\.\\d+\\b|\\bmain-unreleased\\b', flags: 'gi' },
  { id: 'skills', pattern: '\\bskills?[ -](?:mcp|server|lookup)\\b|\\bskill-lookup(?:-mcp)?\\b|\\bskills?\\b', flags: 'gi' },
  { id: 'sop', pattern: '\\bsop-[a-z0-9-]+\\b|\\bsops?\\b|\\bstandard operating procedures?\\b', flags: 'gi' },
  { id: 'maker-checker', pattern: '\\bmaker[- /]checker\\b', flags: 'gi' },
  { id: 'steering', pattern: '\\bsteering(?: (?:files?|docs?|rules?))?\\b', flags: 'gi' },
  { id: 'agent-files', pattern: '\\bAGENTS\\.md\\b|\\bCLAUDE\\.md\\b', flags: 'g' },
  { id: 'role-agent', pattern: '\\b(?:researcher|developer|architect|tpm|browser|quality-assurance|product-manager|media-analyzer) agents?\\b|\\bresearch(?:er)? agents?\\b', flags: 'gi' },
  { id: 'kiro-specs-dir', pattern: '\\.kiro/specs(?:/(?![\\w.-])|(?![\\w/-]|\\.\\w))', flags: 'gi' },
];

// A deleted phrase also takes the space after it when a space (or the text start) comes before it,
// so "the  fix" does not appear; indentation and table alignment elsewhere are left alone.
function compileRedactions(list) {
  return list.map((r) => {
    const replacement = r.replacement ?? '';
    const source = replacement === '' ? `(?:(?<=^|\\s)(?:${r.pattern})[ \\t]?|(?:${r.pattern}))` : r.pattern;
    return { id: r.id, re: new RegExp(source, r.flags || 'gi'), replacement };
  });
}

function redact(text, rules) {
  const fired = {};
  let out = text;
  for (const { id, re, replacement } of rules) {
    out = out.replace(re, () => {
      fired[id] = (fired[id] || 0) + 1;
      return replacement;
    });
  }
  return { text: out, fired };
}

// Extra rules appended to the defaults: a JSON array of {id, pattern, flags?, replacement?}.
function loadRedactions(file) {
  if (!file) return compileRedactions(DEFAULT_REDACTIONS);
  const extra = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(extra)) throw new Error('redaction file must be a JSON array');
  return compileRedactions([...DEFAULT_REDACTIONS, ...extra]);
}

module.exports = { DEFAULT_REDACTIONS, compileRedactions, redact, loadRedactions };
