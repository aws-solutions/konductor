const { formatMoney } = require('../services/money');

function productCsvRow(product) {
  return [product.id, product.name, formatMoney(product.price_minor)].join(',');
}
module.exports = { productCsvRow };
