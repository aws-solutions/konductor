const Stripe = require('stripe');
const store = require('./store');
const stripe = new Stripe(process.env.STRIPE_KEY);

async function checkout(userId, cart, paymentMethodId) {
  const amount = cart.items.reduce((sum, i) => sum + i.price * i.qty, 0);
  try {
    const intent = await stripe.paymentIntents.create({ amount, currency: 'usd', payment_method: paymentMethodId, confirm: true });
    return store.saveOrder({ userId, amount, intentId: intent.id });
  } catch (err) {
    if (err.type === 'StripeCardError') {
      const e = new Error('Your card was declined.');
      e.status = 402;
      throw e;
    }
    throw err;
  }
}

module.exports = { checkout };
