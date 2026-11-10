const RATES = { 'US-WA': 0.065, 'US-OR': 0, 'DE': 0.19 };

function taxFor(amount, region) {
  const rate = RATES[region];
  if (rate === undefined) throw new Error(`Unknown region ${region}`);
  return Math.round(amount * rate * 100) / 100;
}

module.exports = { taxFor, RATES };
