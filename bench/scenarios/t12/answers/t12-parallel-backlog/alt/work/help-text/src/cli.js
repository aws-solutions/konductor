'use strict';

const HELP = `Usage: ledgerline export [options]

Options:
  --since YYYY-MM-DD   export only invoices issued on or after this date
  --out FILE           write the CSV to FILE (default: standard output)
`;

function main(argv) {
  if (argv.includes('--help')) return process.stdout.write(HELP);
  const since = argv[argv.indexOf('--since') + 1];
  return since;
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { HELP, main };
