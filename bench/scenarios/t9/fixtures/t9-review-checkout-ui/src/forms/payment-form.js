import { placeOrder } from '../api/checkout-api.js';

export function renderPaymentForm(form) {
  form.innerHTML = `
    <div class="field"><label for="card-number">Card number</label><input id="card-number" inputmode="numeric" autocomplete="cc-number" required></div>
    <div class="field"><label for="card-name">Name on card</label><input id="card-name" required></div>
    <button type="submit" data-action="pay">Place order</button>`;
}

export function bindPaymentForm(form, getPayload, onSuccess, onError) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = await placeOrder(getPayload());
    if (result.orderId) onSuccess(result);
    else onError(new Error('Could not place order'));
  });
}
