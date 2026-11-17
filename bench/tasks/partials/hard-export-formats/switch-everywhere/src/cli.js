'use strict';

const fs = require('node:fs');
const { exportReport } = require('./render');

const FORMATS = ['csv', 'json', 'tsv'];
const USAGE = 'usage: report-export --format csv|json --input FILE [--columns a,b]';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (!['--format', '--input', '--columns'].includes(flag) || value === undefined) return { error: USAGE };
    out[flag.slice(2)] = value;
  }
  return out;
}

/**
 * Runs the command line. `argv` is the arguments after the script name; `io` has `stdout` and `stderr`, each with a
 * `write(text)`. Returns the exit code.
 */
function run(argv, io) {
  const args = parseArgs(argv);
  if (args.error || !args.input) { io.stderr.write(`${args.error || USAGE}\n`); return 2; }
  if (!FORMATS.includes(args.format)) { io.stderr.write(`unknown format "${args.format}" (expected csv or json)\n`); return 2; }
  const rows = JSON.parse(fs.readFileSync(args.input, 'utf8'));
  const columns = args.columns ? args.columns.split(',') : undefined;
  io.stdout.write(exportReport(rows, { format: args.format, columns }));
  return 0;
}

module.exports = { run };
