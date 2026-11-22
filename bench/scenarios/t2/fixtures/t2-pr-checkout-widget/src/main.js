import catalog from '../data/catalog.json' with { type: 'json' };
import { readCart } from './storage.js';
import { renderCheckoutPage } from './checkout-page.js';

const checkout = document.querySelector('[data-checkout]');
if (checkout) {
  renderCheckoutPage(checkout, readCart(), catalog);
}
