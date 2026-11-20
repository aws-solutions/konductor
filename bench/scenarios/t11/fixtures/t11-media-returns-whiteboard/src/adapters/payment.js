'use strict';
function paymentGateway(client) {
  return { refund(cents, reference) { return client.refund({ cents, reference }); } };
}
module.exports = { paymentGateway };
