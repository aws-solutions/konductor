'use strict';

const fs = require('node:fs');
const path = require('node:path');

const roleDir = path.join(__dirname, '..', 'infra', 'roles');
const files = fs.readdirSync(roleDir).filter((name) => name.endsWith('.json')).sort();
const failures = [];

for (const name of files) {
  const file = path.join(roleDir, name);
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (doc.Version !== '2012-10-17') failures.push(`${name}: unsupported version`);
    if (!doc.Statement || !Array.isArray(doc.Statement) && typeof doc.Statement !== 'object') {
      failures.push(`${name}: missing statements`);
    }
    const statements = Array.isArray(doc.Statement) ? doc.Statement : [doc.Statement];
    statements.forEach((statement, index) => {
      if (!['Allow', 'Deny'].includes(statement.Effect)) failures.push(`${name}:${index}: invalid effect`);
      if ((statement.Action === undefined) === (statement.NotAction === undefined)) {
        failures.push(`${name}:${index}: action selector`);
      }
    });
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`checked ${files.length} policy documents`);
}
