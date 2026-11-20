#!/usr/bin/env node

const path = require('node:path');
const { readReport } = require('../src/load-data');
const { buildReport } = require('../src/report');

function parseArgs(argv) {
  const args = [...argv];
  const file = args.shift();
  let format = 'table';
  let compact = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--compact') {
      compact = true;
    } else if (arg === '--format') {
      format = args[++i];
    } else if (arg.startsWith('--format=')) {
      format = arg.slice('--format='.length);
    } else if (arg) {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  if (!file) throw new Error('an input JSON file is required');
  if (!['table', 'csv', 'json'].includes(format)) {
    throw new Error(`unsupported format: ${format}`);
  }
  return { file: path.resolve(file), format, compact };
}

try {
  const options = parseArgs(process.argv.slice(2));
  const report = readReport(options.file);
  const output = buildReport(report, options);
  process.stdout.write(output);
  if (options.format === 'json') process.stdout.write('\n');
} catch (error) {
  process.stderr.write(`report: ${error.message}\n`);
  process.exitCode = 1;
}
