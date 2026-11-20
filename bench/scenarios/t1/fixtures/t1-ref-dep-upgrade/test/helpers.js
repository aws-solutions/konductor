const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function temporaryReport(report) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-lens-'));
  const file = path.join(dir, 'report.json');
  fs.writeFileSync(file, JSON.stringify(report));
  return { dir, file };
}

function removeTemporaryReport(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { temporaryReport, removeTemporaryReport };
