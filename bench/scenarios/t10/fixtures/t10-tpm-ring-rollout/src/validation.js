'use strict';

const { ReceiptError } = require('./shared/errors');
const limits = require('../config/limits.json');

function validateReceipt(input) {
  if (!input || typeof input !== 'object') throw new ReceiptError('INVALID_RECEIPT', 'receipt must be an object', 400);
  if (!input.accountId || typeof input.accountId !== 'string') throw new ReceiptError('INVALID_ACCOUNT', 'accountId is required', 400);
  if (!Number.isInteger(input.amountCents) || input.amountCents < 0 || input.amountCents > limits.maxAmountCents) {
    throw new ReceiptError('INVALID_AMOUNT', 'amountCents is out of range', 400);
  }
  if (input.items && (!Array.isArray(input.items) || input.items.length > limits.maxItems)) throw new ReceiptError('INVALID_ITEMS', 'items are invalid', 400);
  return { ...input };
}

module.exports = { validateReceipt };
