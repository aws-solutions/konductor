#!/usr/bin/env node
const { dataPath } = require('./config');
const { readBookings } = require('./bookings');
const { monthlySummary } = require('./report');
const { error } = require('./logger');

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function main(args = process.argv.slice(2)) {
  const command = args[0];
  if (command !== 'report') throw new Error('usage: report --month YYYY-MM [--file path]');
  const monthText = option(args, '--month');
  const match = /^(\d{4})-(\d{2})$/.exec(monthText || '');
  if (!match) throw new Error('--month must use YYYY-MM');
  const file = option(args, '--file', dataPath());
  const summary = monthlySummary(readBookings(file), Number(match[1]), Number(match[2]));
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (require.main === module) {
  try { main(); } catch (err) { error(err.message); process.exitCode = 1; }
}

module.exports = { main };
