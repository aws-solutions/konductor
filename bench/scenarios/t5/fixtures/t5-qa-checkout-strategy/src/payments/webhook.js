const { validSignature } = require('./signature');

function handleWebhook(request, state, secret) {
  if (!validSignature(request.rawBody, request.signature, secret)) {
    return { accepted: false, reason: 'bad_signature' };
  }
  const event = JSON.parse(request.rawBody);
  if (event.type === 'charge.succeeded') {
    state.orders[event.data.orderId] = { paymentId: event.data.chargeId, paid: true };
  } else if (event.type === 'charge.failed') {
    state.orders[event.data.orderId] = { paymentId: event.data.chargeId, paid: false };
  }
  return { accepted: true };
}

module.exports = { handleWebhook };
