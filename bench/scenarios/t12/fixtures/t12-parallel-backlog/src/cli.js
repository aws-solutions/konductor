'use strict';

const HELP = `ledgerline export [--from YYYY-MM-DD] [--out FILE]

  --from   only invoices issued on or after this date
  --out    write to FILE instead of stdout
`;

function main(argv) {
  if (argv.includes('--help')) return process.stdout.write(HELP);
  const since = argv[argv.indexOf('--since') + 1];
  return since;
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { HELP, main };
