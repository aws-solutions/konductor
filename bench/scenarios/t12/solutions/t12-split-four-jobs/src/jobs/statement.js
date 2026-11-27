'use strict';

// See docs/jobs/statement.md.
function amount(cents) {
  const abs = Math.abs(cents);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const text = `${whole}.${String(abs % 100).padStart(2, '0')}${cents < 0 ? '-' : ' '}`;
  if (text.length > 10) throw new RangeError(`statement: ${cents} does not fit in 10 columns`);
  return text.padStart(10, ' ');
}

function run(transactions) {
  const rows = transactions.map((t, i) => ({ t, i })).sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : a.i - b.i));
  const lines = rows.map(({ t }) => `${t.date} ${t.description.toUpperCase().slice(0, 20).padEnd(20, ' ')} ${amount(t.amountCents)}`);
  const total = transactions.reduce((s, t) => s + t.amountCents, 0);
  lines.push(`${'TOTAL'.padEnd(31, ' ')} ${amount(total)}`);
  return lines;
}

module.exports = { run };
