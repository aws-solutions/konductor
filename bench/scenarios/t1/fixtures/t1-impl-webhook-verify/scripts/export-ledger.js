const { Ledger } = require('../src/ledger');
const ledger = new Ledger();
process.stdout.write(JSON.stringify(ledger.snapshot(), null, 2) + '\n');
