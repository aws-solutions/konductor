function formatMoney(amountMinor) {
  return '$' + (Number(amountMinor) / 100).toFixed(2);
}
module.exports = { formatMoney };
