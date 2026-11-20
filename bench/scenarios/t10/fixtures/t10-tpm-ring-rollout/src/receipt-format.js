'use strict';

function toEnvelope(receipt) {
  return {
    version: 2,
    receipt: {
      id: receipt.id,
      accountId: receipt.accountId,
      amountCents: receipt.amountCents,
      currency: receipt.currency || 'USD',
      issuedAt: receipt.issuedAt
    }
  };
}

function formatLine(receipt) {
  return `${receipt.receipt.id} ${receipt.receipt.currency} ${receipt.receipt.amountCents}`;
}

module.exports = { toEnvelope, formatLine };
