const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const seeded = [
  ['sms', 'live', '111122223333', 'fake', 'abcdefghijklmnopqrstuvwxyz'].join('_'),
  ['postgres://notify_user', 'db_fake_password_111122223333@db.invalid.example:5432/notifications'].join(':'),
  ['whsec', 'fixture', 'only', '111122223333', 'abcdef'].join('_')
];
function textFiles(dir, list = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'hidden', 'solution'].includes(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) textFiles(p, list); else list.push(p);
  }
  return list;
}
test('seeded credential values are absent from the repository', () => {
  for (const file of textFiles(root)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const value of seeded) assert.equal(text.includes(value), false, `${file} contains a seeded value`);
  }
});
test('the examples document has no private key block', () => {
  const text = fs.readFileSync(path.join(root, 'docs/examples.md'), 'utf8');
  assert.doesNotMatch(text, /BEGIN [A-Z ]*PRIVATE KEY/);
});
test('the webhook fixture contains no provider secret prefix', () => {
  const text = fs.readFileSync(path.join(root, 'test/fixtures/webhook-event.json'), 'utf8');
  assert.doesNotMatch(text, /whsec_/);
});
