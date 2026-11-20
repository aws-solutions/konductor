const pause = (value) => new Promise((resolve) => setTimeout(resolve, value));

export async function checkPostcode(postcode) {
  await pause(20);
  return { postcode, deliverable: postcode.trim().length >= 4 };
}

export async function placeOrder(payload) {
  await pause(25);
  if (!payload?.paymentToken) throw new Error('Payment was declined');
  return { orderId: `NS-${String(Date.now()).slice(-6)}`, sessionToken: `st-${String(Date.now()).slice(-8)}`, state: 'accepted' };
}

export async function fetchOrderStatus(orderId) {
  await pause(15);
  return { orderId, state: 'packing', updatedAt: Date.now() };
}
