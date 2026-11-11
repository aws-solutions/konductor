// SPDX-License-Identifier: Apache-2.0
// Tests for the secret sweep (lib/sweep.js) on throw-away run folders. Secrets are built at run time.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  sweepRun,
  securityNote,
  warningNote,
  QUARANTINE_MARK,
} = require('../../../scripts/bench/lib/sweep');
const {
  newCanary,
  KNOWN_EXAMPLES,
} = require('../../../scripts/bench/lib/redact');
const { createLayout } = require('../../../scripts/bench/lib/layout');
const {
  SAFE_SEGMENT,
  SEAT_NAME,
  BATCH_NAME,
} = require('../../../scripts/bench/lib/names');
const helpers = require('./helpers');

const AKID = ['AK', 'IA'].join('') + 'Q'.repeat(16);
const HANDED = 'handed-out-value-1234';
const PROSE =
  'To run it, set AWS_SESSION_TOKEN and AWS_SECRET_ACCESS_KEY, then use aws_secret_access_key = os.environ["K"].';

/** Writes { 'a/b.txt': text } under dir. */
const writeTree = (dir, files) => {
  for (const [relativePath, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, relativePath)), {
      recursive: true,
    });
    fs.writeFileSync(path.join(dir, relativePath), text);
  }
};

test('a run folder whose text only names variables is clean, however deep the files are', () => {
  helpers.withTmp((dir) => {
    writeTree(dir, {
      'answers/s/b1/t1.with.json': JSON.stringify({ text: PROSE }),
      'logs/deep/er/raw.log': 'AWS_SESSION_TOKEN=\nBearer token\n',
      'report.md': '# ok',
    });
    assert.deepEqual(sweepRun(dir), {
      clean: true,
      missing: false,
      scanned: 3,
      hits: [],
      flagged: [],
      examples: [],
      skipped: [],
      skippedReasons: [],
    });
    assert.equal(securityNote(sweepRun(dir)), '');
  });
});

test('only a value the run knows is a hit: a handed-out value and the canary; a key-shaped string is flagged, and the result never shows the text', () => {
  helpers.withTmp((dir) => {
    const canary = newCanary();
    writeTree(dir, {
      'answers/t1.json': PROSE,
      'answers/t2.json': `the key is ${AKID}`,
      'logs/raw.log': `env: ${HANDED}`,
      'logs/other.log': `x ${canary} y`,
    });
    const sweepResult = sweepRun(dir, { literals: [HANDED, canary] });
    assert.deepEqual(sweepResult.hits, [
      { file: 'logs/other.log', found: { canary: 1, literal: 1 } },
      { file: 'logs/raw.log', found: { literal: 1 } },
    ]);
    assert.deepEqual(sweepResult.flagged, [
      { file: 'answers/t2.json', found: { aws_key_id: 1 } },
    ]);
    assert.deepEqual([sweepResult.clean, sweepResult.scanned], [false, 4]);
    for (const text of [
      JSON.stringify(sweepResult),
      securityNote(sweepResult),
      warningNote(sweepResult),
    ])
      assert.ok(
        ![AKID, HANDED, canary].some((secret) => text.includes(secret)),
      );
    assert.match(
      securityNote(sweepResult),
      /^SECURITY STOP: .*logs\/other\.log \(canary x1, literal x1\); logs\/raw\.log \(literal x1\)\. The matching text is not shown\.$/,
    );
    assert.doesNotMatch(
      securityNote(sweepResult),
      /answers\/t2/,
      'a flagged file is not part of the stop note',
    );
    assert.equal(
      warningNote(sweepResult),
      'SWEEP WARNING: secret-shaped text found, already redacted in stored text; the run continues: answers/t2.json (aws_key_id x1).',
    );
  });
});

// Harmless secret-shaped text must not stop a run. Every one of these is in the flag or example tier.
const JWT_HEADER =
  'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl';
const [AWS_EXAMPLE_ID, AWS_EXAMPLE_SECRET] = KNOWN_EXAMPLES;

test('the AWS documentation example key and secret are example values: no stop, no flag', () => {
  helpers.withTmp((dir) => {
    writeTree(dir, {
      'answers/t1.md': `Use AWS_ACCESS_KEY_ID=${AWS_EXAMPLE_ID} and\nAWS_SECRET_ACCESS_KEY=${AWS_EXAMPLE_SECRET}\nfor the demo.`,
    });
    const sweepResult = sweepRun(dir, { literals: [HANDED] });
    assert.deepEqual(
      [sweepResult.clean, sweepResult.hits, sweepResult.flagged],
      [true, [], []],
    );
    assert.deepEqual(sweepResult.examples, [
      { file: 'answers/t1.md', found: { aws_key_id: 1, secret_key: 1 } },
    ]);
    assert.equal(securityNote(sweepResult), '');
    assert.match(
      warningNote(sweepResult),
      /\(aws_key_id x1 example value, secret_key x1 example value\)/,
    );
    assert.doesNotMatch(warningNote(sweepResult), new RegExp(AWS_EXAMPLE_ID));
  });
});

test('a sample JWT bearer header is flagged, not a stop', () => {
  helpers.withTmp((dir) => {
    writeTree(dir, {
      'answers/t1.md': `Send the header:\n\n    ${JWT_HEADER}\n\nUse Bearer token-based-authentication for the API.`,
    });
    const sweepResult = sweepRun(dir, { quarantine: true });
    assert.deepEqual(
      [sweepResult.clean, sweepResult.hits, sweepResult.examples],
      [true, [], []],
    );
    assert.deepEqual(sweepResult.flagged, [
      { file: 'answers/t1.md', found: { bearer: 2 } },
    ]);
    assert.deepEqual(
      fs.readdirSync(path.join(dir, 'answers')),
      ['t1.md'],
      'a flagged file is not quarantined',
    );
  });
});

test('a real-shaped key built at run time is flagged, not a stop; a lookalike of an example (extra characters) is a real shape', () => {
  helpers.withTmp((dir) => {
    writeTree(dir, {
      'a.txt': `id ${AKID}`,
      'b.txt': `AWS_SECRET_ACCESS_KEY=${'Zk'.repeat(20)}`,
      'c.txt': `${AWS_EXAMPLE_ID}`,
      'd.txt': `AWS_SECRET_ACCESS_KEY=${AWS_EXAMPLE_SECRET}AAAA`,
    });
    const sweepResult = sweepRun(dir, { literals: [HANDED] });
    assert.deepEqual(sweepResult.hits, []);
    assert.equal(sweepResult.clean, true);
    assert.deepEqual(sweepResult.flagged, [
      { file: 'a.txt', found: { aws_key_id: 1 } },
      { file: 'b.txt', found: { secret_key: 1 } },
      { file: 'd.txt', found: { secret_key: 1 } },
    ]);
    assert.deepEqual(sweepResult.examples, [
      { file: 'c.txt', found: { aws_key_id: 1 } },
    ]);
  });
});

test('the canary is a stop, by its prefix and when passed as a literal; a handed-out credential value is a stop, even if it is key-shaped', () => {
  helpers.withTmp((dir) => {
    const canary = newCanary();
    const handed = ['AS', 'IA'].join('') + 'R'.repeat(16); // a key id the run gave the child
    writeTree(dir, {
      'one.log': `leak ${canary}`,
      'two.log': `leak ${handed}`,
      'three.log': `a different key ${['AK', 'IA'].join('') + 'M'.repeat(16)}`,
    });
    const sweepResult = sweepRun(dir, { literals: [handed] });
    assert.deepEqual(sweepResult.hits, [
      { file: 'one.log', found: { canary: 1 } },
      { file: 'two.log', found: { literal: 1 } },
    ]);
    assert.deepEqual(
      sweepResult.flagged.map((entry) => entry.file),
      ['three.log', 'two.log'].sort(),
      'the handed-out key id is also key-shaped, so it is flagged too',
    );
    assert.equal(sweepResult.clean, false);
    assert.match(
      securityNote(sweepResult),
      /^SECURITY STOP: .*or the canary\) or could not scan: one\.log \(canary x1\); two\.log \(literal x1\)\. The matching text is not shown\.$/,
    );
  });
});

test('quarantine renames the file with the time, keeps its content, and a later sweep skips it', () => {
  helpers.withTmp((dir) => {
    writeTree(dir, {
      'answers/t2.json': `the key is ${HANDED}`,
      'answers/t1.json': 'fine',
    });
    const sweepResult = sweepRun(dir, {
      literals: [HANDED],
      quarantine: true,
      now: () => Date.parse('2026-01-15T10:00:00Z'),
    });
    const name = 'answers/t2.json~quarantined-2026-01-15T10-00-00-000Z';
    assert.deepEqual(sweepResult.hits, [
      { file: 'answers/t2.json', found: { literal: 1 }, quarantined: name },
    ]);
    assert.match(securityNote(sweepResult), /\(literal x1\), quarantined/);
    assert.deepEqual(
      [
        fs.existsSync(path.join(dir, 'answers/t2.json')),
        fs.readFileSync(path.join(dir, name), 'utf8'),
      ],
      [false, `the key is ${HANDED}`],
    );
    assert.deepEqual(sweepRun(dir, { literals: [HANDED] }), {
      clean: true,
      missing: false,
      scanned: 1,
      hits: [],
      flagged: [],
      examples: [],
      skipped: [],
      skippedReasons: [],
    });
    assert.equal(
      sweepRun(dir, { literals: [HANDED], quarantine: false }).clean,
      true,
    );
  });
});

// A task id may hold ".quarantined-1" (names.js), so the harness itself can write such a file name. The sweep must
// still read it: its mark is a character no task id, seat, batch, skill or run id may hold.
test('an answer file of a task id like t.quarantined-1 is scanned and flagged, not mistaken for a quarantined file', () => {
  helpers.withTmp((base) => {
    const layout = createLayout({ root: base, runId: 'r1' });
    const taskId = 't.quarantined-1';
    assert.ok(SAFE_SEGMENT.test(taskId), 'a valid task id');
    const answer = layout.answerFile('s', 'b1', taskId, 'with');
    fs.mkdirSync(path.dirname(answer), { recursive: true });
    fs.writeFileSync(answer, JSON.stringify({ text: `${AKID} ${HANDED}` }));
    const relativeAnswer = path.relative(layout.runDir, answer);
    const sweepResult = sweepRun(layout.runDir, { literals: [HANDED] });
    assert.deepEqual(
      [
        sweepResult.clean,
        sweepResult.scanned,
        sweepResult.hits,
        sweepResult.flagged,
      ],
      [
        false,
        1,
        [{ file: relativeAnswer, found: { literal: 1 } }],
        [{ file: relativeAnswer, found: { aws_key_id: 1 } }],
      ],
    );
    // Quarantined, the file gets the real mark and is skipped by the next sweep.
    const quarantined = sweepRun(layout.runDir, {
      literals: [HANDED],
      quarantine: true,
      now: () => Date.parse('2026-01-15T10:00:00Z'),
    });
    assert.equal(
      quarantined.hits[0].quarantined,
      `${relativeAnswer}~quarantined-2026-01-15T10-00-00-000Z`,
    );
    assert.equal(sweepRun(layout.runDir, { literals: [HANDED] }).scanned, 0);
  });
});

test('only the exact quarantine form is skipped: a name that merely looks like it is scanned', () => {
  helpers.withTmp((dir) => {
    const secretText = `x ${HANDED}`;
    const lookalikes = [
      'a.json.quarantined-2026-01-15T10-00-00-000Z',
      'b.json~quarantined-1',
      'c.json~quarantined-2026-01-15T10-00-00-000Z.txt',
      'd.json~quarantined-',
      'e~quarantined-2026-01-15T10-00-00-000Z/f.json',
    ];
    for (const name of lookalikes) writeTree(dir, { [name]: secretText });
    writeTree(dir, {
      'g.json~quarantined-2026-01-15T10-00-00-000Z': secretText,
    });
    const sweepResult = sweepRun(dir, { literals: [HANDED] });
    assert.deepEqual(
      sweepResult.hits.map((hit) => hit.file).sort(),
      lookalikes.sort(),
    );
    assert.equal(sweepResult.scanned, lookalikes.length);
  });
});

test('the quarantine mark holds a character that no task id, seat, batch, skill or run id may hold', () => {
  const nameRules = [SAFE_SEGMENT, SEAT_NAME, BATCH_NAME];
  for (const rule of nameRules)
    for (const name of ['t1', `t1${QUARANTINE_MARK}2026`, QUARANTINE_MARK])
      assert.equal(
        rule.test(name),
        name === 't1',
        `${rule} must refuse ${JSON.stringify(name)}`,
      );
  // The mark is not a valid file-name part of anything the layout builds from those names.
  const layout = createLayout({ root: path.join(path.sep, 'work', 'repo') });
  assert.throws(() =>
    layout.answerFile('s', 'b1', `t1${QUARANTINE_MARK}2026`, 'with'),
  );
});

test('a file over the size cap is not read and the sweep is not clean; a file of exactly the cap is read', () => {
  helpers.withTmp((base) => {
    const dir = path.join(base, 'run');
    writeTree(dir, { 'big.log': 'x'.repeat(50), 'small.log': 'ok' });
    const sweepResult = sweepRun(dir, { maxBytes: 10 });
    assert.deepEqual(
      [
        sweepResult.clean,
        sweepResult.scanned,
        sweepResult.skipped,
        sweepResult.hits,
      ],
      [false, 1, ['big.log'], []],
    );
    assert.match(securityNote(sweepResult), /big\.log \(too large to scan\)/);
    writeTree(dir, { 'big.log': 'x'.repeat(10) });
    assert.deepEqual(
      [
        sweepRun(dir, { maxBytes: 10 }).clean,
        sweepRun(dir, { maxBytes: 10 }).scanned,
      ],
      [true, 2],
    );
  });
});

// A wrong path, or a run folder that was never made, must not read as a clean sweep of a run that handed out credentials.
test('a run folder that does not exist is not clean, and the security note says so', () => {
  const sweepResult = sweepRun(path.join(helpers.FIXTURE_DIR, 'nowhere'));
  assert.deepEqual(sweepResult, {
    clean: false,
    missing: true,
    scanned: 0,
    hits: [],
    flagged: [],
    examples: [],
    skipped: [],
    skippedReasons: [],
  });
  assert.match(
    securityNote(sweepResult),
    /the run folder \(it does not exist\)/,
  );
});

test('a short literal is refused before anything is read, also for a folder with no file', () => {
  helpers.withTmp((dir) => {
    assert.throws(() => sweepRun(dir, { literals: ['short'] }), TypeError);
    assert.throws(
      () => sweepRun(path.join(dir, 'nowhere'), { literals: ['short'] }),
      TypeError,
    );
  });
});

// A link could point at any file, so it is never followed. It must not read as "scanned, nothing found".
test('a symbolic link to a file is listed as skipped, so the sweep is not clean, and the file it points at is not read', () => {
  helpers.withTmp((base) => {
    const dir = path.join(base, 'run');
    writeTree(dir, { 'small.log': 'ok' });
    fs.writeFileSync(path.join(base, 'outside.txt'), HANDED);
    fs.symlinkSync(path.join(base, 'outside.txt'), path.join(dir, 'link.txt'));
    const sweepResult = sweepRun(dir, { literals: [HANDED] });
    assert.deepEqual(
      [
        sweepResult.clean,
        sweepResult.scanned,
        sweepResult.skipped,
        sweepResult.hits,
        sweepResult.skippedReasons,
      ],
      [
        false,
        1,
        ['link.txt'],
        [],
        [{ file: 'link.txt', reason: 'a symbolic link, not followed' }],
      ],
    );
    assert.match(
      securityNote(sweepResult),
      /link\.txt \(a symbolic link, not followed\)/,
    );
  });
  // A link that points nowhere, and a link in a folder below the top, are skipped the same way.
  helpers.withTmp((base) => {
    const dir = path.join(base, 'run');
    fs.mkdirSync(path.join(dir, 'answers'), { recursive: true });
    fs.symlinkSync(
      path.join(base, 'gone'),
      path.join(dir, 'answers', 'dangling'),
    );
    const sweepResult = sweepRun(dir);
    assert.deepEqual(
      [sweepResult.clean, sweepResult.scanned, sweepResult.skipped],
      [false, 0, [path.join('answers', 'dangling')]],
    );
  });
});

test('a symbolic link to a folder is never walked: it is listed as skipped, nothing behind it is read, and the sweep is not clean', (t) => {
  helpers.withTmp((base) => {
    const dir = path.join(base, 'run');
    writeTree(dir, { 'small.log': 'ok', 'answers/s/ok.json': 'fine' });
    writeTree(base, {
      'outside/deep/secret.txt': `key ${HANDED}`,
      'outside/note.txt': `id ${AKID}`,
    });
    fs.symlinkSync(path.join(base, 'outside'), path.join(dir, 'linked'), 'dir');
    fs.symlinkSync(
      path.join(base, 'outside'),
      path.join(dir, 'answers', 's', 'inner'),
      'dir',
    );
    // A link back to the run folder itself would be walked 20 levels deep if it were followed.
    fs.symlinkSync(dir, path.join(dir, 'loop'), 'dir');
    const reads = [];
    const realRead = fs.readFileSync;
    const readMock = t.mock.method(fs, 'readFileSync', (file, ...rest) => {
      reads.push(String(file));
      return realRead.call(fs, file, ...rest);
    });
    const sweepResult = sweepRun(dir, { literals: [HANDED] });
    readMock.mock.restore();
    assert.deepEqual(reads.sort(), [
      path.join(dir, 'answers', 's', 'ok.json'),
      path.join(dir, 'small.log'),
    ]);
    const linkReason = 'a symbolic link, not followed';
    assert.deepEqual(sweepResult, {
      clean: false,
      missing: false,
      scanned: 2,
      hits: [],
      flagged: [],
      examples: [],
      skipped: ['answers/s/inner', 'linked', 'loop'].map((name) =>
        path.join(...name.split('/')),
      ),
      skippedReasons: ['answers/s/inner', 'linked', 'loop'].map((name) => ({
        file: path.join(...name.split('/')),
        reason: linkReason,
      })),
    });
    assert.match(securityNote(sweepResult), /linked \(a symbolic link, not/);
  });
});

test('a folder that disappears while the sweep lists it is skipped as removed, not a crash', (t) => {
  helpers.withTmp((dir) => {
    writeTree(dir, { 'a.log': 'ok' });
    fs.mkdirSync(path.join(dir, 'sub'));
    const realReaddir = fs.readdirSync;
    // The folder is removed by something else just before it is listed.
    const readdirMock = t.mock.method(fs, 'readdirSync', (target, ...rest) => {
      if (String(target).endsWith('sub')) fs.rmdirSync(target);
      return realReaddir.call(fs, target, ...rest);
    });
    const sweepResult = sweepRun(dir);
    readdirMock.mock.restore();
    assert.deepEqual(
      [sweepResult.clean, sweepResult.scanned, sweepResult.skipped],
      [false, 1, ['sub']],
    );
    assert.match(
      securityNote(sweepResult),
      /sub \(removed while the sweep ran\)/,
    );
  });
});

test('a file that disappears between listing and reading is skipped, not a crash', (t) => {
  helpers.withTmp((dir) => {
    writeTree(dir, { 'a.log': 'ok', 'b.log': 'ok' });
    const realLstat = fs.lstatSync;
    // b.log is removed by something else after the folder was listed.
    const lstatMock = t.mock.method(fs, 'lstatSync', (file, ...rest) => {
      if (String(file).endsWith('b.log'))
        throw Object.assign(new Error('ENOENT: no such file'), {
          code: 'ENOENT',
        });
      return realLstat.call(fs, file, ...rest);
    });
    const sweepResult = sweepRun(dir);
    lstatMock.mock.restore();
    assert.deepEqual(
      [sweepResult.clean, sweepResult.scanned, sweepResult.skipped],
      [false, 1, ['b.log']],
    );
    assert.match(
      securityNote(sweepResult),
      /b\.log \(removed while the sweep ran\)/,
    );
  });
  // Any other failure to look at a file is not hidden.
  helpers.withTmp((dir) => {
    writeTree(dir, { 'a.log': 'ok' });
    fs.chmodSync(path.join(dir, 'a.log'), 0o000);
    try {
      if (process.getuid && process.getuid() !== 0)
        assert.throws(() => sweepRun(dir), { code: 'EACCES' });
    } finally {
      fs.chmodSync(path.join(dir, 'a.log'), 0o644);
    }
  });
});
