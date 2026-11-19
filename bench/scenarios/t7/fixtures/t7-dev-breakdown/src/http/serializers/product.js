const { formatMoney } = require('../../services/money');

function serializeProduct(product) {
  return { id: product.id, name: product.name, price: formatMoney(product.price_minor) };
}
module.exports = { serializeProduct };
