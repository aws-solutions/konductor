// SPDX-License-Identifier: Apache-2.0
'use strict';

// A report is a list of blocks. The same blocks render to markdown (charts as image links to charts/NAME.svg, so the
// file works on GitHub) and to one HTML file with inline CSS and inline SVG: no scripts, no external resources.

const { esc } = require('./charts.js');

const h = (level, text) => ({ t: 'h', level, text });
const p = (text) => ({ t: 'p', text });
const table = (head, rows, caption) => ({ t: 'table', head, rows, caption });
const chart = (name, svg, alt) => ({ t: 'chart', name, svg, alt });
const md = (text) => ({ t: 'md', text });
const list = (items) => ({ t: 'list', items });
const note = (text) => ({ t: 'note', text });

const cellMd = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function toMarkdown(blocks) {
  const out = [];
  for (const b of blocks) {
    switch (b.t) {
      case 'h': out.push(`${'#'.repeat(b.level)} ${b.text}`, ''); break;
      case 'p': out.push(b.text, ''); break;
      case 'note': out.push(`> ${b.text}`, ''); break;
      case 'list': out.push(...b.items.map((i) => `- ${i}`), ''); break;
      case 'table':
        if (b.caption) out.push(`**${b.caption}**`, '');
        out.push(`| ${b.head.map(cellMd).join(' | ')} |`, `|${b.head.map(() => '---').join('|')}|`, ...b.rows.map((r) => `| ${r.map(cellMd).join(' | ')} |`), '');
        break;
      case 'chart': out.push(`![${String(b.alt).replace(/[[\]\n]/g, ' ')}](charts/${b.name}.svg)`, ''); break;
      case 'md': out.push(b.text.trimEnd(), ''); break;
      default: break;
    }
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

// ---- markdown subset to HTML, for the existing text tables ----

function inline(s) {
  let t = esc(s);
  t = t.replace(/&lt;br&gt;/g, '<br>');
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (_m, alt) => `[${alt}]`);
  return t.replace(/\[([^\]]+)\]\(([^)]*)\)/g, (_m, label) => label);
}

const STATUS = { PASS: 'pass', WARN: 'warn', FAIL: 'fail', 'N/A': 'na' };

function cellHtml(v) {
  const s = String(v ?? '');
  const cls = STATUS[s.trim()];
  return cls ? `<span class="st ${cls}">${esc(s.trim())}</span>` : inline(s);
}

function tableHtml(head, rows, caption) {
  return `<table>${caption ? `<caption>${inline(caption)}</caption>` : ''}<thead><tr>${head.map((x) => `<th scope="col">${inline(x)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${cellHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

function mdToHtml(text) {
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const hm = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hm) { out.push(`<h${hm[1].length}>${inline(hm[2])}</h${hm[1].length}>`); i++; continue; }
    if (/^\|.*\|\s*$/.test(line) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      const head = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      out.push(tableHtml(head, rows));
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
      out.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\|.*\||\s*[-*]\s+)/.test(lines[i])) { para.push(lines[i].replace(/\s{2,}$/, '')); i++; }
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    else i++;
  }
  return out.join('\n');
}

const CSS = `
:root{color-scheme:light}
body{font:14px/1.45 Helvetica,Arial,sans-serif;color:#222;max-width:1000px;margin:24px auto;padding:0 16px}
h1{font-size:22px;border-bottom:2px solid #222;padding-bottom:6px}
h2{font-size:17px;margin-top:28px;border-bottom:1px solid #bbb;padding-bottom:3px}
h3{font-size:14px;margin-top:20px}
table{border-collapse:collapse;margin:10px 0;font-size:12px;width:100%}
caption{text-align:left;font-weight:bold;padding:4px 0}
th,td{border:1px solid #bbb;padding:3px 6px;vertical-align:top;text-align:left}
th{background:#eee}
code{background:#f1f1f1;padding:0 3px;font-size:12px}
figure{margin:12px 0;overflow-x:auto}
figure svg{max-width:100%;height:auto}
.note{border-left:4px solid #999;background:#f7f7f7;padding:6px 10px;margin:10px 0}
.st{display:inline-block;min-width:38px;text-align:center;font-weight:bold;padding:1px 5px;border:1px solid #444;border-radius:3px}
.st.pass{background:#d7f0e4}.st.warn{background:#fdebc4}.st.fail{background:#f6cdbb}.st.na{background:#eee;color:#555}
.rating{font-size:16px;font-weight:bold;margin:8px 0}
@media print{body{max-width:none;margin:0}h2{break-after:avoid}table,figure{break-inside:avoid}}
`;

function toHtml(blocks, { title = 'Benchmark report' } = {}) {
  const body = [];
  for (const b of blocks) {
    switch (b.t) {
      case 'h': body.push(`<h${b.level}>${inline(b.text)}</h${b.level}>`); break;
      case 'p': body.push(`<p>${inline(b.text).replace(/ {2}\n/g, '<br>')}</p>`); break;
      case 'note': body.push(`<div class="note">${inline(b.text)}</div>`); break;
      case 'list': body.push(`<ul>${b.items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`); break;
      case 'table': body.push(tableHtml(b.head, b.rows, b.caption)); break;
      case 'chart': body.push(`<figure>${b.svg.replace(' xmlns="http://www.w3.org/2000/svg"', '')}</figure>`); break;
      case 'md': body.push(mdToHtml(b.text)); break;
      default: break;
    }
  }
  return `<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>\n${body.join('\n')}\n</body></html>\n`;
}

/** Shifts every markdown heading down by `by` levels (so an embedded report nests under a section). */
const demote = (text, by = 1) => text.replace(/^(#{1,6})(\s)/gm, (_m, hs, sp) => `${'#'.repeat(Math.min(6, hs.length + by))}${sp}`);

module.exports = { h, p, table, chart, md, list, note, toMarkdown, toHtml, mdToHtml, demote };
