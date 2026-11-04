// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { tmp, makeBench, makeRun, writeJudgments } = require('./helpers.js');
const { DEFAULTS } = require('../../judge/config.js');
const { compileRedactions, DEFAULT_REDACTIONS } = require('../../judge/redact.js');
const { writeReview, importRatings, validateRatings, sampleParams } = require('../../cap/review.js');
const viewer = require('../../cap/review-viewer.js');

const BENCH_JS = path.join(__dirname, '..', 'bench.js');
const SECRET = 'AKIAABCDEFGHIJKLMNOP';
// Neutral file markers, so the test can tell outputs apart without the page naming an arm.
const MARK = { vanilla: 'out-x', 'v1.2.0': 'out-y' };

// Two arms, three replicates of one task. Arm "vanilla" passes c1 on odd replicates; every output names the
// tool, holds a credential-shaped string and markup that must stay inert.
function fixture() {
  const root = tmp();
  const bench = makeBench(path.join(root, 'bench'));
  const specs = [];
  for (const arm of ['vanilla', 'v1.2.0']) {
    for (let rep = 1; rep <= 3; rep++) {
      specs.push({ arm, rep, finalText: `answer ${arm === 'vanilla' ? 'one' : 'two'} r${rep} via konductor key ${SECRET} <script>alert(1)</script>`, files: { 'a.txt': `${MARK[arm]}-${rep}\n` } });
    }
  }
  const runDir = makeRun(path.join(root, 'run'), bench, specs);
  return { root, bench, runDir };
}
const opts = (f, o = {}) => ({ runDir: f.runDir, benchDir: f.bench, limits: DEFAULTS.limits, redactions: compileRedactions(DEFAULT_REDACTIONS), env: {}, ...o });
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const dataOf = (html) => JSON.parse(html.match(/<script type="application\/json" id="review-data">([\s\S]*?)<\/script>/)[1]);
const scriptOf = (html) => html.match(/<script>([\s\S]*?)<\/script>/)[1];

test('the page is static, blinded, redacted and scrubbed, and the key maps each letter back to its run', () => {
  const f = fixture();
  try {
    const r = writeReview(opts(f, { n: 2, seed: 3 }));
    const html = fs.readFileSync(r.pagePath, 'utf8');
    const key = readJson(r.keyPath);
    assert.equal(r.dir, path.join(f.runDir, 'calibration', 'review'));
    // Nothing loads from elsewhere and nothing can connect.
    assert.doesNotMatch(html, /https?:\/\/|\bsrc=|<link\b|<iframe|\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/);
    // The attribute is HTML-escaped; a browser reads &apos; as a quote.
    const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1].replace(/&apos;/g, "'");
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /connect-src 'none'/);
    const hash = crypto.createHash('sha256').update(scriptOf(html)).digest('base64');
    assert.ok(csp.includes(`'sha256-${hash}'`), 'the CSP allows exactly the inline script');
    new vm.Script(scriptOf(html));
    // Blind: no arm, task id, replicate or run path on the page.
    assert.doesNotMatch(html, /vanilla|v1\.2\.0|armId|"t1"|replicate/);
    assert.ok(!html.includes(f.runDir));
    // Same redaction as the judges, then credential scrubbing; markup cannot leave the data block.
    assert.doesNotMatch(html, /konductor/i);
    assert.ok(!html.includes(SECRET));
    assert.ok(!html.includes('<script>alert'));
    const data = dataOf(html);
    assert.equal(data.viewerId, r.viewerId);
    assert.ok(data.groups[0].outputs[0].bundle.includes('<script>alert(1)</script>'), 'the text survives as data');
    assert.ok(data.groups[0].outputs[0].bundle.includes('<redacted>'));
    // Peers: each drawn (task, replicate) shows both arms side by side.
    assert.ok(data.groups.every((g) => g.outputs.length === 2 && g.outputs.map((o) => o.label).join() === 'A,B'));
    const flat = key.groups.flatMap((g) => g.items);
    assert.deepEqual(new Set(flat.map((i) => i.armId)), new Set(['vanilla', 'v1.2.0']));
    for (const g of key.groups) {
      for (const it of g.items) {
        const shown = data.groups.find((d) => d.groupId === g.groupId).outputs.find((o) => o.itemId === it.itemId);
        assert.equal(shown.bundle, it.bundle);
        assert.ok(shown.bundle.includes(`${MARK[it.armId]}-${it.replicate}`), 'the letter points at the run whose files are shown');
      }
    }
    assert.deepEqual(validateRatings(viewer.ratingsPayload(data, viewer.emptyState(data), null), key), []);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('the draw is deterministic for a seed, letters vary by task, and --sample-only shows the drawn runs only', () => {
  const f = fixture();
  try {
    const a = writeReview(opts(f, { n: 6, seed: 5, outDir: path.join(f.root, 'a') }));
    const b = writeReview(opts(f, { n: 6, seed: 5, outDir: path.join(f.root, 'b') }));
    assert.equal(a.viewerId, b.viewerId);
    assert.equal(fs.readFileSync(a.pagePath, 'utf8'), fs.readFileSync(b.pagePath, 'utf8'));
    const key = readJson(a.keyPath);
    assert.equal(key.groups.length, 3);
    const firsts = new Set(key.groups.map((g) => g.items[0].armId));
    assert.equal(firsts.size, 2, 'with this seed, A is not always the same arm');
    const s = writeReview(opts(f, { n: 2, seed: 5, sampleOnly: true, outDir: path.join(f.root, 's') }));
    assert.equal(s.outputs, 2);
    assert.notEqual(s.viewerId, a.viewerId);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('n and seed come from calibration-sample.json when no flag is given, and a different page is not silently replaced', () => {
  const f = fixture();
  try {
    assert.deepEqual(sampleParams(f.runDir, {}), { n: 25, seed: 1, from: 'defaults' });
    fs.writeFileSync(path.join(f.runDir, 'calibration-sample.json'), JSON.stringify({ schemaVersion: 1, n: 2, seed: 9, items: [] }));
    assert.deepEqual(sampleParams(f.runDir, {}), { n: 2, seed: 9, from: 'calibration-sample.json' });
    assert.deepEqual(sampleParams(f.runDir, { n: 4 }), { n: 4, seed: 9, from: 'flags' });
    const r = writeReview(opts(f));
    assert.equal(readJson(r.keyPath).seed, 9);
    writeReview(opts(f));
    assert.throws(() => writeReview(opts(f, { seed: 10 })), /Pass --force/);
    writeReview(opts(f, { seed: 10, force: true }));
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

// Rates every output the way the truth table says: c1 pass on odd replicates, c2 always pass.
function rate(r, { quote } = {}) {
  const key = readJson(r.keyPath);
  const data = dataOf(fs.readFileSync(r.pagePath, 'utf8'));
  const state = viewer.emptyState(data);
  state.rater = 'tester';
  for (const g of key.groups) {
    for (const it of g.items) {
      state.items[it.itemId].labels = { c1: it.replicate % 2 ? 'pass' : 'fail', c2: 'pass' };
      if (quote) state.items[it.itemId].evidence.c1 = quote(it);
    }
  }
  return viewer.ratingsPayload(data, state, '2026-11-04T00:00:00Z');
}

function judgePanel(runDir) {
  const rubric = [];
  for (const arm of ['vanilla', 'v1.2.0']) {
    for (let rep = 1; rep <= 3; rep++) {
      const truth = rep % 2 ? 'pass' : 'fail';
      rubric.push({ judge: 'good', arm, rep, criteria: { c1: truth, c2: 'pass' }, score: truth === 'pass' ? 1 : 0.75 });
      rubric.push({ judge: 'bad', arm, rep, criteria: { c1: truth === 'pass' ? 'fail' : 'pass', c2: 'fail' }, score: truth === 'pass' ? 0 : 0.25 });
    }
  }
  writeJudgments(runDir, { judges: ['bad', 'good'], rubric });
}

test('import joins ratings to runs through the key, writes the calibrate files and result.json, and scores kappa', () => {
  const f = fixture();
  try {
    judgePanel(f.runDir);
    const r = writeReview(opts(f, { n: 6, seed: 2 }));
    const ratingsFile = path.join(f.root, 'ratings.json');
    fs.writeFileSync(ratingsFile, JSON.stringify(rate(r, { quote: (it) => (it.armId === 'vanilla' ? 'answer one' : 'not in the output at all') })));
    const out = importRatings({ ratingsFile, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds });
    assert.equal(out.savePath, path.join(f.runDir, 'calibration', 'result.json'));
    assert.equal(out.res.itemsLabeled, 6);
    assert.equal(out.res.judges.good.status, 'PASS');
    assert.equal(out.res.judges.good.kappa, 1);
    assert.equal(out.res.judges.good.nCriteria, 12);
    assert.equal(out.res.judges.bad.status, 'WARN');
    assert.equal(out.quotes.checked, 6);
    assert.equal(out.quotes.found, 3);
    assert.equal(out.quotes.notFound.length, 3);
    // The written sheet and key are what calibrate score reads.
    const sheetKey = readJson(out.sheetKeyPath);
    const sheet = readJson(out.sheetPath);
    for (const it of sheet.items) assert.equal(it.labels.c1, sheetKey.items[it.itemId].replicate % 2 ? 'pass' : 'fail');
    const saved = readJson(out.savePath);
    assert.equal(saved.source.kind, 'review');
    assert.equal(saved.source.rater, 'tester');
    // Re-importing the same page replaces its own result; a result from elsewhere needs --force.
    importRatings({ ratingsFile, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds });
    fs.writeFileSync(out.savePath, JSON.stringify({ judges: {} }));
    assert.throws(() => importRatings({ ratingsFile, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds }), /pass --force/);
    importRatings({ ratingsFile, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds, force: true });
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('validation names each problem and nothing is written for a bad file', () => {
  const f = fixture();
  try {
    const r = writeReview(opts(f, { n: 2, seed: 1 }));
    const key = readJson(r.keyPath);
    const good = rate(r);
    const itemId = good.items[0].itemId;
    const bad = (mut) => { const x = JSON.parse(JSON.stringify(good)); mut(x); return validateRatings(x, key).join('\n'); };
    assert.match(bad((x) => { x.viewerId = 'other'; }), /another page/);
    assert.match(bad((x) => { x.schemaVersion = 2; }), /schemaVersion/);
    assert.match(bad((x) => { x.kind = 'x'; }), /kind/);
    assert.match(bad((x) => { x.extra = 1; }), /unknown field "extra"/);
    assert.match(bad((x) => { x.items[0].itemId = 'g999-A'; }), /not in the key/);
    assert.match(bad((x) => { x.items.push(x.items[0]); }), /appears twice/);
    assert.match(bad((x) => { x.items[0].labels.c1 = 'yes'; }), /use pass, partial, fail or null/);
    assert.match(bad((x) => { x.items[0].labels.zz = 'pass'; }), /criterion "zz" is not in the rubric/);
    assert.match(bad((x) => { x.items[0].evidence = { c1: 5 }; }), /evidence for c1/);
    assert.match(bad((x) => { x.items[0].notes = 'n'.repeat(5000); }), /notes/);
    assert.deepEqual(validateRatings('[]', key), ['ratings file is not a JSON object']);
    const ratingsFile = path.join(f.root, 'bad.json');
    fs.writeFileSync(ratingsFile, JSON.stringify({ ...good, viewerId: 'nope' }));
    assert.throws(() => importRatings({ ratingsFile, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds }), /not imported/);
    assert.ok(!fs.existsSync(path.join(r.dir, 'sheet.json')));
    assert.ok(!fs.existsSync(path.join(f.runDir, 'calibration', 'result.json')));
    assert.ok(itemId);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('the page helpers: blank state, progress, merge refuses another page and ignores unknown items', () => {
  const data = { viewerId: 'v1', groups: [{ groupId: 'g001', task: { prompt: 'p', rubric: [{ id: 'c1' }, { id: 'c2' }] }, outputs: [{ itemId: 'g001-A' }, { itemId: 'g001-B' }] }] };
  const s = viewer.emptyState(data);
  assert.deepEqual(viewer.progress(data, s), { done: 0, total: 2 });
  s.items['g001-A'].labels = { c1: 'pass', c2: 'partial' };
  s.items['g001-A'].evidence = { c1: 'q', c2: '  ' };
  assert.deepEqual(viewer.progress(data, s), { done: 1, total: 2 });
  const out = viewer.ratingsPayload(data, s, 'now');
  assert.deepEqual(out.items[0], { itemId: 'g001-A', labels: { c1: 'pass', c2: 'partial' }, evidence: { c1: 'q' }, notes: '' });
  const t = viewer.emptyState(data);
  const m = viewer.mergeRatings(data, t, { ...out, items: [...out.items, { itemId: 'g009-A', labels: {} }] });
  assert.deepEqual(m, { applied: 2, skipped: 1 });
  assert.equal(t.items['g001-A'].labels.c1, 'pass');
  assert.throws(() => viewer.mergeRatings(data, t, { ...out, viewerId: 'v2' }), /viewer v2/);
  assert.throws(() => viewer.mergeRatings(data, t, {}), /not a ratings file/);
});

test('the page script wires up and exports the ratings with a stub DOM, and makes no network call', () => {
  const f = fixture();
  try {
    const r = writeReview(opts(f, { n: 2, seed: 4 }));
    const html = fs.readFileSync(r.pagePath, 'utf8');
    const nodes = {};
    const listeners = {};
    let downloaded = null;
    const mk = (tag) => {
      const n = {
        tagName: String(tag).toUpperCase(), children: [], attrs: {}, textContent: '', value: '', checked: false, className: '',
        appendChild(c) { this.children.push(c); c.parent = this; return c; },
        setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(ev, fn) { (this.on ??= {})[ev] = fn; },
        click() { if (this.attrs.download) downloaded = this.attrs.href; }, remove() {},
        get firstChild() { return this.children[0]; },
      };
      return n;
    };
    for (const id of ['rater', 'prev', 'next', 'unrated', 'download', 'load', 'status', 'where', 'group']) nodes[id] = mk('div');
    nodes['review-data'] = { textContent: html.match(/id="review-data">([\s\S]*?)<\/script>/)[1] };
    const blobs = [];
    const store = new Map();
    const doc = { getElementById: (id) => nodes[id], createElement: mk, body: mk('body'), addEventListener: (ev, fn) => { listeners[ev] = fn; } };
    const win = {
      localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
      URL: { createObjectURL: (b) => { blobs.push(b); return 'blob:1'; }, revokeObjectURL() {} },
      Blob: class { constructor(parts) { this.text = parts.join(''); } },
      setTimeout() {}, scrollTo() {}, addEventListener() {},
    };
    vm.runInNewContext(scriptOf(html), { document: doc, window: win, JSON, Object, Math, String, Date, Error });
    assert.match(nodes.status.textContent, /0 of 4 outputs fully rated/);
    // Find the radio inputs that render() made, and choose "pass" for every criterion.
    const radios = [];
    const walk = (n) => { if (n.attrs?.type === 'radio') radios.push(n); for (const c of n.children ?? []) walk(c); };
    walk(nodes.group);
    for (const rd of radios.filter((x) => x.attrs.value === 'pass')) rd.on.change();
    assert.match(nodes.status.textContent, /2 of 4 outputs fully rated, changes not yet downloaded/);
    nodes.download.on.click();
    assert.equal(downloaded, 'blob:1');
    const payload = JSON.parse(blobs[0].text);
    assert.equal(payload.viewerId, r.viewerId);
    assert.deepEqual(validateRatings(payload, readJson(r.keyPath)), []);
    assert.equal(payload.items.filter((i) => i.labels.c1 === 'pass').length, 2);
    assert.ok(store.size === 1, 'ratings were kept in localStorage');
    listeners.keydown({ key: 'ArrowRight', target: {} });
    assert.equal(nodes.where.textContent, 'Task 2 of 2');
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('cap review and cap review-import from the command line', () => {
  const f = fixture();
  try {
    judgePanel(f.runDir);
    const env = { PATH: process.env.PATH, HOME: f.root, TMPDIR: process.env.TMPDIR };
    const cli = (args) => spawnSync(process.execPath, [BENCH_JS, ...args], { env, encoding: 'utf8' });
    const a = cli(['cap', 'review', '--run', f.runDir, '--bench-dir', f.bench, '--n', '6', '--seed', '2']);
    assert.equal(a.status, 0, a.stderr);
    assert.match(a.stdout, /3 task\(s\), 6 output\(s\)/);
    assert.match(a.stdout, /do not give it to the rater/);
    const keyPath = path.join(f.runDir, 'calibration', 'review', 'review-key.json');
    const ratingsFile = path.join(f.root, 'ratings.json');
    fs.writeFileSync(ratingsFile, JSON.stringify(rate({ keyPath, pagePath: path.join(path.dirname(keyPath), 'review.html') })));
    const b = cli(['cap', 'review-import', '--ratings', ratingsFile, '--key', keyPath]);
    assert.equal(b.status, 0, b.stderr);
    assert.match(b.stdout, /good\s+PASS/);
    assert.match(b.stdout, /Evidence quotes: none given/);
    const bad = cli(['cap', 'review-import', '--ratings', path.join(f.root, 'missing.json'), '--key', keyPath]);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /cannot read/);
    const typo = cli(['cap', 'review', '--run', f.runDir, '--sample']);
    assert.equal(typo.status, 2);
    assert.match(typo.stderr, /unknown flag --sample\b/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});
