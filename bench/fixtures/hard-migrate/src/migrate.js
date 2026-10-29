'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { readLines, writeFile } = require('./io');
const { toV2 } = require('./schema');

function up(dir) {
  const file = path.join(dir, 'orders.jsonl');
  const backup = path.join(dir, 'orders.v1.bak');
  if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
  fs.copyFileSync(file, backup);

  const out = [];
  const rejects = [];
  let migrated = 0;
  readLines(file).forEach((line, i) => {
    if (!line) return;
    try {
      out.push(JSON.stringify(toV2(JSON.parse(line))));
      migrated += 1;
    } catch (e) {
      rejects.push({ line: i + 1, reason: e.message, raw: line });
      out.push(line);
    }
  });
  writeFile(file, `${out.join('\n')}\n`);
  if (rejects.length) writeFile(path.join(dir, 'rejects.jsonl'), `${rejects.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return { migrated, rejected: rejects.length };
}

function down() {
  throw new Error('down is not implemented yet');
}

module.exports = { up, down };
