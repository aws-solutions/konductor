'use strict';

const { ValidationError } = require('../errors');

class PaymentGatewayAdapter {
  constructor(client) { this.client = client; }
  charge(request) {
    if (!request || !request.invoiceId || !Number.isInteger(request.amountCents)) throw new ValidationError('charge request is invalid');
    try {
      const result = this.client.createCharge({ amount: request.amountCents, token: request.token, metadata: { invoiceId: request.invoiceId } });
      return { status: result.ok ? 'succeeded' : 'failed', retryable: result.retryable === true, code: result.code || null, providerId: result.id || null };
    } catch (error) {
      return { status: 'failed', retryable: error.retryable === true, code: error.code || 'provider_error', providerId: null };
    }
  }
  refund(request) {
    const result = this.client.createRefund({ chargeId: request.providerId, amount: request.amountCents });
    return { status: result.ok ? 'succeeded' : 'failed', providerId: result.id || null };
  }
}

module.exports = { PaymentGatewayAdapter };
