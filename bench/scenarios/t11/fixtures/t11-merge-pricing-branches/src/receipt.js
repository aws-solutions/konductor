'use strict';

function receiptRows(quote) {
  return [
    ['Subtotal', quote.subtotal],
    ['Discount', quote.discount],
    ['Shipping', quote.shipping],
    ['Tax', quote.tax],
    ['Total', quote.total]
  ];
}

module.exports = { receiptRows };
