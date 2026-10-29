'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const bin = path.join(__dirname, '..', 'bin', 'migrate.js');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const rec = (o = {}) => ({ id: 'o-1', customer: 'Ann Lee', total: 19.99, placed: '03/14/2024', status: 'SHIPPED', address: '12 Main St, Springfield, IL 62704', ...o });
const lines = (...rs) => rs.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n';

function setup(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  if (content !== undefined) fs.writeFileSync(path.join(dir, 'orders.jsonl'), content);
  return dir;
}
const run = (cmd, dir, ...flags) => spawnSync(process.execPath, [bin, cmd, '--dir', dir, ...flags], { encoding: 'utf8', env: { ...process.env, TZ: 'Asia/Tokyo' } });
const read = (dir, f = 'orders.jsonl') => fs.readFileSync(path.join(dir, f), 'utf8');
const parsed = (dir) => read(dir).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const snapshot = (dir) => Object.fromEntries(fs.readdirSync(dir).sort().map((f) => [f, fs.readFileSync(path.join(dir, f)).toString('base64')]));
const one = (over) => { const d = setup(lines(rec(over))); const r = run('up', d); assert.equal(r.status, 0, r.stderr); return { d, out: parsed(d)[0], rejects: fs.existsSync(path.join(d, 'rejects.jsonl')) ? read(d, 'rejects.jsonl').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [] }; };
const reasonOf = (over) => { const { out, rejects } = one(over); assert.equal(rejects.length, 1, JSON.stringify(over)); assert.equal(out.schema, undefined); return rejects[0].reason; };

test('up converts the documented example', () => {
  const { out } = one();
  assert.deepEqual(out, { schema: 2, id: 'o-1', customer: 'Ann Lee', totalCents: 1999, placedAt: '2024-03-14', status: 'shipped', address: { street: '12 Main St', city: 'Springfield', region: 'IL', postalCode: '62704' } });
});

test('totals are rounded half up on the decimal value as written', () => {
  const cases = [[19.99, 1999], [1.005, 101], [2.675, 268], [0.1 + 0.2, 30], [0.5, 50], ['120.50', 12050], ['7', 700], [0.004, 0], [0.005, 1], [1234567.89, 123456789], [0, 0], ['0.145', 15], [8.325, 833], [1.1, 110]];
  for (const [total, cents] of cases) assert.equal(one({ total }).out.totalCents, cents, String(total));
});

test('bad totals are rejected as invalid total', () => {
  for (const total of [-1, '-0.5', 'abc', '', '1,000.00', null, true, {}]) assert.equal(reasonOf({ total }), 'invalid total', String(total));
  assert.equal(reasonOf({ total: undefined }), 'invalid total');
});

test('dates convert without any time zone shift', () => {
  for (const [placed, iso] of [['02/29/2024', '2024-02-29'], ['12/31/1999', '1999-12-31'], ['01/01/2000', '2000-01-01'], ['03/31/2024', '2024-03-31'], ['10/27/2024', '2024-10-27']]) assert.equal(one({ placed }).out.placedAt, iso, placed);
});

test('impossible or malformed dates are rejected as invalid date', () => {
  for (const placed of ['02/29/2023', '04/31/2024', '13/01/2024', '00/10/2024', '02/30/2024', '1/2/2024', '2024-03-14', '03/14/24', '', null, '02/29/1900']) assert.equal(reasonOf({ placed }), 'invalid date', String(placed));
  assert.equal(one({ placed: '02/29/2000' }).out.placedAt, '2000-02-29');
});

test('statuses map as documented, ignoring case', () => {
  for (const [status, want] of [['NEW', 'new'], ['paid', 'paid'], ['Shipped', 'shipped'], ['DONE', 'delivered'], ['done', 'delivered'], ['CANCELLED', 'cancelled'], ['Canceled', 'cancelled']]) assert.equal(one({ status }).out.status, want, status);
  for (const status of ['refunded', '', null, 'deliveredd']) assert.equal(reasonOf({ status }), 'unknown status', String(status));
});

test('addresses: commas in the street and ZIP+4', () => {
  assert.deepEqual(one({ address: '1 Pier Rd, Unit 4, Seattle, WA 98101-1234' }).out.address, { street: '1 Pier Rd, Unit 4', city: 'Seattle', region: 'WA', postalCode: '98101-1234' });
  assert.deepEqual(one({ address: 'A, B, C, D, TX 73301' }).out.address, { street: 'A, B, C', city: 'D', region: 'TX', postalCode: '73301' });
});

test('malformed addresses are rejected as invalid address', () => {
  for (const address of ['12 Main St, Springfield', 'Springfield, IL 62704', '12 Main St, Springfield, il 62704', '12 Main St, Springfield, IL 6270', '12 Main St, Springfield, IL 627041', '12 Main St, Springfield, IL', '12 Main St, , IL 62704', ', Springfield, IL 62704', 5, null]) assert.equal(reasonOf({ address }), 'invalid address', String(address));
});

test('missing id or customer', () => {
  assert.equal(reasonOf({ id: undefined }), 'missing field: id');
  assert.equal(reasonOf({ id: '' }), 'missing field: id');
  assert.equal(reasonOf({ customer: undefined }), 'missing field: customer');
  assert.equal(reasonOf({ customer: '' }), 'missing field: customer');
  assert.equal(reasonOf({ id: undefined, customer: undefined, total: -1 }), 'missing field: id');
});

test('the first applicable reason wins', () => {
  assert.equal(reasonOf({ total: 'x', placed: 'y', status: 'z', address: 'w' }), 'invalid total');
  assert.equal(reasonOf({ placed: 'y', status: 'z', address: 'w' }), 'invalid date');
  assert.equal(reasonOf({ status: 'z', address: 'w' }), 'unknown status');
});

test('unknown fields are copied unchanged and unicode survives', () => {
  const { out } = one({ customer: 'Zo\u00eb \u65e5\u672c \u{1F600}', note: { tags: ['a', 'b'], n: 1.5 }, gift: true, schema: 1 });
  assert.equal(out.customer, 'Zo\u00eb \u65e5\u672c \u{1F600}');
  assert.deepEqual(out.note, { tags: ['a', 'b'], n: 1.5 });
  assert.equal(out.gift, true);
  assert.equal(out.schema, 2);
});

test('records in schema 2 are skipped and left as they are', () => {
  const v2 = { schema: 2, id: 'o-9', customer: 'Bo', totalCents: 5, placedAt: '2024-01-01', status: 'paid', address: { street: 's', city: 'c', region: 'TX', postalCode: '73301' } };
  const d = setup(lines(rec({ id: 'a' }), v2, rec({ id: 'b' })));
  const r = run('up', d);
  assert.deepEqual(JSON.parse(r.stdout), { migrated: 2, skipped: 1, rejected: 0 });
  assert.deepEqual(parsed(d).map((x) => x.id), ['a', 'o-9', 'b']);
  assert.deepEqual(parsed(d)[1], v2);
  assert.equal(read(d).split('\n')[1], JSON.stringify(v2));
});

test('a second up changes nothing on disk', () => {
  const d = setup(lines(rec({ id: 'a' }), rec({ id: 'b', total: 'bad' }), rec({ id: 'c' })));
  run('up', d);
  const before = snapshot(d);
  const r = run('up', d);
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { migrated: 0, skipped: 2, rejected: 1 });
  assert.deepEqual(snapshot(d), before);
});

test('the backup is the original bytes and is never overwritten', () => {
  const original = `${JSON.stringify(rec({ id: 'a' }))}\r\n\r\n${JSON.stringify(rec({ id: 'b' }))}`;
  const d = setup(original);
  run('up', d);
  assert.equal(read(d, 'orders.v1.bak'), original);
  fs.appendFileSync(path.join(d, 'orders.jsonl'), `${JSON.stringify(rec({ id: 'late' }))}\n`);
  const r = run('up', d);
  assert.equal(JSON.parse(r.stdout).migrated, 1);
  assert.equal(read(d, 'orders.v1.bak'), original);
});

test('the state file holds the hashes of the backup and of the result', () => {
  const d = setup(lines(rec()));
  run('up', d);
  const state = JSON.parse(read(d, '.migration-state.json'));
  assert.deepEqual(state, { backupSha256: sha(fs.readFileSync(path.join(d, 'orders.v1.bak'))), resultSha256: sha(fs.readFileSync(path.join(d, 'orders.jsonl'))) });
  fs.appendFileSync(path.join(d, 'orders.jsonl'), `${JSON.stringify(rec({ id: 'late' }))}\n`);
  run('up', d);
  const next = JSON.parse(read(d, '.migration-state.json'));
  assert.equal(next.resultSha256, sha(fs.readFileSync(path.join(d, 'orders.jsonl'))));
  assert.equal(next.backupSha256, state.backupSha256);
});

test('only the documented files exist after up', () => {
  const d = setup(lines(rec({ id: 'a' }), rec({ id: 'b', status: 'nope' })));
  run('up', d);
  assert.deepEqual(fs.readdirSync(d).sort(), ['.migration-state.json', 'orders.jsonl', 'orders.v1.bak', 'rejects.jsonl']);
  const clean = setup(lines(rec()));
  run('up', clean);
  assert.deepEqual(fs.readdirSync(clean).sort(), ['.migration-state.json', 'orders.jsonl', 'orders.v1.bak']);
});

test('rejects are listed with physical line numbers and the raw line', () => {
  const bad = '{"id": "broken"';
  const d = setup(`${JSON.stringify(rec({ id: 'a' }))}\r\n\n${bad}\r\n${JSON.stringify(rec({ id: 'c', placed: '02/30/2024' }))}\n`);
  const r = run('up', d);
  assert.deepEqual(JSON.parse(r.stdout), { migrated: 1, skipped: 0, rejected: 2 });
  const rej = read(d, 'rejects.jsonl').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(rej.map((x) => [x.line, x.reason]), [[3, 'invalid json'], [4, 'invalid date']]);
  assert.equal(rej[0].raw, bad);
  assert.equal(rej[1].raw, JSON.stringify(rec({ id: 'c', placed: '02/30/2024' })));
});

test('rejected lines stay in the file, blank lines go, endings become \\n', () => {
  const bad = '{"id": "broken"';
  const d = setup(`${bad}\r\n\r\n   \r\n${JSON.stringify(rec({ id: 'a' }))}\r\n`);
  run('up', d);
  const out = read(d).split('\n');
  assert.equal(out[0], bad);
  assert.equal(JSON.parse(out[1]).id, 'a');
  assert.equal(out.length, 3);
  assert.equal(out[2], '');
  assert.ok(!read(d).includes('\r'));
});

test('input without a final newline is handled', () => {
  const d = setup(JSON.stringify(rec({ id: 'a' })));
  run('up', d);
  assert.ok(read(d).endsWith('}\n'));
  assert.equal(parsed(d).length, 1);
});

test('a later record with an earlier id is rejected as duplicate id', () => {
  const d = setup(lines(rec({ id: 'x', customer: 'First' }), rec({ id: 'y' }), rec({ id: 'x', customer: 'Second' })));
  const r = run('up', d);
  assert.deepEqual(JSON.parse(r.stdout), { migrated: 2, skipped: 0, rejected: 1 });
  const rej = JSON.parse(read(d, 'rejects.jsonl').trim());
  assert.deepEqual([rej.line, rej.reason], [3, 'duplicate id']);
  assert.equal(parsed(d)[0].customer, 'First');
  assert.equal(parsed(d)[2].customer, 'Second');
  assert.equal(parsed(d)[2].schema, undefined);
});

test('rejects.jsonl is rewritten each time and removed when nothing is rejected', () => {
  const d = setup(lines(rec({ id: 'a', total: 'bad' })));
  run('up', d);
  assert.ok(fs.existsSync(path.join(d, 'rejects.jsonl')));
  fs.writeFileSync(path.join(d, 'orders.jsonl'), lines(rec({ id: 'a' })));
  const r = run('up', d);
  assert.equal(r.status, 0);
  assert.equal(fs.existsSync(path.join(d, 'rejects.jsonl')), false);
});

test('dry-run reports and writes nothing', () => {
  const d = setup(lines(rec({ id: 'a' }), rec({ id: 'b', total: 'bad' })));
  const before = snapshot(d);
  const r = run('up', d, '--dry-run');
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { migrated: 1, skipped: 0, rejected: 1 });
  assert.deepEqual(snapshot(d), before);
});

test('an empty file migrates to an empty file without a backup', () => {
  const d = setup('');
  const r = run('up', d);
  assert.deepEqual(JSON.parse(r.stdout), { migrated: 0, skipped: 0, rejected: 0 });
  assert.deepEqual(fs.readdirSync(d), ['orders.jsonl']);
});

test('down restores the original bytes and removes the migration files', () => {
  const original = `${JSON.stringify(rec({ id: 'a', total: 1.005 }))}\r\n\r\nnot json\r\n${JSON.stringify(rec({ id: 'b' }))}`;
  const d = setup(original);
  run('up', d);
  const r = run('down', d);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { restored: true });
  assert.equal(read(d), original);
  assert.deepEqual(fs.readdirSync(d), ['orders.jsonl']);
});

test('down and up can be repeated', () => {
  const original = lines(rec({ id: 'a' }), rec({ id: 'b', status: 'x' }));
  const d = setup(original);
  run('up', d);
  const migrated = read(d);
  run('down', d);
  run('up', d);
  assert.equal(read(d), migrated);
  run('down', d);
  assert.equal(read(d), original);
});

test('down with nothing to roll back exits 2 and changes nothing', () => {
  const d = setup(lines(rec()));
  const before = snapshot(d);
  assert.equal(run('down', d).status, 2);
  assert.deepEqual(snapshot(d), before);
  run('up', d);
  run('down', d);
  const after = snapshot(d);
  assert.equal(run('down', d).status, 2);
  assert.deepEqual(snapshot(d), after);
});

test('down refuses when orders.jsonl was edited after up, unless forced', () => {
  const original = lines(rec({ id: 'a' }));
  const d = setup(original);
  run('up', d);
  fs.appendFileSync(path.join(d, 'orders.jsonl'), 'edited\n');
  const before = snapshot(d);
  const r = run('down', d);
  assert.equal(r.status, 3);
  assert.deepEqual(snapshot(d), before);
  const forced = run('down', d, '--force');
  assert.equal(forced.status, 0);
  assert.equal(read(d), original);
  assert.deepEqual(fs.readdirSync(d), ['orders.jsonl']);
});

test('down --dry-run writes nothing', () => {
  const d = setup(lines(rec()));
  run('up', d);
  const before = snapshot(d);
  assert.equal(run('down', d, '--dry-run').status, 0);
  assert.deepEqual(snapshot(d), before);
});

test('usage errors and a missing file exit 2', () => {
  const d = setup();
  assert.equal(run('up', d).status, 2);
  assert.equal(spawnSync(process.execPath, [bin, 'sideways', '--dir', d]).status, 2);
  assert.equal(spawnSync(process.execPath, [bin, 'up']).status, 2);
});
