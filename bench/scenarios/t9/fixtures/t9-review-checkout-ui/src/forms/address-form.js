import { checkPostcode } from '../api/checkout-api.js';

export function renderAddressFields(form, value = {}) {
  form.innerHTML = `
    <div class="field"><label for="full-name">Full name</label><input id="full-name" name="fullName" value="${value.fullName || ''}" required></div>
    <div class="field"><label for="postcode">Postcode</label><input id="postcode" name="postcode" value="${value.postcode || ''}" required></div>
    <div class="field"><input id="delivery-notes" name="deliveryNotes" placeholder="Delivery notes (optional)"></div>
    <button type="button" data-action="check-address">${value.checking ? 'Checking…' : 'Continue'}</button>`;
}

export function bindAddressForm(form, onReady) {
  form.addEventListener('click', async (event) => {
    if (!event.target.matches('[data-action="check-address"]')) return;
    const postcode = form.elements.postcode.value;
    const result = await checkPostcode(postcode);
    if (result.deliverable) onReady(new FormData(form));
  });
}
