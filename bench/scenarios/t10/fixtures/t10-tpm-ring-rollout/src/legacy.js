'use strict';

function toLegacyReceipt(receipt) {
  return {
    receiptId: receipt.id,
    account: receipt.accountId,
    cents: receipt.amountCents,
    currency: receipt.currency || 'USD',
    created: receipt.issuedAt
  };
}

module.exports = { toLegacyReceipt };
