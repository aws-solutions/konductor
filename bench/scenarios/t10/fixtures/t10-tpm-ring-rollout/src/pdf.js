'use strict';

function renderPdfModel(receipt) {
  return [
    `Receipt ${receipt.id}`,
    `Account: ${receipt.accountId}`,
    `Amount: ${receipt.currency || 'USD'} ${receipt.amountCents}`,
    `Issued: ${receipt.issuedAt}`
  ].join('\n');
}

module.exports = { renderPdfModel };
