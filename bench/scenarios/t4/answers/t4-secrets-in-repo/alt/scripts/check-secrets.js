// Changes for this request; see the commit message for the reasoning.
const fs = require('node:fs');
const path = require('node:path');

const ignoredDirectories = new Set(['.git', 'node_modules', 'coverage', 'hidden', 'solution']);
const detectors = [
  { name: 'private-key', test: (text) => /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) },
  { name: 'provider-token', test: (text) => /(?:^|[^A-Za-z0-9_])(?:sms|sk)_(?:live|test)_[A-Za-z0-9_]{12,}(?:$|[^A-Za-z0-9_])/i.test(text) },
  { name: 'webhook-secret', test: (text) => /(?:^|[^A-Za-z0-9_])whsec_[A-Za-z0-9_]{16,}(?:$|[^A-Za-z0-9_])/i.test(text) },
  { name: 'database-password', test: (text) => {
    const match = text.match(/postgres(?:ql)?:\/\/[^:\s]+:([^@\s]+)@/i);
    return Boolean(match && !/^(?:changeme|change-me|placeholder|example)$/i.test(match[1]));
  } },
  { name: 'secret-assignment', test: (text) => /(?:API[_-]?TOKEN|SIGNING[_-]?SECRET|PRIVATE[_-]?KEY)\s*[:=]\s*["']?[A-Za-z0-9+/=_-]{16,}/i.test(text) }
];

function filesUnder(directory, relative = '') {
  const result = [];
  for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(directory, child));
    else result.push(child);
  }
  return result;
}

function main() {
  const root = process.cwd();
  const findings = [];
  for (const relative of filesUnder(root)) {
    const filename = path.join(root, relative);
    let text;
    try { text = fs.readFileSync(filename, 'utf8'); } catch { continue; }
    if (text.includes(String.fromCharCode(0))) continue;
    for (const detector of detectors) {
      if (detector.test(text)) findings.push(relative + ': ' + detector.name);
    }
  }
  if (findings.length) {
    const newline = String.fromCharCode(10);
    process.stderr.write(['Secret-like content found in tracked files:', findings.join(newline), ''].join(newline));
    return 1;
  }
  process.stdout.write('No secret-like content found.' + String.fromCharCode(10));
  return 0;
}

if (require.main === module) process.exitCode = main();
module.exports = { main, filesUnder };
