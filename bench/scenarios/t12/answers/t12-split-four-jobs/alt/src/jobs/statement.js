'use strict';

// See docs/jobs/statement.md.
const DESC_WIDTH = 20;
const AMOUNT_WIDTH = 10;
const LABEL_WIDTH = 31;

function money(cents) {
  const sign = cents < 0 ? '-' : ' ';
  const abs = Math.abs(cents);
  const whole = new Intl.NumberFormat('en-US', { useGrouping: true, maximumFractionDigits: 0 }).format(Math.trunc(abs / 100));
  const text = `${whole}.${String(abs % 100).padStart(2, '0')}${sign}`;
  if (text.length > AMOUNT_WIDTH) throw new RangeError(`statement: amount ${cents} is wider than ${AMOUNT_WIDTH} columns`);
  return text.padStart(AMOUNT_WIDTH);
}

const line = (t) => [t.date, t.description.toUpperCase().slice(0, DESC_WIDTH).padEnd(DESC_WIDTH), money(t.amountCents)].join(' ');

function run(transactions) {
  // Array.prototype.sort is stable, so equal dates keep their input order.
  const ordered = [...transactions].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1));
  let total = 0;
  for (const t of ordered) total += t.amountCents;
  return [...ordered.map(line), `${'TOTAL'.padEnd(LABEL_WIDTH)} ${money(total)}`];
}

module.exports = { run };
