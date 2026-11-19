const rates = require('../../data/tax-rates.generated.json');

function taxRateFor(region, date = new Date()) {
  const entries = rates[region] || rates.DEFAULT;
  const current = date.toISOString().slice(0, 10);
  const match = entries.filter((entry) => entry.from <= current).sort((a, b) => b.from.localeCompare(a.from))[0];
  return match ? match.rate : 0;
}

module.exports = { taxRateFor };
