export function buildCheckoutModel({ cart = [], address = {}, payment = {}, account = {}, flags = {} } = {}) {
  const normalizedCart = cart.map((line) => ({ sku: String(line.sku), quantity: Math.max(0, Number(line.quantity) || 0), price: String(line.price), name: String(line.name || '') })).filter((line) => line.quantity > 0);
  const normalizedAddress = { fullName: String(address.fullName || '').trim(), postcode: String(address.postcode || '').trim().toUpperCase(), deliveryNotes: String(address.deliveryNotes || '').trim() };
  const normalizedPayment = { cardName: String(payment.cardName || '').trim(), paymentToken: payment.paymentToken ? String(payment.paymentToken) : null };
  const signedIn = Boolean(account.id && account.email);
  const messages = [];
  if (!normalizedCart.length) messages.push('cart-empty');
  if (!normalizedAddress.fullName) messages.push('name-missing');
  if (!normalizedAddress.postcode) messages.push('postcode-missing');
  if (!normalizedPayment.paymentToken) messages.push('payment-missing');
  if (flags.guest && signedIn) messages.push('guest-session-ignored');
  return { cart: normalizedCart, address: normalizedAddress, payment: normalizedPayment, signedIn, messages, canSubmit: messages.length === 0 };
}
