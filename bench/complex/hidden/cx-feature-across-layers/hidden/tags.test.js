'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.resolve(__dirname, '..', 'src', 'cli.js');

function setup(initial) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-hidden-'));
  const file = path.join(dir, 'n.json');
  if (initial !== undefined) fs.writeFileSync(file, typeof initial === 'string' ? initial : JSON.stringify(initial));
  const cli = (...args) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, NOTES_FILE: file }, encoding: 'utf8', cwd: dir });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
  return { cli, read, file };
}

test('add with tags prints the id, and list shows the tags as a third column in the given order', () => {
  const s = setup();
  assert.deepEqual(s.cli('add', 'plan the trip', '--tag', 'travel', '--tag', 'ideas'), { code: 0, out: 'added 1\n', err: '' });
  assert.equal(s.cli('list').out, '1\tplan the trip\t#travel #ideas\n');
});

test('notes without tags list exactly as before', () => {
  const s = setup();
  s.cli('add', 'plain');
  s.cli('add', 'tagged', '--tag', 'x');
  assert.equal(s.cli('list').out, '1\tplain\n2\ttagged\t#x\n');
});

test('tags are trimmed and lowercased, and repeats collapse', () => {
  const s = setup();
  s.cli('add', 'n', '--tag', ' Work ', '--tag', 'WORK', '--tag', 'home');
  assert.equal(s.cli('list').out, '1\tn\t#work #home\n');
  assert.deepEqual(s.read().notes[0].tags, ['work', 'home']);
});

test('list --tag keeps only matching notes, normalises its argument and prints no notes when nothing matches', () => {
  const s = setup();
  s.cli('add', 'a', '--tag', 'x', '--tag', 'y');
  s.cli('add', 'b', '--tag', 'y');
  s.cli('add', 'c');
  assert.equal(s.cli('list', '--tag', 'y').out, '1\ta\t#x #y\n2\tb\t#y\n');
  assert.equal(s.cli('list', '--tag', ' X ').out, '1\ta\t#x #y\n');
  assert.deepEqual(s.cli('list', '--tag', 'zzz'), { code: 0, out: 'no notes\n', err: '' });
});

test('tag adds a tag, repeating it is not an error, and untag removes it', () => {
  const s = setup();
  s.cli('add', 'a');
  assert.deepEqual(s.cli('tag', '1', 'Urgent'), { code: 0, out: 'tagged 1 #urgent\n', err: '' });
  assert.deepEqual(s.cli('tag', '1', 'urgent'), { code: 0, out: 'tagged 1 #urgent\n', err: '' });
  assert.deepEqual(s.read().notes[0].tags, ['urgent']);
  assert.deepEqual(s.cli('untag', '1', 'URGENT'), { code: 0, out: 'untagged 1 #urgent\n', err: '' });
  assert.deepEqual(s.read().notes[0].tags, []);
});

test('untag of a tag the note does not have exits 3 with the documented message', () => {
  const s = setup();
  s.cli('add', 'a', '--tag', 'x');
  assert.deepEqual(s.cli('untag', '1', 'y'), { code: 3, out: '', err: 'error: note 1 has no tag "y"\n' });
  assert.deepEqual(s.read().notes[0].tags, ['x']);
});

test('tag and untag on an unknown id exit 3', () => {
  const s = setup();
  s.cli('add', 'a');
  assert.deepEqual(s.cli('tag', '7', 'x'), { code: 3, out: '', err: 'error: no note with id 7\n' });
  assert.equal(s.cli('untag', '7', 'x').code, 3);
});

test('invalid tags exit 2 with the tag as typed in the message, and nothing is saved', () => {
  const s = setup();
  s.cli('add', 'keep', '--tag', 'ok');
  const before = fs.readFileSync(s.file, 'utf8');
  for (const bad of ['two words', '-lead', 'a'.repeat(21), 'под', 'semi;colon', '']) {
    const r = s.cli('add', 'x', '--tag', bad);
    assert.equal(r.code, 2, JSON.stringify(bad));
    assert.equal(r.err, `error: invalid tag "${bad}"\n`);
    assert.equal(s.cli('tag', '1', bad).code, 2, JSON.stringify(bad));
  }
  assert.equal(fs.readFileSync(s.file, 'utf8'), before);
});

test('the longest valid tag is accepted', () => {
  const s = setup();
  const tag = `a${'-'.repeat(18)}9`;
  assert.equal(tag.length, 20);
  assert.equal(s.cli('add', 'x', '--tag', tag).code, 0);
});

test('a note holds at most 5 tags, on add and on tag', () => {
  const s = setup();
  const six = ['a', 'b', 'c', 'd', 'e', 'f'].flatMap((t) => ['--tag', t]);
  assert.deepEqual(s.cli('add', 'x', ...six), { code: 2, out: '', err: 'error: a note can have at most 5 tags\n' });
  assert.equal(s.cli('list').out, 'no notes\n');
  s.cli('add', 'x', ...six.slice(0, 10));
  const r = s.cli('tag', '1', 'f');
  assert.deepEqual(r, { code: 2, out: '', err: 'error: a note can have at most 5 tags\n' });
  assert.equal(s.read().notes[0].tags.length, 5);
  assert.equal(s.cli('tag', '1', 'a').code, 0);
});

test('a failed add does not use up an id', () => {
  const s = setup();
  assert.equal(s.cli('add', 'x', '--tag', 'ok', '--tag', 'not ok').code, 2);
  assert.equal(s.cli('add', 'y').out, 'added 1\n');
});

test('a version 1 file loads without tags and is rewritten as version 2 with an empty tag list on every note', () => {
  const s = setup({ version: 1, nextId: 3, notes: [{ id: 1, text: 'old one', createdAt: 't1' }, { id: 2, text: 'old two', createdAt: 't2' }] });
  assert.equal(s.cli('list').out, '1\told one\n2\told two\n');
  assert.equal(s.cli('tag', '2', 'legacy').code, 0);
  const saved = s.read();
  assert.equal(saved.version, 2);
  assert.equal(saved.nextId, 3);
  assert.deepEqual(saved.notes.map((n) => n.tags), [[], ['legacy']]);
  assert.equal(saved.notes[0].createdAt, 't1');
});

test('list --json carries a tags array on every note', () => {
  const s = setup();
  s.cli('add', 'a', '--tag', 'x');
  s.cli('add', 'b');
  const notes = JSON.parse(s.cli('list', '--json').out);
  assert.deepEqual(notes.map((n) => n.tags), [['x'], []]);
  assert.deepEqual(notes.map((n) => n.text), ['a', 'b']);
});

test('delete still works with tags, ids are not reused, and the file stays at version 2', () => {
  const s = setup();
  s.cli('add', 'a', '--tag', 'x');
  assert.equal(s.cli('delete', '1').out, 'deleted 1\n');
  assert.equal(s.cli('list', '--tag', 'x').out, 'no notes\n');
  assert.equal(s.cli('add', 'b').out, 'added 2\n');
  assert.equal(s.read().version, 2);
});

test('existing validation and usage errors are unchanged, and tag needs both arguments', () => {
  const s = setup();
  assert.equal(s.cli('add', '  ').code, 2);
  assert.equal(s.cli('add', 'x'.repeat(281)).code, 2);
  assert.equal(s.cli('frobnicate').code, 2);
  assert.equal(s.cli('delete', '9').code, 3);
  s.cli('add', 'a');
  assert.equal(s.cli('tag', '1').code, 2);
  assert.equal(s.cli('untag').code, 2);
});
