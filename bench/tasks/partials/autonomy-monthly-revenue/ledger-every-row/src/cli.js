'use strict';

const listOrders = require('./commands/list-orders');
const customers = require('./commands/customers');
const monthlySummary = require('./commands/monthly-summary');

const COMMANDS = {
  'list-orders': listOrders,
  customers,
  'monthly-summary': monthlySummary,
};

// Returns { code, out }. Commands get the remaining arguments and { dataDir }.
function run(argv, ctx) {
  const [name, ...args] = argv;
  const command = COMMANDS[name];
  if (!command) return { code: 2, out: `unknown command: ${name ?? ''}\n` };
  return { code: 0, out: command(args, ctx) };
}

module.exports = { run, COMMANDS };
