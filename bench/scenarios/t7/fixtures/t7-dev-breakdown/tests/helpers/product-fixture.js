function productFixture(overrides = {}) {
  return Object.assign({ id: 7, name: 'Canvas Tote', price_minor: 1299, currency_code: 'USD' }, overrides);
}
module.exports = { productFixture };
