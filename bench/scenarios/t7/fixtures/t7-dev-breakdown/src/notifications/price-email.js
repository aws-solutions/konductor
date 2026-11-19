const { formatMoney } = require('../services/money');

function renderPriceNotice(product, recipient) {
  return `Hello ${recipient}, ${product.name} is now ${formatMoney(product.price_minor)}.`;
}
module.exports = { renderPriceNotice };
