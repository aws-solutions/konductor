// SPDX-License-Identifier: Apache-2.0
'use strict';

// Counts distinct severity-labelled findings in a markdown review, whatever layout the
// author chose: severity in a section heading, a "Severity: X" line, a table cell, or an
// inline label at the start of a bullet. Counting occurrences of severity words instead
// would reward repetition and punish a review that states each severity once per section.

const DEFAULT_LABELS = ['critical', 'high', 'important', 'major', 'medium', 'moderate', 'minor', 'low'];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function matchers(labels) {
  const L = labels.map(escapeRe).join('|');
  const noun = '(?:findings?|issues?|items?|risks?|problems?|vulnerabilities)';
  return {
    // A heading or bold line that only names a severity: opens a section.
    section: new RegExp(`^(${L})(?:\\s+(?:severity|priority))?(?:\\s+${noun})?\\s*(?:\\(\\d+\\))?\\s*[:\\-]?$`, 'i'),
    severityLine: new RegExp(`^(?:[-*+]\\s+)?severity\\s*[:=\\-]\\s*[\\[(]?(${L})\\b`, 'i'),
    leadLabel: new RegExp(`^(?:(?:[-*+]|\\d+[.)])\\s+)?(?:[\\[(](${L})[\\])]|(${L})\\s*[:\\-])(.*)$`, 'i'),
    headingLabel: new RegExp(`[\\[(]\\s*(${L})\\s*[\\])]|^(${L})\\s*[:\\-]|[:\\-\\u2013\\u2014]\\s*(${L})\\s*$`, 'i'),
    labelCell: new RegExp(`^[\\[(]?(${L})[\\])]?$`, 'i'),
  };
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const NUMBERED = /^(?:(?:finding|issue|vuln\w*|bug|risk)\s*[-#]?\s*|f-?|#)?(\d+)\b[.):\s-]*\S/i;
const SEPARATOR = /^\|?[\s:|-]+\|?$/;
const TOP_LEVEL_ITEM = /^ {0,1}(?:[-*+]|\d+[.)])\s+\S/;

function countLabelledFindings(text, labels = DEFAULT_LABELS) {
  const m = matchers(labels);
  const lines = String(text).split('\n');
  const items = [];
  let section = null;
  let head = null;
  let fenced = false;

  const add = (item) => { items.push(item); return item; };
  const nextNonEmpty = (from) => {
    for (let j = from; j < lines.length; j++) if (lines[j].trim()) return lines[j].trim();
    return '';
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*(```|~~~)/.test(raw)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const line = raw.replace(/[*_`]/g, '').trim();
    if (!line) continue;

    const h = line.match(HEADING);
    if (h) {
      const level = h[1].length;
      const title = h[2].trim();
      if (head && level > head.level) continue;
      head = null;
      const sec = title.match(m.section);
      if (sec) { section = { label: sec[1].toLowerCase(), level }; continue; }
      if (section && level <= section.level) section = null;
      const num = title.match(NUMBERED);
      const own = title.match(m.headingLabel);
      if (!num && !own && !section) continue;
      const ownLabel = own ? (own[1] || own[2] || own[3]).toLowerCase() : null;
      head = add({ num: num ? num[1] : null, label: ownLabel ?? section?.label ?? null, level });
      continue;
    }

    const bare = line.match(m.section);
    if (bare && !TOP_LEVEL_ITEM.test(raw)) { section = { label: bare[1].toLowerCase(), level: 7 }; head = null; continue; }

    if (line.startsWith('|')) {
      if (SEPARATOR.test(line) || SEPARATOR.test(nextNonEmpty(i + 1))) continue;
      const cells = line.split('|').slice(1, line.endsWith('|') ? -1 : undefined).map((c) => c.trim());
      const cell = cells.find((c) => m.labelCell.test(c));
      if (cell) {
        const summary = cells[0] === cell && cells.slice(1).every((c) => /^\d*$/.test(c));
        if (summary) continue;
        const id = cells[0].match(/^\D{0,2}(\d+)$/);
        add({ num: id ? id[1] : null, label: cell.match(m.labelCell)[1].toLowerCase() });
      } else if (section && !head) {
        add({ num: null, label: section.label });
      }
      continue;
    }

    const sev = line.match(m.severityLine);
    if (sev) {
      const label = sev[1].toLowerCase();
      if (head) { if (!head.label) head.label = label; } else add({ num: null, label });
      continue;
    }

    const lead = line.match(m.leadLabel);
    if (lead && !/^\s*\d+\s*$/.test(lead[3])) {
      const label = (lead[1] || lead[2]).toLowerCase();
      if (head) { if (!head.label) head.label = label; } else add({ num: null, label });
      continue;
    }

    if (section && !head && TOP_LEVEL_ITEM.test(raw)) add({ num: null, label: section.label });
  }

  const seen = new Set();
  const found = [];
  items.forEach((it, idx) => {
    if (!it.label) return;
    const key = it.num ? `${it.num}|${it.label}` : `u${idx}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ num: it.num, label: it.label });
  });
  return { count: found.length, findings: found };
}

module.exports = { countLabelledFindings, DEFAULT_LABELS };
