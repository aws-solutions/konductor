const codes = new Map([
  ['WELCOME10', { kind: 'percent', amount: 10, active: true, uses: 0, limit: 100 }],
  ['SHIPFREE', { kind: 'flat', amount: 5, active: true, uses: 0, limit: 50 }],
  ['OLD20', { kind: 'percent', amount: 20, active: false, uses: 0, limit: 10 }]
]);

function applyPromo(code, subtotal) {
  const promo = codes.get(String(code).toUpperCase());
  if (!promo || !promo.active || promo.uses >= promo.limit) return { discount: 0, code: null };
  const discount = promo.kind === 'percent' ? subtotal * (promo.amount / 100) : Math.min(promo.amount, subtotal);
  promo.uses += 1;
  return { discount, code: String(code).toUpperCase() };
}

module.exports = { applyPromo, codes };
