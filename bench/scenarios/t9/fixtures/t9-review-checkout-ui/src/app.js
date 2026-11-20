import catalog from '../data/catalog.json' with { type: 'json' };
import { renderCartPanel } from './ui/cart-panel.js';
import { renderAddressFields, bindAddressForm } from './forms/address-form.js';
import { renderPaymentForm, bindPaymentForm } from './forms/payment-form.js';
import { openModal } from './ui/modal.js';
import { mountToast } from './ui/toast.js';
import { saveSession } from './session.js';

const cart = catalog.slice(0, 2).map((product) => ({ ...product, quantity: 1 }));
const cartRoot = document.querySelector('#cart-panel');
const addressForm = document.querySelector('#address-form');
const paymentForm = document.querySelector('#payment-form');
const modalRoot = document.querySelector('#modal-root');
const toastRoot = document.querySelector('#toast-root');
renderCartPanel(cartRoot, cart);
renderAddressFields(addressForm);
renderPaymentForm(paymentForm);
bindAddressForm(addressForm, () => mountToast(toastRoot, 'Address accepted'));
bindPaymentForm(paymentForm, () => ({ paymentToken: paymentForm.elements['card-number'].value }), (result) => {
  saveSession({ orderId: result.orderId, accessToken: result.sessionToken });
  mountToast(toastRoot, 'Order received');
}, (error) => openModal(modalRoot, 'Payment problem', error.message));
