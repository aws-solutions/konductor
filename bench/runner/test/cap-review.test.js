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
const { writeReview, importRatings, validateRatings, sampleParams, raterIdOf, seenHash } = require('../../cap/review.js');
const { formatRaterKappas, raterKappas, scoreLabels } = require('../../judge/calibrate.js');
const { readCalibration } = require('../../report/generate.js');
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
    assert.equal(r.keyPath, path.join(f.runDir, 'calibration', 'review-key', 'review-key.json'));
    // The page directory can be handed over whole: it holds the page and nothing that names an arm.
    assert.deepEqual(fs.readdirSync(r.dir), ['review.html']);
    // The key names no absolute path; it finds the run relative to itself.
    assert.equal(key.run, path.join('..', '..'));
    assert.ok(!JSON.stringify(key).includes(f.root));
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
    const a = writeReview(opts(f, { n: 6, seed: 5, outDir: path.join(f.root, 'a', 'page'), keyOutDir: path.join(f.root, 'a', 'key') }));
    const b = writeReview(opts(f, { n: 6, seed: 5, outDir: path.join(f.root, 'b', 'page'), keyOutDir: path.join(f.root, 'b', 'key') }));
    assert.equal(a.viewerId, b.viewerId);
    assert.equal(fs.readFileSync(a.pagePath, 'utf8'), fs.readFileSync(b.pagePath, 'utf8'));
    const key = readJson(a.keyPath);
    assert.equal(key.groups.length, 3);
    const firsts = new Set(key.groups.map((g) => g.items[0].armId));
    assert.equal(firsts.size, 2, 'with this seed, A is not always the same arm');
    const s = writeReview(opts(f, { n: 2, seed: 5, sampleOnly: true, outDir: path.join(f.root, 's', 'page'), keyOutDir: path.join(f.root, 's', 'key') }));
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

// The "good" judge agrees with the truth table, the "bad" one inverts it. A rater's kappa is the lowest over the panel,
// so tests that read a rater's kappa pass `only: ['good']`.
function judgePanel(runDir, { only = ['bad', 'good'] } = {}) {
  const rubric = [];
  for (const arm of ['vanilla', 'v1.2.0']) {
    for (let rep = 1; rep <= 3; rep++) {
      const truth = rep % 2 ? 'pass' : 'fail';
      rubric.push({ judge: 'good', arm, rep, criteria: { c1: truth, c2: 'pass' }, score: truth === 'pass' ? 1 : 0.75 });
      rubric.push({ judge: 'bad', arm, rep, criteria: { c1: truth === 'pass' ? 'fail' : 'pass', c2: 'fail' }, score: truth === 'pass' ? 0 : 0.25 });
    }
  }
  writeJudgments(runDir, { judges: only, rubric: rubric.filter((x) => only.includes(x.judge)) });
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
    assert.equal(out.raterId, 'tester');
    assert.equal(out.raterFile, path.join(r.keyDir, 'raters', 'tester', 'ratings.json'));
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
    assert.deepEqual(saved.source.raters, ['tester']);
    assert.equal(saved.byRater.tester.judges.good.kappa, 1);
    assert.equal(readJson(path.join(r.keyDir, 'raters', 'tester', 'result.json')).judges.good.kappa, 1);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

// Every file under a directory with its bytes, to show a refused import wrote nothing.
const snapshot = (dir) => {
  const out = {};
  const visit = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) visit(p); else out[p] = fs.readFileSync(p, 'utf8'); } };
  visit(dir);
  return out;
};

test('a second import for the same rater is refused and writes nothing; --force replaces it', () => {
  const f = fixture();
  try {
    judgePanel(f.runDir);
    const r = writeReview(opts(f, { n: 6, seed: 2 }));
    const first = path.join(f.root, 'first.json');
    fs.writeFileSync(first, JSON.stringify(rate(r)));
    importRatings({ ratingsFile: first, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds });
    const second = rate(r);
    for (const it of second.items) it.labels.c1 = 'partial';
    const secondFile = path.join(f.root, 'second.json');
    fs.writeFileSync(secondFile, JSON.stringify(second));
    const before = snapshot(f.runDir);
    assert.throws(() => importRatings({ ratingsFile: secondFile, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds }), /already holds ratings from rater "tester"; pass --force/);
    assert.deepEqual(snapshot(f.runDir), before);
    const out = importRatings({ ratingsFile: secondFile, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds, force: true });
    assert.equal(readJson(out.raterFile).items[0].labels.c1, 'partial');
    assert.deepEqual(out.raters, ['tester']);
    // A result.json this page did not write is kept unless --force, and nothing else is written either.
    fs.writeFileSync(out.savePath, JSON.stringify({ judges: {} }));
    const third = path.join(f.root, 'third.json');
    fs.writeFileSync(third, JSON.stringify({ ...rate(r), rater: 'someone else' }));
    const kept = snapshot(f.runDir);
    assert.throws(() => importRatings({ ratingsFile: third, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds }), /did not write; pass --force/);
    assert.deepEqual(snapshot(f.runDir), kept);
    importRatings({ ratingsFile: third, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds, force: true });
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('a ratings file that rates nothing, or has no rater id, is refused and writes nothing', () => {
  const f = fixture();
  try {
    const r = writeReview(opts(f, { n: 2, seed: 1 }));
    const data = dataOf(fs.readFileSync(r.pagePath, 'utf8'));
    const blank = viewer.ratingsPayload(data, { ...viewer.emptyState(data), rater: 'tester' }, null);
    const blankFile = path.join(f.root, 'blank.json');
    fs.writeFileSync(blankFile, JSON.stringify(blank));
    const before = snapshot(f.runDir);
    assert.throws(() => importRatings({ ratingsFile: blankFile, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds }), /rates no criterion of any output; nothing was written/);
    assert.throws(() => importRatings({ ratingsFile: blankFile, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds, force: true }), /rates no criterion/);
    const nameless = path.join(f.root, 'nameless.json');
    fs.writeFileSync(nameless, JSON.stringify({ ...rate(r), rater: '  ' }));
    assert.throws(() => importRatings({ ratingsFile: nameless, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds }), /no rater id/);
    assert.deepEqual(snapshot(f.runDir), before);
    assert.equal(raterIdOf('Jane Doe!'), 'jane-doe');
    assert.equal(raterIdOf('../x'), 'x');
    assert.equal(raterIdOf(''), null);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('two raters coexist: each is kept and scored alone, and the combined result pools both', () => {
  const f = fixture();
  try {
    judgePanel(f.runDir, { only: ['good'] });
    const r = writeReview(opts(f, { n: 6, seed: 2 }));
    const a = path.join(f.root, 'a.json');
    fs.writeFileSync(a, JSON.stringify(rate(r)));
    importRatings({ ratingsFile: a, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds });
    // The second rater agrees with the "bad" judge on c1.
    const other = rate(r);
    const key = readJson(r.keyPath);
    const rep = new Map(key.groups.flatMap((g) => g.items.map((i) => [i.itemId, i.replicate])));
    for (const it of other.items) it.labels.c1 = rep.get(it.itemId) % 2 ? 'fail' : 'pass';
    const b = path.join(f.root, 'b.json');
    fs.writeFileSync(b, JSON.stringify(other));
    const out = importRatings({ ratingsFile: b, keyFile: r.keyPath, rater: 'second', thresholds: DEFAULTS.thresholds });
    assert.deepEqual(out.raters, ['second', 'tester']);
    assert.ok(fs.existsSync(path.join(r.keyDir, 'raters', 'tester', 'ratings.json')), 'the first rater is still on file');
    assert.equal(out.res.byRater.tester.judges.good.kappa, 1);
    assert.ok(out.res.byRater.second.judges.good.kappa < 0.6);
    assert.equal(out.res.judges.good.nCriteria, 24, 'pooled: each rater adds its own criterion pairs');
    assert.equal(readJson(out.sheetPath).items.length, 12);
    assert.ok(out.res.judges.good.kappa < 1 && out.res.judges.good.kappa > out.res.byRater.second.judges.good.kappa);
    // Per rater kappa beside the pooled one: the lowest judge kappa each, the lowest marked, under the pooled bar flagged.
    const rk = readJson(out.savePath).raterKappa;
    assert.equal(rk.kappaMin, DEFAULTS.thresholds.kappaMin);
    const byId = Object.fromEntries(rk.raters.map((x) => [x.rater, x]));
    assert.equal(byId.second.kappa, out.res.byRater.second.judges.good.kappa);
    assert.deepEqual([byId.second.lowest, byId.second.below], [true, true]);
    assert.equal(byId.tester.lowest, false);
    assert.deepEqual([byId.tester.kappa, byId.tester.below], [1, false]);
    assert.match(formatRaterKappas(rk.raters, rk.kappaMin), /\*\*second -?\d\.\d\d \(lowest, below 0\.6\)\*\*/);
    // The report's calibration row shows the same per-rater figures with the report's own bar.
    const cal = readCalibration({ dir: f.runDir });
    assert.equal(cal.kappa, Math.min(...Object.values(out.res.judges).map((x) => x.kappa)));
    assert.deepEqual(Object.keys(cal.byRater).sort(), ['second', 'tester']);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('each import keeps the pooled result it replaces as result.prev.json', () => {
  const f = fixture();
  try {
    judgePanel(f.runDir, { only: ['good'] });
    const r = writeReview(opts(f, { n: 6, seed: 2 }));
    const a = path.join(f.root, 'a.json');
    fs.writeFileSync(a, JSON.stringify(rate(r)));
    const one = importRatings({ ratingsFile: a, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds });
    assert.equal(one.backupPath, null, 'nothing to keep on the first import');
    const firstBytes = fs.readFileSync(one.savePath, 'utf8');
    const b = path.join(f.root, 'b.json');
    fs.writeFileSync(b, JSON.stringify({ ...rate(r), rater: 'second' }));
    const two = importRatings({ ratingsFile: b, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds });
    assert.equal(two.backupPath, path.join(f.runDir, 'calibration', 'result.prev.json'));
    assert.equal(fs.readFileSync(two.backupPath, 'utf8'), firstBytes);
    assert.deepEqual(readJson(two.savePath).source.raters, ['second', 'tester']);
    assert.ok(raterKappas(readJson(two.savePath).byRater, 0.6).every((x) => x.kappa === 1));
    // A refused import leaves both files alone.
    const prevBytes = fs.readFileSync(two.backupPath, 'utf8');
    assert.throws(() => importRatings({ ratingsFile: b, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds }), /pass --force/);
    assert.equal(fs.readFileSync(two.backupPath, 'utf8'), prevBytes);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('the key is never next to the page: a key directory inside the page directory is refused, and import needs --key', () => {
  const f = fixture();
  try {
    const page = path.join(f.root, 'handover');
    assert.throws(() => writeReview(opts(f, { n: 2, outDir: page, keyOutDir: page })), /is the page directory or inside it/);
    assert.throws(() => writeReview(opts(f, { n: 2, outDir: page, keyOutDir: path.join(page, 'k') })), /is the page directory or inside it/);
    const r = writeReview(opts(f, { n: 2, outDir: page }));
    assert.equal(r.keyDir, path.join(f.root, 'review-key'));
    assert.deepEqual(fs.readdirSync(page), ['review.html']);
    const ratingsFile = path.join(page, 'ratings.json');
    fs.writeFileSync(ratingsFile, JSON.stringify(rate(r)));
    // A key copied beside the page and the ratings is still not picked up.
    fs.copyFileSync(r.keyPath, path.join(page, 'review-key.json'));
    assert.throws(() => importRatings({ ratingsFile, thresholds: DEFAULTS.thresholds }), /--key FILE is required: .*never looked for next to the page/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('the viewer id does not depend on where the run is, and ratings import after the run moves', () => {
  const f = fixture();
  try {
    judgePanel(f.runDir, { only: ['good'] });
    const r = writeReview(opts(f, { n: 6, seed: 2 }));
    const ratings = rate(r);
    // A copy of the run elsewhere makes the same page.
    const copy = path.join(f.root, 'copy');
    fs.cpSync(f.runDir, copy, { recursive: true });
    fs.rmSync(path.join(copy, 'calibration'), { recursive: true, force: true });
    assert.equal(writeReview(opts(f, { runDir: copy, n: 6, seed: 2 })).viewerId, r.viewerId);
    // Moved together with its key (the default layout keeps the key inside the run).
    const moved = path.join(f.root, 'moved', 'run');
    fs.mkdirSync(path.dirname(moved));
    fs.renameSync(f.runDir, moved);
    const ratingsFile = path.join(f.root, 'ratings.json');
    fs.writeFileSync(ratingsFile, JSON.stringify(ratings));
    const out = importRatings({ ratingsFile, keyFile: path.join(moved, 'calibration', 'review-key', 'review-key.json'), thresholds: DEFAULTS.thresholds });
    assert.equal(out.runDir, moved);
    assert.equal(out.savePath, path.join(moved, 'calibration', 'result.json'));
    assert.equal(out.res.judges.good.kappa, 1);
    // The pooled key records the run relative to itself, and calibrate score still finds it there.
    assert.equal(readJson(out.sheetKeyPath).runDir, path.join('..', '..'));
    assert.equal(scoreLabels({ labelsFile: out.sheetPath, thresholds: DEFAULTS.thresholds }).judges.good.kappa, 1);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('a run moved without its key is refused by name, and --run points the import at it', () => {
  const f = fixture();
  try {
    judgePanel(f.runDir, { only: ['good'] });
    const keys = path.join(f.root, 'keys');
    const r = writeReview(opts(f, { n: 6, seed: 2, keyOutDir: keys }));
    const ratingsFile = path.join(f.root, 'ratings.json');
    fs.writeFileSync(ratingsFile, JSON.stringify(rate(r)));
    const moved = path.join(f.root, 'elsewhere');
    fs.renameSync(f.runDir, moved);
    assert.throws(() => importRatings({ ratingsFile, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds }), /is not the run this key was made from .*pass --run DIR/);
    assert.ok(!fs.existsSync(path.join(keys, 'raters')), 'nothing written for the refused import');
    assert.throws(() => importRatings({ ratingsFile, keyFile: r.keyPath, run: f.bench, thresholds: DEFAULTS.thresholds }), /check --run/);
    const out = importRatings({ ratingsFile, keyFile: r.keyPath, run: moved, thresholds: DEFAULTS.thresholds });
    assert.equal(out.savePath, path.join(moved, 'calibration', 'result.json'));
    assert.equal(out.res.judges.good.kappa, 1);
    // From the command line too.
    const env = { PATH: process.env.PATH, HOME: f.root, TMPDIR: process.env.TMPDIR };
    const again = spawnSync(process.execPath, [BENCH_JS, 'cap', 'review-import', '--ratings', ratingsFile, '--key', r.keyPath, '--run', moved, '--force'], { env, encoding: 'utf8' });
    assert.equal(again.status, 0, again.stderr);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('an import that fails while scoring writes nothing, and the retry then imports', () => {
  const f = fixture();
  try {
    judgePanel(f.runDir, { only: ['good'] });
    const good = fs.readFileSync(path.join(f.runDir, 'judgments.json'), 'utf8');
    const r = writeReview(opts(f, { n: 6, seed: 2 }));
    const ratingsFile = path.join(f.root, 'ratings.json');
    fs.writeFileSync(ratingsFile, JSON.stringify(rate(r)));
    fs.writeFileSync(path.join(f.runDir, 'judgments.json'), '{ not json');
    const before = snapshot(f.runDir);
    assert.throws(() => importRatings({ ratingsFile, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds }));
    assert.deepEqual(snapshot(f.runDir), before, 'no rater file, sheet, key or staging directory is left');
    assert.deepEqual(fs.readdirSync(r.keyDir), ['review-key.json']);
    fs.writeFileSync(path.join(f.runDir, 'judgments.json'), good);
    const out = importRatings({ ratingsFile, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds });
    assert.equal(out.res.judges.good.kappa, 1);
    assert.deepEqual(fs.readdirSync(r.keyDir).sort(), ['key.json', 'raters', 'review-key.json', 'sheet.json']);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('the fingerprint is what the rater saw: recheck passes, a changed stream or shown file is refused by item, a copy imports', () => {
  const f = fixture();
  try {
    judgePanel(f.runDir, { only: ['good'] });
    const keys = path.join(f.root, 'keys');
    const r = writeReview(opts(f, { n: 6, seed: 2, keyOutDir: keys }));
    const ratingsFile = path.join(f.root, 'ratings.json');
    fs.writeFileSync(ratingsFile, JSON.stringify(rate(r)));
    const key = readJson(r.keyPath);
    for (const g of key.groups) for (const i of g.items) {
      assert.match(i.seenHash, /^[0-9a-f]{64}$/);
      assert.deepEqual(i.seen, { files: ['a.txt'], deleted: [] }, 'the shown workspace files are recorded');
    }
    const it = key.groups[1].items[0];
    const at = (root) => path.join(root, it.armId, it.taskId, String(it.replicate));
    const fresh = (name) => { const d = path.join(f.root, name); fs.cpSync(f.runDir, d, { recursive: true }); return d; };
    const item = new RegExp(`different output for item ${it.itemId} \\(${it.armId.replace(/\./g, '\\.')}/${it.taskId}/${it.replicate}\\)`);
    // An unchanged copy imports.
    assert.equal(importRatings({ ratingsFile, keyFile: r.keyPath, run: fresh('copy'), thresholds: DEFAULTS.thresholds }).res.judges.good.kappa, 1);
    // A recheck rewrites result.json's current checks and keeps the first ones under checksOriginal: still imports.
    const rechecked = fresh('rechecked');
    for (const g of key.groups) for (const i of g.items) {
      const file = path.join(rechecked, i.armId, i.taskId, String(i.replicate), 'result.json');
      const res = readJson(file);
      fs.writeFileSync(file, JSON.stringify({ ...res, checksOriginal: res.checksOriginal ?? res.checks, checks: [{ type: 'file_exists', path: 'a.txt', passed: false }], checksRevision: 'r2', recheckedAt: 'now' }));
    }
    assert.equal(importRatings({ ratingsFile, keyFile: r.keyPath, run: rechecked, force: true, thresholds: DEFAULTS.thresholds }).res.judges.good.kappa, 1);
    // A changed stream, or an edited shown workspace file, is refused by item and writes nothing.
    const streamed = fresh('streamed');
    fs.appendFileSync(path.join(at(streamed), 'stream.jsonl'), `${JSON.stringify({ type: 'runFinished', data: { status: 'success', finalText: 'another answer' } })}\n`);
    const edited = fresh('edited');
    fs.writeFileSync(path.join(at(edited), 'workspace', 'a.txt'), 'edited after the page was made\n');
    const changedChecks = fresh('changed-checks');
    const cf = path.join(at(changedChecks), 'result.json');
    fs.writeFileSync(cf, JSON.stringify({ ...readJson(cf), checks: [{ type: 'file_exists', path: 'a.txt', passed: false }] }));
    for (const run of [streamed, edited, changedChecks]) {
      const before = snapshot(keys);
      assert.throws(() => importRatings({ ratingsFile, keyFile: r.keyPath, run, force: true, thresholds: DEFAULTS.thresholds }), item);
      assert.deepEqual(snapshot(keys), before, `${path.basename(run)}: nothing written`);
    }
    // seenHash itself: a workspace file the bundle did not show is not part of it.
    fs.writeFileSync(path.join(at(f.runDir), 'workspace', 'unshown.txt'), 'x');
    assert.equal(seenHash(at(f.runDir), it.seen), it.seenHash);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('a page directory holding a key or ratings from an earlier review is refused, and nothing is written', () => {
  const f = fixture();
  try {
    const page = path.join(f.runDir, 'calibration', 'review');
    for (const name of ['review-key.json', 'key.json', 'sheet.json', 'raters', '.import-abc123', 'sheet.json.tmp-4242', 'review-key.json.tmp-7']) {
      fs.rmSync(page, { recursive: true, force: true });
      fs.mkdirSync(page, { recursive: true });
      if (name === 'raters' || name.startsWith('.import-')) fs.mkdirSync(path.join(page, name)); else fs.writeFileSync(path.join(page, name), '{}');
      assert.throws(() => writeReview(opts(f, { n: 2 })), new RegExp(`holds ${name.replace('.', '\\.')} from an earlier review.*must not be handed to a rater`));
      assert.deepEqual(fs.readdirSync(page), [name], 'no page was written beside it');
      assert.ok(!fs.existsSync(path.join(f.runDir, 'calibration', 'review-key')));
      assert.throws(() => writeReview(opts(f, { n: 2, force: true })), /from an earlier review/);
    }
    // The rater's own files are not key artifacts, even with "key" in the name.
    for (const name of ['ratings-abc.json', 'ratings-monkey.json', 'monkey-notes.txt', 'keyboard.txt']) {
      fs.rmSync(page, { recursive: true, force: true });
      fs.rmSync(path.join(f.runDir, 'calibration', 'review-key'), { recursive: true, force: true });
      fs.mkdirSync(page, { recursive: true });
      fs.writeFileSync(path.join(page, name), '{}');
      writeReview(opts(f, { n: 2 }));
      assert.deepEqual(fs.readdirSync(page).sort(), [name, 'review.html'].sort(), name);
    }
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('an old, missing or unknown key version says to regenerate the page and that old ratings will not import', () => {
  const f = fixture();
  try {
    const r = writeReview(opts(f, { n: 2, seed: 1 }));
    const ratingsFile = path.join(f.root, 'ratings.json');
    fs.writeFileSync(ratingsFile, JSON.stringify(rate(r)));
    const good = readJson(r.keyPath);
    for (const [v, shown] of [[1, '1'], [undefined, 'missing'], [3, '3']]) {
      const k = { ...good, schemaVersion: v };
      if (v === undefined) delete k.schemaVersion;
      const file = path.join(f.root, `key-${shown}.json`);
      fs.writeFileSync(file, JSON.stringify(k));
      assert.throws(() => importRatings({ ratingsFile, keyFile: file, thresholds: DEFAULTS.thresholds }),
        new RegExp(`schemaVersion ${shown}; this version reads 2\\)\\. Regenerate it with \`cap review --run DIR\`; ratings made on the old page will not import`));
    }
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('ids such as __proto__, constructor and toString work as rater and criterion ids', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const ids = ['__proto__', 'constructor', 'toString'];
    const t = JSON.parse(fs.readFileSync(path.join(bench, 'tasks', 't1.json'), 'utf8'));
    t.rubric = ids.map((id) => ({ id, criterion: `criterion ${id}`, weight: 1 }));
    fs.writeFileSync(path.join(bench, 'tasks', 't1.json'), JSON.stringify(t));
    const specs = [];
    for (const arm of ['vanilla', 'v1.2.0']) for (let rep = 1; rep <= 3; rep++) specs.push({ arm, rep, files: { 'a.txt': `${MARK[arm]}-${rep}\n` } });
    const runDir = makeRun(path.join(root, 'run'), bench, specs);
    const truth = (rep) => (rep % 2 ? 'pass' : 'fail');
    // Built from entries, so "__proto__" is an own key here too.
    const crit = (rep) => Object.fromEntries(ids.map((id, i) => [id, i === 0 ? truth(rep) : 'pass']));
    const rubric = [];
    for (const arm of ['vanilla', 'v1.2.0']) for (let rep = 1; rep <= 3; rep++) rubric.push({ judge: 'good', arm, rep, criteria: crit(rep), score: 1 });
    writeJudgments(runDir, { judges: ['good'], rubric });
    const r = writeReview({ runDir, benchDir: bench, n: 6, seed: 2, limits: DEFAULTS.limits, redactions: compileRedactions(DEFAULT_REDACTIONS), env: {} });
    const key = readJson(r.keyPath);
    const data = dataOf(fs.readFileSync(r.pagePath, 'utf8'));
    const rep = new Map(key.groups.flatMap((g) => g.items.map((i) => [i.itemId, i.replicate])));
    const ratingsFor = (name) => {
      const st = viewer.emptyState(data);
      st.rater = name;
      for (const id of Object.keys(st.items)) for (const [i, cid] of ids.entries()) st.items[id].labels[cid] = i === 0 ? truth(rep.get(id)) : 'pass';
      return JSON.parse(JSON.stringify(viewer.ratingsPayload(data, st, null)));
    };
    const a = ratingsFor('__proto__');
    assert.deepEqual(Object.keys(a.items[0].labels), ids, 'the page exports every criterion, __proto__ included');
    // The page loads its own export back.
    const back = viewer.emptyState(data);
    viewer.mergeRatings(data, back, a);
    assert.deepEqual(Object.keys(back.items[a.items[0].itemId].labels).filter((k) => back.items[a.items[0].itemId].labels[k] !== null), ids);
    for (const name of ['__proto__', 'constructor', 'toString']) {
      const file = path.join(root, `${name}.json`);
      fs.writeFileSync(file, JSON.stringify(ratingsFor(name)));
      importRatings({ ratingsFile: file, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds });
    }
    const res = readJson(path.join(runDir, 'calibration', 'result.json'));
    assert.deepEqual(res.source.raters, ['__proto__', 'constructor', 'tostring']);
    assert.deepEqual(Object.keys(res.byRater).sort(), ['__proto__', 'constructor', 'tostring']);
    assert.deepEqual(res.raterKappa.raters.map((x) => [x.rater, x.kappa]), [['__proto__', 1], ['constructor', 1], ['tostring', 1]]);
    assert.equal(res.itemsLabeled, 18);
    assert.equal(res.judges.good.nCriteria, 54);
    const sheet = readJson(path.join(r.keyDir, 'sheet.json'));
    assert.ok(sheet.items.every((it) => Object.keys(it.labels).length === 3));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a failed import removes its staging directory; one left by a killed run is cleared by the next import', () => {
  const f = fixture();
  try {
    judgePanel(f.runDir, { only: ['good'] });
    const r = writeReview(opts(f, { n: 6, seed: 2 }));
    const ratingsFile = path.join(f.root, 'ratings.json');
    fs.writeFileSync(ratingsFile, JSON.stringify(rate(r)));
    // An error while staging: the directory goes with the import, and nothing else is written.
    let seen = null;
    assert.throws(() => importRatings({ ratingsFile, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds, onStaged: (d) => { seen = d; throw new Error('boom'); } }), /boom/);
    assert.ok(seen && !fs.existsSync(seen));
    assert.deepEqual(fs.readdirSync(r.keyDir), ['review-key.json']);
    // A real SIGINT while staging kills the process (nothing handles it), so the staging directory stays behind.
    const script = `
      const { importRatings } = require(${JSON.stringify(path.join(__dirname, '..', '..', 'cap', 'review.js'))});
      const { DEFAULTS } = require(${JSON.stringify(path.join(__dirname, '..', '..', 'judge', 'config.js'))});
      importRatings({ ratingsFile: ${JSON.stringify(ratingsFile)}, keyFile: ${JSON.stringify(r.keyPath)}, thresholds: DEFAULTS.thresholds,
        onStaged: (dir) => { require('node:fs').writeSync(1, dir + '\\n'); process.kill(process.pid, 'SIGINT'); const t = Date.now(); while (Date.now() - t < 5000); } });
      process.stdout.write('not interrupted\\n');`;
    const c = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 20000 });
    assert.equal(c.signal, 'SIGINT', `${c.status} ${c.stderr}`);
    assert.doesNotMatch(c.stdout, /not interrupted/);
    const stage = c.stdout.split('\n')[0];
    assert.match(path.basename(stage), /^\.import-/);
    assert.ok(fs.existsSync(stage), 'the killed run left its staging directory');
    assert.ok(!fs.existsSync(path.join(r.keyDir, 'raters')), 'and no rater file');
    // The next import clears it and imports.
    const out = importRatings({ ratingsFile, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds });
    assert.ok(!fs.existsSync(stage));
    assert.deepEqual(fs.readdirSync(r.keyDir).filter((n) => n.startsWith('.import-')), []);
    assert.equal(out.res.judges.good.kappa, 1);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('a late failure writing the backup leaves the new rater off file, so the retry imports', () => {
  const f = fixture();
  try {
    judgePanel(f.runDir, { only: ['good'] });
    const r = writeReview(opts(f, { n: 6, seed: 2 }));
    const a = path.join(f.root, 'a.json');
    fs.writeFileSync(a, JSON.stringify(rate(r)));
    importRatings({ ratingsFile: a, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds });
    const result = path.join(f.runDir, 'calibration', 'result.json');
    const firstResult = fs.readFileSync(result, 'utf8');
    // result.prev.json as a directory makes the backup copy fail after scoring.
    fs.mkdirSync(path.join(f.runDir, 'calibration', 'result.prev.json'));
    const b = path.join(f.root, 'b.json');
    fs.writeFileSync(b, JSON.stringify({ ...rate(r), rater: 'second' }));
    assert.throws(() => importRatings({ ratingsFile: b, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds }));
    assert.ok(!fs.existsSync(path.join(r.keyDir, 'raters', 'second')), 'no file for the new rater');
    assert.equal(fs.readFileSync(result, 'utf8'), firstResult, 'the pooled result is unchanged');
    fs.rmdirSync(path.join(f.runDir, 'calibration', 'result.prev.json'));
    const out = importRatings({ ratingsFile: b, keyFile: r.keyPath, thresholds: DEFAULTS.thresholds });
    assert.deepEqual(out.raters, ['second', 'tester']);
    assert.equal(fs.readFileSync(out.backupPath, 'utf8'), firstResult);
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
    assert.ok(!fs.existsSync(path.join(r.keyDir, 'sheet.json')));
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
  assert.deepEqual(JSON.parse(JSON.stringify(out.items[0])), { itemId: 'g001-A', labels: { c1: 'pass', c2: 'partial' }, evidence: { c1: 'q' }, notes: '' });
  const t = viewer.emptyState(data);
  const m = viewer.mergeRatings(data, t, { ...out, items: [...out.items, { itemId: 'g009-A', labels: {} }] });
  assert.deepEqual(m, { applied: 2, skipped: 1 });
  assert.equal(t.items['g001-A'].labels.c1, 'pass');
  assert.throws(() => viewer.mergeRatings(data, t, { ...out, viewerId: 'v2' }), /viewer v2/);
  assert.throws(() => viewer.mergeRatings(data, t, {}), /not a ratings file/);
  // Only own keys: inherited names in a loaded file are skipped, not written through.
  const u = viewer.emptyState(data);
  const odd = { kind: 'bench-review-ratings', viewerId: 'v1', items: [{ itemId: '__proto__', labels: { c1: 'pass' } }, { itemId: 'toString' }, { itemId: 'g001-A', labels: { toString: 'pass', constructor: 'fail', c1: 'fail' } }] };
  assert.deepEqual(viewer.mergeRatings(data, u, odd), { applied: 1, skipped: 2 });
  assert.deepEqual({ ...u.items['g001-A'].labels }, { c1: 'fail', c2: null });
  assert.equal(({}).c1, undefined);
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
    judgePanel(f.runDir, { only: ['good'] });
    const env = { PATH: process.env.PATH, HOME: f.root, TMPDIR: process.env.TMPDIR };
    const cli = (args) => spawnSync(process.execPath, [BENCH_JS, ...args], { env, encoding: 'utf8' });
    const a = cli(['cap', 'review', '--run', f.runDir, '--bench-dir', f.bench, '--n', '6', '--seed', '2']);
    assert.equal(a.status, 0, a.stderr);
    assert.match(a.stdout, /3 task\(s\), 6 output\(s\)/);
    assert.match(a.stdout, /in its own directory because it names the arm behind each letter: give the rater \S+review only/);
    const keyPath = path.join(f.runDir, 'calibration', 'review-key', 'review-key.json');
    const ratingsFile = path.join(f.root, 'ratings.json');
    fs.writeFileSync(ratingsFile, JSON.stringify(rate({ keyPath, pagePath: path.join(f.runDir, 'calibration', 'review', 'review.html') })));
    const b = cli(['cap', 'review-import', '--ratings', ratingsFile, '--key', keyPath]);
    assert.equal(b.status, 0, b.stderr);
    assert.match(b.stdout, /good\s+PASS/);
    assert.match(b.stdout, /Evidence quotes: none given/);
    assert.match(b.stdout, /rater "tester" kept in/);
    assert.match(b.stdout, /Per rater \(lowest judge kappa each, bar 0\.6\): tester 1\.00/);
    const again = cli(['cap', 'review-import', '--ratings', ratingsFile, '--key', keyPath]);
    assert.equal(again.status, 2);
    assert.match(again.stderr, /pass --force/);
    const nokey = cli(['cap', 'review-import', '--ratings', ratingsFile]);
    assert.equal(nokey.status, 2);
    assert.match(nokey.stderr, /--key FILE is required: .*never looked for next to the page/);
    const bad = cli(['cap', 'review-import', '--ratings', path.join(f.root, 'missing.json'), '--key', keyPath]);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /cannot read/);
    const typo = cli(['cap', 'review', '--run', f.runDir, '--sample']);
    assert.equal(typo.status, 2);
    assert.match(typo.stderr, /unknown flag --sample\b/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('a run whose scrub failed or whose output files were replaced is neither sampled nor shown as a peer', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const specs = [];
    for (const arm of ['vanilla', 'v1.2.0']) {
      for (let rep = 1; rep <= 2; rep++) {
        const flags = arm === 'vanilla' && rep === 1 ? ['credsUnscrubbed'] : arm === 'v1.2.0' && rep === 2 ? ['stdioTampered'] : [];
        specs.push({ arm, rep, flags, finalText: `answer ${arm} r${rep} PEERMARK_${arm === 'vanilla' ? 'a' : 'b'}${rep}` });
      }
    }
    const runDir = makeRun(path.join(root, 'run'), bench, specs);
    const f = { root, bench, runDir };
    const r = writeReview(opts(f, { n: 4, seed: 1 }));
    const key = readJson(r.keyPath);
    const runs = key.groups.flatMap((g) => g.items).map((i) => `${i.armId}/${i.replicate}`).sort();
    assert.deepEqual(runs, ['v1.2.0/1', 'vanilla/2']);
    const html = fs.readFileSync(r.pagePath, 'utf8');
    assert.doesNotMatch(html, /PEERMARK_a1|PEERMARK_b2/);
    const all = writeReview(opts(f, { n: 4, seed: 1, sampleOnly: true, outDir: path.join(root, 'o2'), keyOutDir: path.join(root, 'k2') }));
    assert.deepEqual(readJson(all.keyPath).groups.flatMap((g) => g.items).map((i) => `${i.armId}/${i.replicate}`).sort(), ['v1.2.0/1', 'vanilla/2']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('review fails with a clear message when every run is excluded', () => {
  const root = tmp();
  try {
    const bench = makeBench(path.join(root, 'bench'));
    const runDir = makeRun(path.join(root, 'run'), bench, [{ arm: 'vanilla', rep: 1, flags: ['credsUnscrubbed'] }]);
    assert.throws(() => writeReview(opts({ root, bench, runDir }, { n: 2, seed: 1 })), /budget-skipped or not judgeable/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
