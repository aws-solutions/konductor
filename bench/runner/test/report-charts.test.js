// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const charts = require('../../report/charts.js');
const { wellFormed, lint } = require('./svg-check.js');

const NASTY = `a<b>&"c'd`;

function check(svg, name) {
  assert.equal(wellFormed(svg), null, `${name}: not well-formed`);
  assert.equal(lint(svg), null, `${name}: xmllint rejected it`);
  assert.ok(!/NaN|Infinity|undefined/.test(svg), `${name}: leaked NaN, Infinity or undefined`);
  assert.match(svg, /<title id="[^"]+">/, `${name}: no <title>`);
  assert.match(svg, /<desc id="[^"]+">/, `${name}: no <desc>`);
  assert.match(svg, /role="img"/);
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(svg), `${name}: external reference`);
  assert.ok(!/<script|<foreignObject|\sonload=/i.test(svg), `${name}: active content`);
  return svg;
}

const pts = [
  { label: 'vanilla', x: 1.2, xLo: 1, xHi: 1.5, y: 80, yLo: 70, yHi: 90, n: 5, isBase: true },
  { label: NASTY, x: 4.1, xLo: 3.5, xHi: 5, y: 85, yLo: 75, yHi: 95, n: 5 },
];

const BUILDERS = {
  scatter: (d) => charts.scatter({ title: 'Cost vs quality', id: 's', xLabel: 'credits', yLabel: 'quality', yMin: 0, yMax: 100, points: d }),
  grouped: (d) => charts.groupedBarsCI({ title: 'Credits', id: 'g', unit: 'credits', categories: d.categories, series: d.series }),
  dots: (d) => charts.dotPlot({ title: 'Per task', id: 'd', unit: 'quality', rows: d }),
  forest: (d) => charts.forestPlot({ title: 'Deltas', id: 'f', unit: 'credits', rows: d, noise: { lo: -1, hi: 1, label: 'A/A spread' } }),
  stacked: (d) => charts.stackedBars({ title: 'Pairwise', id: 'p', segments: [{ key: 'win', name: 'win' }, { key: 'tie', name: 'tie' }, { key: 'loss', name: 'loss' }], rows: d, normalize: true }),
  heat: (d) => charts.heatmap({ title: 'Agreement', id: 'h', rows: d.rows, cols: d.cols, values: d.values, min: 0, max: 1 }),
  hbars: (d) => charts.hBars({ title: 'Load rate', id: 'b', rows: d, max: 1, percent: true }),
  duration: (d) => charts.durationBars({ title: 'Durations', id: 'u', runs: d }),
};

const SAMPLE = {
  scatter: pts,
  grouped: { categories: ['overall', NASTY], series: [{ name: 'a', values: [{ v: 2, lo: 1, hi: 3 }, { v: 4, lo: 3, hi: 6 }] }, { name: 'b', values: [{ v: 3, lo: 2, hi: 4 }, null] }] },
  dots: [{ label: NASTY, groups: [{ name: 'a', values: [1, 2, 3] }, { name: 'b', values: [2, 2.5] }] }, { label: 't2', groups: [{ name: 'a', values: [5] }] }],
  forest: [{ label: NASTY, delta: 2, lo: 1, hi: 3, n: 3 }, { label: 't2', delta: -0.5, lo: -2, hi: 1, n: 3 }],
  stacked: [{ label: NASTY, values: { win: 3, tie: 2, loss: 1 }, note: 'pos-inconsistent 1 of 6' }, { label: 'b', values: { win: 0, tie: 0, loss: 0 } }],
  heat: { rows: ['a~b', NASTY], cols: ['t1', 't2'], values: [[0.9, 0.2], [null, 1]] },
  hbars: [{ label: NASTY, value: 0.3, lo: 0.1, hi: 0.5, note: 'n=10' }, { label: 'b', value: 0, lo: 0, hi: 0.2, note: 'n=12' }],
  duration: [{ label: 'a', arm: 'a', ms: 60000, status: 'success' }, { label: 'b', arm: 'b', ms: 600000, status: 'timeout' }],
};

for (const name of Object.keys(BUILDERS)) {
  test(`${name}: well-formed, accessible, escaped, deterministic`, () => {
    const svg = check(BUILDERS[name](SAMPLE[name]), name);
    assert.equal(svg, BUILDERS[name](SAMPLE[name]), 'same input must give the same bytes');
    assert.ok(!svg.includes(NASTY), 'raw label must not appear unescaped');
    if (JSON.stringify(SAMPLE[name]).includes('a<b>')) assert.ok(svg.includes('a&lt;b&gt;&amp;&quot;c&apos;d'), 'escaped label must appear');
  });

  test(`${name}: empty data renders a no-data panel`, () => {
    const empty = { scatter: [], grouped: { categories: [], series: [] }, dots: [], forest: [], stacked: [], heat: { rows: [], cols: [], values: [] }, hbars: [], duration: [] }[name];
    const svg = check(BUILDERS[name](empty), `${name} empty`);
    assert.match(svg, /No data/);
  });
}

test('single point scatter and single bar do not divide by zero', () => {
  check(BUILDERS.scatter([pts[0]]), 'single scatter');
  check(BUILDERS.scatter([{ label: 'x', x: 3, y: 3 }]), 'scatter without CI');
  check(BUILDERS.forest([{ label: 'one', delta: 0, lo: 0, hi: 0, n: 1 }]), 'degenerate forest');
  check(BUILDERS.hbars([{ label: 'one', value: 0.5, lo: 0.5, hi: 0.5, note: '' }]), 'single bar');
  check(BUILDERS.dots([{ label: 'same', groups: [{ name: 'a', values: [2, 2, 2] }] }]), 'identical dots');
});

test('non-finite and extreme values are dropped or scaled, never printed', () => {
  const bad = [{ label: 'nan', x: NaN, y: 3 }, { label: 'inf', x: Infinity, y: 1 }, { label: 'ok', x: 1e12, xLo: 1e11, xHi: 1e13, y: 50, yLo: NaN, yHi: Infinity }, { label: 'neg', x: -1e-9, y: 0 }];
  const svg = check(BUILDERS.scatter(bad), 'extreme scatter');
  assert.match(svg, /not plotted/);
  check(BUILDERS.hbars([{ label: 'a', value: NaN, lo: NaN, hi: NaN, note: '' }, { label: 'b', value: Infinity, lo: 0, hi: 1, note: '' }]), 'nan bars');
  check(BUILDERS.forest([{ label: 'a', delta: 1e300, lo: -1e300, hi: 1e300, n: 3 }]), 'huge forest');
  check(BUILDERS.stacked([{ label: 'a', values: { win: NaN, tie: -3, loss: Infinity } }]), 'bad stacked');
  check(BUILDERS.duration([{ label: 'a', arm: 'a', ms: NaN, status: 'success' }, { label: 'b', arm: 'a', ms: 1e15, status: 'error' }]), 'bad durations');
  check(BUILDERS.heat({ rows: ['a'], cols: ['b'], values: [[NaN]] }), 'nan heat');
});

test('niceScale gives sane ticks', () => {
  const s = charts.niceScale(0, 97, 5);
  assert.deepEqual(s.ticks, [0, 20, 40, 60, 80, 100]);
  assert.equal(s.min, 0);
  assert.equal(s.max, 100);
  const flat = charts.niceScale(5, 5, 5);
  assert.ok(flat.min < 5 && flat.max > 5 && flat.ticks.length >= 2);
  const neg = charts.niceScale(-3.2, 1.1, 4);
  assert.ok(neg.min <= -3.2 && neg.max >= 1.1 && neg.ticks.includes(0));
  const tiny = charts.niceScale(0.0001, 0.0003, 5);
  assert.ok(tiny.ticks.every((t) => Number.isFinite(t)) && tiny.ticks.length <= 12);
  const huge = charts.niceScale(0, 1e300, 5);
  assert.ok(huge.ticks.every(Number.isFinite));
  assert.deepEqual(charts.niceScale(NaN, Infinity, 5).ticks.length >= 2, true);
  for (const [a, b] of [[0, 1], [0, 7], [1.5, 1.52], [-100, 100], [0, 1e6]]) {
    const t = charts.niceScale(a, b, 5);
    assert.ok(t.ticks.length >= 2 && t.ticks.length <= 12, `${a}..${b} gave ${t.ticks.length} ticks`);
    assert.ok(t.min <= a && t.max >= b);
  }
});

test('scatter marks the base arm and draws CI whiskers on both axes', () => {
  const svg = BUILDERS.scatter(pts);
  assert.match(svg, /data-role="base"/);
  assert.equal((svg.match(/data-role="whisker-x"/g) || []).length, 2);
  assert.equal((svg.match(/data-role="whisker-y"/g) || []).length, 2);
});

test('whisker orientation: the low end is left of and below the high end', () => {
  const svg = charts.scatter({ title: 't', id: 'w', points: [{ label: 'p', x: 5, xLo: 2, xHi: 8, y: 50, yLo: 30, yHi: 70 }], xLabel: 'x', yLabel: 'y' });
  const wx = svg.match(/data-role="whisker-x" x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)"/);
  const wy = svg.match(/data-role="whisker-y" x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)"/);
  assert.ok(wx && wy);
  assert.ok(Number(wx[1]) < Number(wx[3]), 'x whisker runs low to high, left to right');
  assert.ok(Number(wy[2]) > Number(wy[4]), 'y whisker low end is lower on screen (larger y pixel)');
});

test('grouped bars draw the CI whisker from low to high around the bar top', () => {
  const svg = charts.groupedBarsCI({ title: 't', id: 'q', unit: 'u', categories: ['c'], series: [{ name: 'a', values: [{ v: 5, lo: 3, hi: 9 }] }] });
  const w = svg.match(/data-role="ci" x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)"/);
  assert.ok(w);
  assert.ok(Number(w[2]) > Number(w[4]), 'low end below the high end');
});

test('forest plot shades the noise band and draws the zero line', () => {
  const svg = BUILDERS.forest(SAMPLE.forest);
  assert.match(svg, /data-role="noise-band"/);
  assert.match(svg, /data-role="zero-line"/);
  assert.match(svg, /A\/A spread/);
});

test('long labels are clipped, not overflowing', () => {
  const svg = BUILDERS.hbars([{ label: 'x'.repeat(300), value: 0.5, lo: 0.4, hi: 0.6, note: '' }]);
  check(svg, 'long label');
  assert.ok(!svg.includes('x'.repeat(100)));
});

test('palette is colorblind safe and has distinct entries', () => {
  assert.equal(new Set(charts.PALETTE).size, charts.PALETTE.length);
  assert.ok(charts.PALETTE.includes('#0072B2') && charts.PALETTE.includes('#E69F00'));
});
