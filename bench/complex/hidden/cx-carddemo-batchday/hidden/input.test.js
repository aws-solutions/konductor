// SPDX-License-Identifier: Apache-2.0
'use strict';

// Bad input, output directories, exit codes and usage errors (M2, M3 and INTERFACE.md), both jobs.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const cd = require('./lib/cd.js');

const { account, xref, catbal, disc, tran, lines, splice, run, postInputs, interestInputs, assertRefused } = cd;

const one = (o = {}) => postInputs({ trans: [tran()], ...o });

/** `inputs` with `name` replaced by `text`. */
const withFile = (inputs, name, text) => ({ ...inputs, [name]: text });

test('M3: a bad sign character stops the run, writes nothing and names the file and line', () => {
  const bad = splice(tran({ id: '0000000000000002' }), 132, '0000000100Z');
  run('post', withFile(one(), 'dailytran.txt', lines([tran(), bad])), (r) => {
    assertRefused(assert, r);
    assert.match(r.stderr, /dailytran\.txt line 2\b/);
  });
});

test('M3: a non-digit in a digit field of the account file stops the run and names the line', () => {
  const broken = account({ id: '0000000000X' });
  run('post', withFile(one(), 'acctdata.txt', lines([account({ id: '00000000002' }), broken])), (r) => {
    assertRefused(assert, r);
    assert.match(r.stderr, /acctdata\.txt line 2\b/);
  });
});

test('M3: a record that is too long stops the run and names the line', () => {
  run('post', withFile(one(), 'cardxref.txt', lines([xref(), `${xref({ card: '4000000000000002' })}JUNK`])), (r) => {
    assertRefused(assert, r);
    assert.match(r.stderr, /cardxref\.txt line 2\b/);
  });
});

test('M3: a record that is cut short inside a number stops the run', () => {
  run('post', withFile(one(), 'tcatbal.txt', lines([catbal().slice(0, 15)])), (r) => {
    assertRefused(assert, r);
    assert.match(r.stderr, /tcatbal\.txt line 1\b/);
  });
});

test('M3: a bad record in the last line of a long file names that line', () => {
  const rows = Array.from({ length: 11 }, (_, i) => catbal({ cat: String(i + 1).padStart(4, '0') }));
  rows.push(catbal({ cat: '0099', balance: '1.00' }).replace('0099', '00A9'));
  run('post', withFile(one(), 'tcatbal.txt', lines(rows)), (r) => {
    assertRefused(assert, r);
    assert.match(r.stderr, /tcatbal\.txt line 12\b/);
  });
});

test('M3: a bad record in the interest inputs stops that job too', () => {
  run('interest', withFile(interestInputs({ catbals: [catbal({ balance: '10.00' })] }), 'discgrp.txt', lines([`${disc({ group: 'DEFAULT' }).slice(0, 16)}00XX0{${' '.repeat(28)}`])), (r) => {
    assertRefused(assert, r);
    assert.match(r.stderr, /discgrp\.txt line 1\b/);
  });
});

test('M3: a missing input file stops the run', () => {
  const inputs = one();
  delete inputs['cardxref.txt'];
  run('post', inputs, (r) => assertRefused(assert, r));
  const rest = interestInputs();
  delete rest['discgrp.txt'];
  run('interest', rest, (r) => assertRefused(assert, r));
});

test('M3: a key that appears twice in a lookup file stops the run', () => {
  run('post', withFile(one(), 'cardxref.txt', lines([xref(), xref({ customer: '000000002' })])), (r) => {
    assertRefused(assert, r);
    assert.match(r.stderr, /cardxref\.txt line 2\b/);
  });
  run('post', withFile(one(), 'acctdata.txt', lines([account(), account()])), (r) => assertRefused(assert, r));
  run('post', withFile(one(), 'tcatbal.txt', lines([catbal(), catbal({ balance: '2.00' })])), (r) => assertRefused(assert, r));
});

test('M3: a failed run after good data was read leaves no partial output and no temporary file', () => {
  const trans = [tran({ id: '0000000000000001' }), tran({ id: '0000000000000002' }).replace('POS TERM  ', 'POS\u0001TERM  ')];
  run('post', withFile(one(), 'dailytran.txt', lines(trans)), (r) => {
    assertRefused(assert, r);
    assert.match(r.stderr, /dailytran\.txt line 2\b/);
  });
});

test('a short line (trailing blanks missing) reads the same as the padded line', () => {
  const full = one({ catbals: [catbal({ balance: '5.00' })] });
  const short = Object.fromEntries(Object.entries(full).map(([name, text]) => [name, text.split('\n').map((l) => l.trimEnd()).join('\n')]));
  assert.ok(short['acctdata.txt'].length < full['acctdata.txt'].length);
  run('post', full, (a) => run('post', short, (b) => {
    assert.equal(a.status, 0, a.stderr);
    assert.equal(b.status, 0, b.stderr);
    for (const name of cd.POST_FILES.filter((n) => n !== 'transact.txt')) assert.equal(b.read(name), a.read(name), name);
  }));
});

test('an existing output directory that holds a file is refused and left as it was', () => {
  const prepare = (_in, out) => { fs.mkdirSync(out); fs.writeFileSync(path.join(out, 'keep.txt'), 'mine'); };
  run('post', one(), (r) => {
    assert.equal(r.status, 2, r.stderr);
    assert.deepEqual(r.files, ['keep.txt']);
    assert.equal(r.read('keep.txt'), 'mine');
    assert.deepEqual(r.siblings, ['in', 'out']);
  }, { prepare });
  run('interest', interestInputs(), (r) => {
    assert.equal(r.status, 2, r.stderr);
    assert.deepEqual(r.files, ['keep.txt']);
  }, { prepare });
});

test('an existing empty output directory is accepted and filled', () => {
  run('post', one(), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.files, cd.POST_FILES);
  }, { prepare: (_in, out) => fs.mkdirSync(out) });
  run('interest', interestInputs(), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.files, cd.INTEREST_FILES);
  }, { prepare: (_in, out) => fs.mkdirSync(out) });
});

test('a new output directory is created, and a successful run leaves no temporary file next to it', () => {
  run('post', one(), (r) => {
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.siblings, ['in', 'out']);
  });
});

test('an output path that is an existing file is refused', () => {
  run('post', one(), (r) => {
    assert.equal(r.status, 2, r.stderr);
    assert.equal(fs.readFileSync(r.outDir, 'utf8'), 'not a directory');
  }, { prepare: (_in, out) => fs.writeFileSync(out, 'not a directory') });
});

test('input files are not changed by a run', () => {
  const inputs = one({ catbals: [catbal({ balance: '3.00' })] });
  run('post', inputs, (r) => {
    assert.equal(r.status, 0, r.stderr);
    for (const [name, text] of Object.entries(inputs)) assert.equal(fs.readFileSync(path.join(r.inDir, name), 'utf8'), text, name);
  });
});

test('neither stream shows a card number or an amount when the input is bad', () => {
  const bad = lines([`${xref({ card: '4000000000000001' })}`, '4000000000000009 not a record']);
  run('post', withFile(one({ trans: [tran({ amount: '12.34' })] }), 'cardxref.txt', bad), (r) => {
    assertRefused(assert, r);
    for (const secret of ['4000000000000001', '4000000000000009', '12.34', '1234']) {
      assert.ok(!r.stdout.includes(secret) && !r.stderr.includes(secret), `a stream shows ${secret}`);
    }
  });
});

/** Run the command line with raw arguments, outside any scratch input. */
const cli = (args) => spawnSync('python3', ['-m', 'carddemo_port', ...args], { cwd: cd.ROOT, encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });

test('usage errors exit with 2: no job, an unknown job, a missing --in or --out', () => {
  for (const args of [[], ['frobnicate'], ['post', '--out', '/nonexistent/x'], ['post', '--in', '/nonexistent/x'], ['interest']]) {
    const r = cli(args);
    assert.equal(r.status, 2, `${args.join(' ')} gave exit ${r.status}`);
  }
});

test('a run date that is not a real YYYY-MM-DD date is a usage error and writes nothing', () => {
  for (const date of ['11/25/2026', '2026-13-01', '2026-02-30', 'today', '20261125']) {
    run('interest', interestInputs({ catbals: [catbal({ balance: '10.00' })] }), (r) => assertRefused(assert, r), { args: ['--run-date', date] });
  }
});

test('--run-date is accepted by interest and only by interest', () => {
  run('post', one(), (r) => assert.equal(r.status, 2, r.stderr), { args: ['--run-date', '2026-11-25'] });
});
