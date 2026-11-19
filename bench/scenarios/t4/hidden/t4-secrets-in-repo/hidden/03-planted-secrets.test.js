const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const token = ['sms', 'live', '111122223333', 'planted', 'abcdefghijklmnopqrstuvwxyz'].join('_');
function runWith(name, text) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-lantern-check-'));
  try {
    fs.mkdirSync(path.join(directory, 'scripts'));
    fs.copyFileSync(path.join(root, 'scripts/check-secrets.js'), path.join(directory, 'scripts/check-secrets.js'));
    fs.writeFileSync(path.join(directory, name), text);
    return spawnSync(process.execPath, ['scripts/check-secrets.js'], { cwd: directory, encoding: 'utf8' });
  }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('the check fails for a provider token in a planted file', () => {
  const result = runWith('planted-token.txt', `value=${token}`);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /planted-token\.txt/);
});
test('the check fails for a planted private key block', () => {
  const result = runWith('planted-key.txt', '-----BEGIN PRIVATE KEY-----\nplaceholder-material-1234567890\n-----END PRIVATE KEY-----');
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /planted-key\.txt/);
});
test('the check fails for a secret assignment', () => {
  const value = ['webhook', 'signing', 'secret', 'planted', '1234567890'].join('_');
  const result = runWith('planted-assignment.txt', `WEBHOOK_SIGNING_SECRET=${value}`);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /planted-assignment\.txt/);
});
test('the checker does not print the detected value', () => {
  const result = runWith('planted-output.txt', `SMS_API_TOKEN=${token}`);
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /planted-output\.txt/);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(token));
});
