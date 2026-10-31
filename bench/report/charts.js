// SPDX-License-Identifier: Apache-2.0
'use strict';

// Dependency-free SVG charts. Every function returns one self-contained SVG string: no scripts, no external
// references, no randomness, so the same input gives the same bytes. Non-finite numbers are dropped (and
// the chart says so), never printed. Text is escaped. Markers differ in shape as well as colour, so a
// black-and-white print stays readable.

// Okabe-Ito order with a grey in place of the yellow, which prints poorly.
const PALETTE = ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#D55E00', '#7A7A7A', '#000000'];
const CLASS_COLORS = { HARMS: '#D55E00', RELOCATE: '#56B4E9', PRUNE: '#CC79A7', FIX: '#E69F00', KEEP: '#009E73', 'KEEP (provisional)': '#8FD1BC', 'NEEDS DATA': '#7A7A7A' };
const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'cross', 'circle'];
const FONT = 'Helvetica, Arial, sans-serif';
const INK = '#222222';
const GRID = '#e3e3e3';
const WIDTH = 720;

const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const c = (v) => (fin(v) ? Math.round(v * 10) / 10 : 0);
// eslint-disable-next-line no-control-regex
const XML_BAD = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
const esc = (s) => String(s ?? '').replace(XML_BAD, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, Math.max(1, n - 1))}\u2026` : t; };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'chart';
const color = (i) => PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length];

/** Compact label for an axis or a value. */
function fmt(v, d) {
  if (!fin(v)) return 'n/a';
  const a = Math.abs(v);
  if (a >= 1e15) return v.toExponential(1);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(0)}k`;
  if (d !== undefined) return v.toFixed(d);
  if (a >= 100 || Number.isInteger(v)) return v.toFixed(0);
  return a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
const pctLabel = (v) => (fin(v) ? `${Math.round(v * 100)}%` : 'n/a');

/** Round-number ticks covering [min, max]. Flat or non-finite input still gives at least two ticks. */
function niceScale(min, max, target = 5) {
  let lo = fin(min) ? min : (fin(max) ? Math.min(0, max) : 0);
  let hi = fin(max) ? max : lo + 1;
  if (hi < lo) [lo, hi] = [hi, lo];
  if (hi === lo) { const pad = Math.abs(lo) * 0.1 || 1; lo -= pad; hi += pad; }
  const raw = (hi - lo) / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  let step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  if (!fin(step) || step <= 0) step = 1;
  const decimals = step >= 1 ? 0 : Math.min(12, Math.ceil(-Math.log10(step)) + 1);
  const start = Math.floor(lo / step) * step;
  const ticks = [];
  for (let i = 0; i <= 60; i++) {
    const t = Number((start + i * step).toFixed(decimals));
    ticks.push(t === 0 ? 0 : t);
    if (start + i * step >= hi - step * 1e-9) break;
  }
  if (ticks.length < 2) ticks.push(ticks[0] + 1);
  return { ticks, min: ticks[0], max: ticks[ticks.length - 1], step };
}

const lin = (d0, d1, r0, r1) => (v) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));

function doc({ id, title, desc, width = WIDTH, height, body }) {
  const sid = slug(id || title);
  const w = Math.round(width);
  const h = Math.round(height);
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="${sid}-t ${sid}-d" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="${FONT}" font-size="11"><title id="${sid}-t">${esc(title)}</title><desc id="${sid}-d">${esc(desc)}</desc><rect width="${w}" height="${h}" fill="#ffffff"/>${body}</svg>`;
}

const T = (x, y, s, o = {}) => `<text x="${c(x)}" y="${c(y)}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.size ? ` font-size="${o.size}"` : ''}${o.weight ? ` font-weight="${o.weight}"` : ''} fill="${o.fill || INK}"${o.rotate ? ` transform="rotate(${o.rotate} ${c(x)} ${c(y)})"` : ''}>${esc(s)}</text>`;
const L = (x1, y1, x2, y2, o = {}) => `<line${o.role ? ` data-role="${o.role}"` : ''} x1="${c(x1)}" y1="${c(y1)}" x2="${c(x2)}" y2="${c(y2)}" stroke="${o.stroke || INK}" stroke-width="${o.width || 1}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`;
const R = (x, y, w, h, o = {}) => `<rect${o.role ? ` data-role="${o.role}"` : ''} x="${c(x)}" y="${c(y)}" width="${c(Math.max(0, w))}" height="${c(Math.max(0, h))}" fill="${o.fill || 'none'}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.width || 1}"` : ''}${o.opacity ? ` fill-opacity="${o.opacity}"` : ''}${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>`;

function marker(shape, x, y, r, fill, o = {}) {
  const f = o.hollow ? '#ffffff' : fill;
  const base = `${o.role ? ` data-role="${o.role}"` : ''} fill="${f}" stroke="${o.hollow ? fill : '#ffffff'}" stroke-width="${o.hollow ? 2 : 1}"`;
  const p = (pts) => pts.map(([a, b]) => `${c(a)},${c(b)}`).join(' ');
  switch (shape) {
    case 'square': return `<rect${base} x="${c(x - r)}" y="${c(y - r)}" width="${c(2 * r)}" height="${c(2 * r)}"/>`;
    case 'triangle': return `<polygon${base} points="${p([[x, y - r * 1.2], [x - r * 1.1, y + r * 0.9], [x + r * 1.1, y + r * 0.9]])}"/>`;
    case 'diamond': return `<polygon${base} points="${p([[x, y - r * 1.3], [x + r * 1.3, y], [x, y + r * 1.3], [x - r * 1.3, y]])}"/>`;
    case 'cross': return `<polygon${base} points="${p([[x - r, y - r * 0.4], [x - r * 0.4, y - r * 0.4], [x - r * 0.4, y - r], [x + r * 0.4, y - r], [x + r * 0.4, y - r * 0.4], [x + r, y - r * 0.4], [x + r, y + r * 0.4], [x + r * 0.4, y + r * 0.4], [x + r * 0.4, y + r], [x - r * 0.4, y + r], [x - r * 0.4, y + r * 0.4], [x - r, y + r * 0.4]])}"/>`;
    default: return `<circle${base} cx="${c(x)}" cy="${c(y)}" r="${c(r)}"/>`;
  }
}

/** Flowing legend. items: [{name, color, shape?}]. */
function legend(items, x, y, maxW) {
  let cx = x;
  let cy = y;
  let out = '';
  for (const it of items) {
    const w = 28 + Math.min(it.name.length, 32) * 6.4;
    if (cx + w > x + maxW && cx > x) { cx = x; cy += 16; }
    out += it.shape ? marker(it.shape, cx + 6, cy - 4, 4, it.color) : R(cx, cy - 9, 11, 11, { fill: it.color });
    out += T(cx + 16, cy, clip(it.name, 32));
    cx += w;
  }
  return { svg: out, height: items.length ? cy - y + 16 : 0 };
}

function noData(title, id, reason) {
  const msg = reason && /^No data/.test(reason) ? reason : `No data${reason ? `: ${reason}` : ''}`;
  const body = `${T(16, 24, title, { size: 13, weight: 'bold' })}<rect x="16" y="40" width="${WIDTH - 32}" height="64" fill="#f5f5f5" stroke="#bbbbbb" stroke-dasharray="4 3"/>${T(WIDTH / 2, 76, clip(msg, 90), { anchor: 'middle', fill: '#555555' })}`;
  return doc({ id, title, desc: msg, height: 120, body });
}

const head = (title, subtitle) => T(16, 22, title, { size: 13, weight: 'bold' }) + (subtitle ? T(16, 37, clip(subtitle, 110), { fill: '#555555', size: 10 }) : '');

function axisX(sx, ticks, y0, y1, label, fmtFn = fmt) {
  let out = '';
  for (const t of ticks) out += L(sx(t), y0, sx(t), y1, { stroke: GRID }) + T(sx(t), y1 + 14, fmtFn(t), { anchor: 'middle', size: 10 });
  return out + (label ? T((sx(ticks[0]) + sx(ticks[ticks.length - 1])) / 2, y1 + 30, label, { anchor: 'middle', fill: '#444444' }) : '');
}
function axisY(sy, ticks, x0, x1, label, fmtFn = fmt) {
  let out = '';
  for (const t of ticks) out += L(x0, sy(t), x1, sy(t), { stroke: GRID }) + T(x0 - 6, sy(t) + 3.5, fmtFn(t), { anchor: 'end', size: 10 });
  return out + (label ? T(14, (sy(ticks[0]) + sy(ticks[ticks.length - 1])) / 2, label, { anchor: 'middle', fill: '#444444', rotate: -90 }) : '');
}

const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
const onColor = (hex) => (lum(hex) > 0.6 ? INK : '#ffffff');
const notePlotted = (dropped, labels) => (dropped ? `${dropped} item(s) not plotted (missing or non-finite value): ${clip(labels.join(', '), 70)}` : '');

/**
 * Scatter with optional 95% whiskers on both axes. points: [{label, x, y, xLo, xHi, yLo, yHi, n, isBase, color}].
 * Labels avoid each other by trying a fixed list of offsets.
 */
function scatter({ title, id, points = [], xLabel = '', yLabel = '', xMin, xMax, yMin, yMax, yBounds, xBounds, uniformShape = false, subtitle, width = WIDTH, height = 400, xFmt = fmt, yFmt = fmt }) {
  const valid = points.filter((p) => fin(p.x) && fin(p.y));
  if (!valid.length) return noData(title, id, points.length ? `none of ${points.length} point(s) had a finite x and y` : 'No data');
  const dropped = points.filter((p) => !(fin(p.x) && fin(p.y))).map((p) => p.label);
  const span = (p, k) => {
    const lo = p[`${k}Lo`];
    const hi = p[`${k}Hi`];
    return fin(lo) && fin(hi) ? [Math.min(lo, hi, p[k]), Math.max(lo, hi, p[k])] : [p[k], p[k]];
  };
  const xs = valid.flatMap((p) => span(p, 'x'));
  const ys = valid.flatMap((p) => span(p, 'y'));
  // Bounds zoom to the data (with padding) but never leave the allowed range, so a 0..100 score is not squashed to the top edge.
  const zoom = (vals, lo, hi, bounds) => {
    let a = Math.min(...vals, ...(fin(lo) ? [lo] : []));
    let b = Math.max(...vals, ...(fin(hi) ? [hi] : []));
    if (bounds) { const pad = (b - a) * 0.15 || Math.abs(a) * 0.1 || 1; a = Math.max(bounds[0], a - pad); b = Math.min(bounds[1], b + pad); }
    return niceScale(a, b, 6);
  };
  const xsc = zoom(xs, xMin, xMax, xBounds);
  const ysc = zoom(ys, yMin, yMax, yBounds);
  const m = { l: 62, r: 24, t: 50, b: 56 };
  const x0 = m.l; const x1 = width - m.r; const y0 = m.t; const y1 = height - m.b;
  const sx = lin(xsc.min, xsc.max, x0, x1);
  const sy = lin(ysc.min, ysc.max, y1, y0);
  let body = head(title, subtitle) + axisX(sx, xsc.ticks, y0, y1, xLabel, xFmt) + axisY(sy, ysc.ticks, x0, x1, yLabel, yFmt) + R(x0, y0, x1 - x0, y1 - y0, { stroke: '#999999' });
  const placed = [];
  valid.forEach((p, i) => {
    const col = p.color || color(i);
    const cx = sx(p.x); const cy = sy(p.y);
    if (fin(p.xLo) && fin(p.xHi)) {
      const a = sx(Math.min(p.xLo, p.xHi)); const b = sx(Math.max(p.xLo, p.xHi));
      body += L(a, cy, b, cy, { role: 'whisker-x', stroke: col, width: 1.5 }) + L(a, cy - 4, a, cy + 4, { stroke: col }) + L(b, cy - 4, b, cy + 4, { stroke: col });
    }
    if (fin(p.yLo) && fin(p.yHi)) {
      const a = sy(Math.min(p.yLo, p.yHi)); const b = sy(Math.max(p.yLo, p.yHi));
      body += L(cx, a, cx, b, { role: 'whisker-y', stroke: col, width: 1.5 }) + L(cx - 4, a, cx + 4, a, { stroke: col }) + L(cx - 4, b, cx + 4, b, { stroke: col });
    }
    body += p.isBase ? marker('diamond', cx, cy, 5.5, col, { hollow: true, role: 'base' }) : marker(uniformShape ? 'circle' : SHAPES[i % SHAPES.length], cx, cy, uniformShape ? 4 : 5, col);
    if (p.noLabel) return;
    const text = clip(`${p.label}${p.isBase ? ' (base)' : ''}${fin(p.n) ? ` n=${p.n}` : ''}`, 34);
    const w = text.length * 5.8;
    const tries = [[9, -8, 'start'], [9, 14, 'start'], [-9, -8, 'end'], [-9, 14, 'end'], [0, -14, 'middle'], [0, 20, 'middle']];
    let pick = tries[0];
    for (const t of tries) {
      const left = t[2] === 'start' ? cx + t[0] : t[2] === 'end' ? cx + t[0] - w : cx - w / 2;
      const box = [left, cy + t[1] - 10, left + w, cy + t[1] + 3];
      const inside = box[0] >= x0 && box[2] <= x1 + m.r - 4 && box[1] >= y0 - 4 && box[3] <= y1;
      if (inside && !placed.some((q) => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1])) { pick = t; break; }
    }
    const left = pick[2] === 'start' ? cx + pick[0] : pick[2] === 'end' ? cx + pick[0] - w : cx - w / 2;
    placed.push([left, cy + pick[1] - 10, left + w, cy + pick[1] + 3]);
    body += T(cx + pick[0], cy + pick[1], text, { anchor: pick[2], size: 10, fill: INK });
  });
  const note = notePlotted(dropped.length, dropped);
  if (note) body += T(16, height - 8, note, { size: 10, fill: '#7a4a00' });
  const desc = `${title}. ${valid.length} point(s): ${valid.slice(0, 12).map((p) => `${clip(p.label, 24)} at x ${fmt(p.x)}, y ${fmt(p.y)}`).join('; ')}.${note ? ` ${note}.` : ''} Whiskers are 95% intervals where shown.`;
  return doc({ id, title, desc, width, height, body });
}

/**
 * Vertical grouped bars with CI whiskers: one group per category, one bar per series.
 * series: [{name, values: [{v, lo, hi} | null per category]}].
 */
function groupedBarsCI({ title, id, unit = '', categories = [], series = [], subtitle, width = WIDTH, height = 340 }) {
  const cell = (s, i) => { const v = s.values[i]; return v && fin(v.v) ? v : null; };
  const all = series.flatMap((s) => categories.map((_, i) => cell(s, i))).filter(Boolean);
  if (!categories.length || !series.length || !all.length) return noData(title, id, 'No data');
  const tops = all.flatMap((v) => [v.v, fin(v.hi) ? v.hi : v.v]);
  const sc = niceScale(Math.min(0, ...all.map((v) => v.v)), Math.max(...tops), 5);
  const lg = legend(series.map((s, i) => ({ name: s.name, color: color(i) })), 16, 52, width - 32);
  const m = { l: 62, r: 20, t: 62 + lg.height, b: 56 };
  const y0 = m.t; const y1 = height - m.b; const x0 = m.l; const x1 = width - m.r;
  const sy = lin(sc.min, sc.max, y1, y0);
  let body = head(title, subtitle) + lg.svg + axisY(sy, sc.ticks, x0, x1, unit) + L(x0, sy(0), x1, sy(0), { stroke: '#666666' });
  const gw = (x1 - x0) / categories.length;
  const bw = Math.max(4, Math.min(44, (gw * 0.82) / series.length));
  categories.forEach((cat, ci) => {
    const gx = x0 + ci * gw + (gw - bw * series.length) / 2;
    series.forEach((s, si) => {
      const v = cell(s, ci);
      if (!v) return;
      const bx = gx + si * bw;
      const top = sy(v.v);
      body += R(bx, Math.min(top, sy(0)), bw - 2, Math.abs(sy(0) - top), { fill: color(si), role: 'bar' });
      if (fin(v.lo) && fin(v.hi)) {
        const cx = bx + (bw - 2) / 2;
        const a = sy(Math.min(v.lo, v.hi)); const b = sy(Math.max(v.lo, v.hi));
        body += L(cx, a, cx, b, { role: 'ci', width: 1.5 }) + L(cx - 3, a, cx + 3, a) + L(cx - 3, b, cx + 3, b);
      }
      if (bw >= 14) body += T(bx + (bw - 2) / 2, Math.min(top, fin(v.hi) ? sy(v.hi) : top) - 4, fmt(v.v), { anchor: 'middle', size: 9 });
    });
    body += T(x0 + ci * gw + gw / 2, y1 + 14, clip(cat, Math.max(6, Math.floor(gw / 6))), { anchor: 'middle', size: 10 });
  });
  const desc = `${title}. ${series.length} series over ${categories.length} categories. ${series.slice(0, 6).map((s) => `${clip(s.name, 20)}: ${categories.slice(0, 6).map((cat, i) => { const v = cell(s, i); return `${clip(cat, 14)} ${v ? fmt(v.v) : 'n/a'}`; }).join(', ')}`).join('; ')}. Whiskers are 95% intervals.`;
  return doc({ id, title, desc, width, height, body });
}

/**
 * Per-row dot plot: one dot per replicate, one lane per group (arm), a median tick per lane.
 * rows: [{label, groups: [{name, values}]}]. min/max fix the axis (for example 0 and 100).
 */
function dotPlot({ title, id, unit = '', rows = [], min, max, subtitle, width = WIDTH }) {
  const clean = rows.map((r) => ({ label: r.label, groups: (r.groups || []).map((g) => ({ name: g.name, values: (g.values || []).filter(fin) })).filter((g) => g.values.length) })).filter((r) => r.groups.length);
  if (!clean.length) return noData(title, id, 'No data');
  const names = [];
  for (const r of clean) for (const g of r.groups) if (!names.includes(g.name)) names.push(g.name);
  const vals = clean.flatMap((r) => r.groups.flatMap((g) => g.values));
  const sc = niceScale(Math.min(...vals, ...(fin(min) ? [min] : [])), Math.max(...vals, ...(fin(max) ? [max] : [])), 6);
  const lg = legend(names.map((n, i) => ({ name: n, color: color(i), shape: SHAPES[i % SHAPES.length] })), 16, 52, width - 32);
  const lane = 15;
  const m = { l: 190, r: 24, t: 62 + lg.height, b: 50 };
  const rowH = (r) => r.groups.length * lane + 12;
  const height = m.t + clean.reduce((n, r) => n + rowH(r), 0) + m.b;
  const x0 = m.l; const x1 = width - m.r; const y0 = m.t; const y1 = height - m.b;
  const sx = lin(sc.min, sc.max, x0, x1);
  let body = head(title, subtitle) + lg.svg + axisX(sx, sc.ticks, y0, y1, unit);
  let y = y0;
  clean.forEach((r, ri) => {
    const h = rowH(r);
    if (ri % 2) body += R(16, y, width - 32, h, { fill: '#f6f6f6' });
    body += T(x0 - 8, y + h / 2 + 3, clip(r.label, 30), { anchor: 'end', size: 10 });
    r.groups.forEach((g, gi) => {
      const cy = y + 6 + gi * lane + lane / 2;
      const ci = names.indexOf(g.name);
      const seen = new Map();
      for (const v of g.values) {
        const k = v.toFixed(6);
        const dup = seen.get(k) || 0;
        seen.set(k, dup + 1);
        body += marker(SHAPES[ci % SHAPES.length], sx(v), cy + (dup % 2 ? 1 : -1) * Math.ceil(dup / 2) * 3, 3.3, color(ci));
      }
      const sorted = [...g.values].sort((a, b) => a - b);
      const mid = sorted.length % 2 ? sorted[sorted.length >> 1] : (sorted[(sorted.length >> 1) - 1] + sorted[sorted.length >> 1]) / 2;
      body += L(sx(mid), cy - 7, sx(mid), cy + 7, { role: 'median', stroke: INK, width: 2 });
    });
    y += h;
  });
  body += T(16, height - 8, 'Each dot is one replicate. The black tick is the median.', { size: 10, fill: '#555555' });
  const desc = `${title}. ${clean.length} row(s). ${clean.slice(0, 8).map((r) => `${clip(r.label, 24)}: ${r.groups.map((g) => `${clip(g.name, 14)} ${g.values.map((v) => fmt(v)).join('/')}`).join('; ')}`).join(' | ')}.`;
  return doc({ id, title, desc, width, height, body });
}

/**
 * Forest plot of deltas with 95% intervals, the zero line and a shaded noise band.
 * rows: [{label, delta, lo, hi, n, tone: 'good'|'bad'|'neutral'}]. noise: {lo, hi, label}.
 */
function forestPlot({ title, id, unit = '', rows = [], noise = null, subtitle, width = WIDTH }) {
  const valid = rows.filter((r) => fin(r.delta));
  if (!valid.length) return noData(title, id, 'No data');
  const dropped = rows.filter((r) => !fin(r.delta)).map((r) => r.label);
  const lo = (r) => (fin(r.lo) && fin(r.hi) ? Math.min(r.lo, r.hi, r.delta) : r.delta);
  const hi = (r) => (fin(r.lo) && fin(r.hi) ? Math.max(r.lo, r.hi, r.delta) : r.delta);
  const band = noise && fin(noise.lo) && fin(noise.hi) ? [Math.min(noise.lo, noise.hi), Math.max(noise.lo, noise.hi)] : null;
  const sc = niceScale(Math.min(0, ...valid.map(lo), ...(band ? [band[0]] : [])), Math.max(0, ...valid.map(hi), ...(band ? [band[1]] : [])), 6);
  const rowH = 24;
  const m = { l: 190, r: 150, t: 64, b: 56 };
  const height = m.t + valid.length * rowH + m.b;
  const x0 = m.l; const x1 = width - m.r; const y0 = m.t; const y1 = height - m.b;
  const sx = lin(sc.min, sc.max, x0, x1);
  let body = head(title, subtitle) + axisX(sx, sc.ticks, y0, y1, unit);
  if (band) body += R(sx(band[0]), y0, sx(band[1]) - sx(band[0]), y1 - y0, { fill: '#9a9a9a', opacity: 0.25, role: 'noise-band' }) + T(sx((band[0] + band[1]) / 2), y0 - 6, noise.label || 'noise band', { anchor: 'middle', size: 10, fill: '#444444' });
  body += L(sx(0), y0, sx(0), y1, { role: 'zero-line', width: 1.5 });
  const tone = { good: '#009E73', bad: '#D55E00', neutral: '#555555' };
  valid.forEach((r, i) => {
    const cy = y0 + i * rowH + rowH / 2;
    const col = tone[r.tone] || tone.neutral;
    body += T(x0 - 8, cy + 3, clip(r.label, 30), { anchor: 'end', size: 10 });
    if (fin(r.lo) && fin(r.hi)) {
      const a = sx(Math.min(r.lo, r.hi)); const b = sx(Math.max(r.lo, r.hi));
      body += L(a, cy, b, cy, { role: 'ci', stroke: col, width: 2 }) + L(a, cy - 4, a, cy + 4, { stroke: col }) + L(b, cy - 4, b, cy + 4, { stroke: col });
    }
    body += marker('square', sx(r.delta), cy, 4, col);
    body += T(x1 + 12, cy + 3, `${fmt(r.delta)}${fin(r.lo) && fin(r.hi) ? ` [${fmt(r.lo)}, ${fmt(r.hi)}]` : ''}${fin(r.n) ? ` n=${r.n}` : ''}`, { size: 10 });
  });
  const note = notePlotted(dropped.length, dropped);
  body += T(16, height - 8, note || 'Green: better than the base outside the noise. Orange: worse. Grey: inside the noise or unclear.', { size: 10, fill: '#555555' });
  const desc = `${title}. ${valid.length} row(s). ${valid.slice(0, 10).map((r) => `${clip(r.label, 24)} delta ${fmt(r.delta)}${fin(r.lo) && fin(r.hi) ? ` (${fmt(r.lo)} to ${fmt(r.hi)})` : ''}`).join('; ')}.${band ? ` Noise band ${fmt(band[0])} to ${fmt(band[1])}.` : ''}`;
  return doc({ id, title, desc, width, height, body });
}

/**
 * Horizontal stacked bars. rows: [{label, values: {key: number}, note}], segments: [{key, name, color}].
 * normalize draws every bar to 100%; otherwise bars share one count scale.
 */
function stackedBars({ title, id, segments = [], rows = [], normalize = false, subtitle, width = WIDTH, unit = '' }) {
  const segs = segments.map((s, i) => ({ ...s, color: s.color || color(i) }));
  const vOf = (r, k) => { const v = r.values?.[k]; return fin(v) && v > 0 ? v : 0; };
  const data = rows.map((r) => ({ ...r, total: segs.reduce((n, s) => n + vOf(r, s.key), 0) }));
  if (!data.length || !data.some((r) => r.total > 0)) return noData(title, id, 'No data');
  const lg = legend(segs.map((s) => ({ name: s.name, color: s.color })), 16, 52, width - 32);
  const rowH = 26;
  const m = { l: 190, r: 200, t: 62 + lg.height, b: 40 };
  const height = m.t + data.length * rowH + m.b;
  const x0 = m.l; const x1 = width - m.r; const y0 = m.t; const y1 = height - m.b;
  const maxTotal = Math.max(...data.map((r) => r.total));
  const sc = normalize ? { ticks: [0, 0.25, 0.5, 0.75, 1], min: 0, max: 1 } : niceScale(0, maxTotal, 5);
  const sx = lin(sc.min, sc.max, x0, x1);
  let body = head(title, subtitle) + lg.svg + axisX(sx, sc.ticks, y0, y1, normalize ? 'share of runs' : unit, normalize ? pctLabel : fmt);
  data.forEach((r, i) => {
    const cy = y0 + i * rowH + 4;
    body += T(x0 - 8, cy + 13, clip(r.label, 30), { anchor: 'end', size: 10 });
    let acc = 0;
    if (r.total === 0) body += T(x0 + 6, cy + 13, 'none', { size: 10, fill: '#777777' });
    for (const s of segs) {
      const v = vOf(r, s.key);
      if (!v) continue;
      const a = normalize ? acc / r.total : acc;
      const b = normalize ? (acc + v) / r.total : acc + v;
      const w = sx(b) - sx(a);
      body += R(sx(a), cy, w, 18, { fill: s.color, stroke: '#ffffff', role: 'segment' });
      if (w >= 20) body += T(sx(a) + w / 2, cy + 13, normalize && w >= 46 ? `${v} (${pctLabel(v / r.total)})` : fmt(v), { anchor: 'middle', size: 10, fill: onColor(s.color) });
      acc += v;
    }
    if (r.note) body += T(x1 + 10, cy + 13, clip(r.note, 34), { size: 10, fill: '#444444' });
  });
  const desc = `${title}. ${data.slice(0, 10).map((r) => `${clip(r.label, 24)}: ${segs.map((s) => `${s.name} ${vOf(r, s.key)}`).join(', ')}`).join('; ')}.`;
  return doc({ id, title, desc, width, height, body });
}

/** Heatmap with numeric cells. values[row][col] is a number or null. */
function heatmap({ title, id, rows = [], cols = [], values = [], min = 0, max = 1, subtitle, width = WIDTH, digits = 2 }) {
  const val = (r, k) => { const v = values[r]?.[k]; return fin(v) ? v : null; };
  const any = rows.some((_, r) => cols.some((__, k) => val(r, k) !== null));
  if (!rows.length || !cols.length || !any) return noData(title, id, 'No data');
  const m = { l: 190, r: 24, t: 84, b: 30 };
  const cw = Math.max(34, Math.min(84, (width - m.l - m.r) / cols.length));
  const rh = 24;
  const height = m.t + rows.length * rh + m.b;
  let body = head(title, subtitle);
  cols.forEach((col, k) => { body += T(m.l + k * cw + cw / 2, m.t - 8, clip(col, 28), { anchor: 'start', size: 10, rotate: -30 }); });
  const span = max - min || 1;
  rows.forEach((row, r) => {
    body += T(m.l - 8, m.t + r * rh + 16, clip(row, 30), { anchor: 'end', size: 10 });
    cols.forEach((_, k) => {
      const v = val(r, k);
      const x = m.l + k * cw; const y = m.t + r * rh;
      if (v === null) { body += R(x, y, cw - 2, rh - 2, { fill: '#eeeeee', stroke: '#cccccc' }) + T(x + cw / 2, y + 15, 'n/a', { anchor: 'middle', size: 10, fill: '#777777' }); return; }
      const t = Math.max(0, Math.min(1, (v - min) / span));
      const mix = (a, b) => Math.round(a + (b - a) * t).toString(16).padStart(2, '0');
      const fill = `#${mix(0xf7, 0x08)}${mix(0xfb, 0x45)}${mix(0xff, 0x8e)}`;
      body += R(x, y, cw - 2, rh - 2, { fill, stroke: '#ffffff', role: 'cell' }) + T(x + cw / 2, y + 15, v.toFixed(digits), { anchor: 'middle', size: 10, fill: t > 0.5 ? '#ffffff' : INK });
    });
  });
  const desc = `${title}. ${rows.length} row(s) by ${cols.length} column(s); cells hold numbers from ${fmt(min)} to ${fmt(max)}. ${rows.slice(0, 6).map((row, r) => `${clip(row, 20)}: ${cols.slice(0, 6).map((col, k) => `${clip(col, 10)} ${val(r, k) === null ? 'n/a' : val(r, k).toFixed(digits)}`).join(', ')}`).join('; ')}.`;
  return doc({ id, title, desc, width, height, body });
}

/** Horizontal bars with optional interval whiskers. rows: [{label, value, lo, hi, note, color}]. */
function hBars({ title, id, rows = [], max, percent = false, unit = '', subtitle, width = WIDTH }) {
  const valid = rows.filter((r) => fin(r.value));
  if (!valid.length) return noData(title, id, rows.length ? 'none of the values were finite' : 'No data');
  const dropped = rows.filter((r) => !fin(r.value)).map((r) => r.label);
  const top = Math.max(...valid.map((r) => (fin(r.hi) ? Math.max(r.hi, r.value) : r.value)), ...(fin(max) ? [max] : []));
  const sc = percent ? niceScale(0, Math.max(top, 0.0001), 5) : niceScale(0, top, 5);
  const rowH = 22;
  const m = { l: 190, r: 190, t: 52, b: 56 };
  const height = m.t + valid.length * rowH + m.b;
  const x0 = m.l; const x1 = width - m.r; const y0 = m.t; const y1 = height - m.b;
  const sx = lin(sc.min, sc.max, x0, x1);
  const fm = percent ? pctLabel : fmt;
  let body = head(title, subtitle) + axisX(sx, sc.ticks, y0, y1, unit, fm);
  valid.forEach((r, i) => {
    const cy = y0 + i * rowH + 3;
    body += T(x0 - 8, cy + 12, clip(r.label, 30), { anchor: 'end', size: 10 });
    body += R(x0, cy, sx(Math.max(0, r.value)) - x0, 14, { fill: r.color || color(0), role: 'bar' });
    if (fin(r.lo) && fin(r.hi)) body += L(sx(Math.min(r.lo, r.hi)), cy + 7, sx(Math.max(r.lo, r.hi)), cy + 7, { role: 'ci', width: 1.5 }) + L(sx(r.lo), cy + 3, sx(r.lo), cy + 11) + L(sx(r.hi), cy + 3, sx(r.hi), cy + 11);
    body += T(x1 + 10, cy + 12, `${fm(r.value)}${fin(r.lo) && fin(r.hi) ? ` [${fm(r.lo)}, ${fm(r.hi)}]` : ''}${r.note ? ` ${r.note}` : ''}`, { size: 10 });
  });
  const note = notePlotted(dropped.length, dropped);
  if (note) body += T(16, height - 8, note, { size: 10, fill: '#7a4a00' });
  const desc = `${title}. ${valid.length} bar(s): ${valid.slice(0, 12).map((r) => `${clip(r.label, 24)} ${fm(r.value)}${r.note ? ` ${r.note}` : ''}`).join('; ')}.${note ? ` ${note}.` : ''}`;
  return doc({ id, title, desc, width, height, body });
}

/** Run durations in start order, one bar per run coloured by arm; timeouts and errors are marked. runs: [{label, arm, ms, status}]. */
function durationBars({ title, id, runs = [], subtitle, width = WIDTH, height = 300 }) {
  const valid = runs.filter((r) => fin(r.ms) && r.ms >= 0);
  if (!valid.length) return noData(title, id, runs.length ? 'no run had a finite duration' : 'No data');
  const arms = [];
  for (const r of valid) if (!arms.includes(r.arm)) arms.push(r.arm);
  const sc = niceScale(0, Math.max(...valid.map((r) => r.ms / 60000)), 5);
  const lg = legend([...arms.map((a, i) => ({ name: a, color: color(i) })), { name: 'T = timeout, E = error', color: '#ffffff' }], 16, 52, width - 32);
  const m = { l: 62, r: 20, t: 64 + lg.height, b: 40 };
  const x0 = m.l; const x1 = width - m.r; const y0 = m.t; const y1 = height - m.b;
  const sy = lin(sc.min, sc.max, y1, y0);
  let body = head(title, subtitle) + lg.svg + axisY(sy, sc.ticks, x0, x1, 'minutes');
  const slot = (x1 - x0) / valid.length;
  const bw = Math.max(2, Math.min(18, slot - 1.5));
  valid.forEach((r, i) => {
    const x = x0 + i * slot + (slot - bw) / 2;
    const top = sy(r.ms / 60000);
    const bad = r.status === 'timeout' || r.status === 'error';
    body += R(x, top, bw, y1 - top, { fill: color(arms.indexOf(r.arm)), stroke: bad ? '#D55E00' : '#ffffff', width: bad ? 1.5 : 1, role: r.status === 'timeout' ? 'timeout' : 'bar' });
    if (bad && bw >= 6) body += T(x + bw / 2, top - 3, r.status === 'timeout' ? 'T' : 'E', { anchor: 'middle', size: 9, fill: '#D55E00', weight: 'bold' });
  });
  body += T((x0 + x1) / 2, y1 + 18, `${valid.length} run(s) in start order`, { anchor: 'middle', fill: '#444444' });
  const desc = `${title}. ${valid.length} run(s); longest ${fmt(Math.max(...valid.map((r) => r.ms)) / 60000)} minutes; ${valid.filter((r) => r.status === 'timeout').length} timeout(s), ${valid.filter((r) => r.status === 'error').length} error(s).`;
  return doc({ id, title, desc, width, height, body });
}

module.exports = { PALETTE, CLASS_COLORS, esc, fmt, niceScale, scatter, groupedBarsCI, dotPlot, forestPlot, stackedBars, heatmap, hBars, durationBars, noData };
