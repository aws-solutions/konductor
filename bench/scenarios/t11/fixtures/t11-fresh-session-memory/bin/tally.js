#!/usr/bin/env node
'use strict';

const { loadInvoices, DEFAULT_FILE } = require('../src/invoices.js');
const { feesReport } = require('../src/report.js');
const { parseDate } = require('../src/dates.js');

const USAGE = 'usage: tally fees --date YYYY-MM-DD [--file invoices.json]';

function option(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function main(argv) {
  const [cmd, ...args] = argv;
  if (cmd !== 'fees') {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const date = option(args, '--date');
  try {
    parseDate(date);
  } catch {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const invoices = loadInvoices(option(args, '--file') || DEFAULT_FILE);
  for (const r of feesReport(invoices, date)) process.stdout.write(`${r.id} ${r.customer} ${r.feeCents}\n`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
