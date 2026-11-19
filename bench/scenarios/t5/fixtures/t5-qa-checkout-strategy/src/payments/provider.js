class PaymentProvider {
  constructor() {
    this.charges = [];
    this.refunds = [];
  }

  async charge(request) {
    this.charges.push({ ...request });
    return { id: `ch_${this.charges.length}`, status: 'succeeded', amount: request.amount };
  }

  async refund(request) {
    this.refunds.push({ ...request });
    return { id: `rf_${this.refunds.length}`, status: 'succeeded', amount: request.amount };
  }
}

module.exports = { PaymentProvider };
