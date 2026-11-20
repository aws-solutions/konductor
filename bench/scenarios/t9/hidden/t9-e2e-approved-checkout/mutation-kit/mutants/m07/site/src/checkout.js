import { STARTING_BASKET, MAX_QUANTITY } from './catalog.js';
import { summarise, findCode, SHIPPING } from './pricing.js';
import { money, validate } from './format.js';

const state = {
  lines: STARTING_BASKET.map((l) => ({ ...l })),
  method: 'standard',
  promo: null,
};

const $ = (sel) => document.querySelector(sel);

function renderLines() {
  const list = $('#basket-lines');
  list.textContent = '';
  for (const line of state.lines) {
    const li = document.createElement('li');
    li.className = 'basket-line';
    const name = document.createElement('span');
    name.className = 'basket-line__name';
    name.textContent = line.name;
    const qtyLabel = document.createElement('label');
    qtyLabel.className = 'basket-line__qty';
    qtyLabel.textContent = 'Quantity ';
    const qty = document.createElement('input');
    qty.type = 'number';
    qty.min = '1';
    qty.max = String(MAX_QUANTITY);
    qty.value = String(line.quantity);
    qty.setAttribute('aria-label', `Quantity for ${line.name}`);
    qty.addEventListener('input', () => {
      const n = Number.parseInt(qty.value, 10);
      if (Number.isInteger(n) && n >= 1 && n <= MAX_QUANTITY) {
        line.quantity = n;
        renderSummary();
      }
    });
    qtyLabel.append(qty);
    const price = document.createElement('span');
    price.className = 'basket-line__price';
    price.textContent = money(line.unitPence * line.quantity);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', `Remove ${line.name}`);
    remove.addEventListener('click', () => {
      state.lines = state.lines.filter((l) => l.sku !== line.sku);
      render();
    });
    li.append(name, qtyLabel, price, remove);
    list.append(li);
  }
  const empty = state.lines.length === 0;
  $('#basket-empty').hidden = !empty;
  $('#place-order').disabled = empty;
}

function renderSummary() {
  const s = summarise(state.lines, state.method, state.promo);
  $('#sum-subtotal').textContent = money(s.subtotal);
  $('#sum-shipping').textContent = s.shipping === 0 ? 'Free' : money(s.shipping);
  $('#row-discount').hidden = s.discount === 0;
  $('#sum-discount').textContent = money(-s.discount);
  $('#sum-total').textContent = money(s.total);
  for (const li of document.querySelectorAll('.basket-line')) {
    const line = state.lines.find((l) => li.querySelector('.basket-line__name').textContent === l.name);
    if (line) li.querySelector('.basket-line__price').textContent = money(line.unitPence * line.quantity);
  }
  return s;
}

function render() {
  renderLines();
  renderSummary();
}

function applyPromo(event) {
  event.preventDefault();
  const input = $('#promo-code');
  const msg = $('#promo-message');
  const promo = findCode(input.value);
  if (!promo) {
    state.promo = null;
    msg.textContent = 'That code is not valid';
    msg.setAttribute('role', 'alert');
  } else {
    state.promo = promo;
    msg.textContent = `Code ${promo.code} applied: ${promo.text}`;
    msg.setAttribute('role', 'status');
  }
  renderSummary();
}

function showErrors(errors) {
  for (const field of ['name', 'email', 'postcode']) {
    const input = $(`#f-${field}`);
    const err = $(`#err-${field}`);
    if (errors[field]) {
      input.setAttribute('aria-invalid', 'true');
      err.textContent = errors[field];
      err.hidden = false;
    } else {
      input.removeAttribute('aria-invalid');
      err.textContent = '';
      err.hidden = true;
    }
  }
}

function placeOrder(event) {
  event.preventDefault();
  const form = { name: $('#f-name').value, email: $('#f-email').value, postcode: $('#f-postcode').value };
  const errors = validate(form);
  showErrors(errors);
  const first = Object.keys(errors)[0];
  if (first) {
    $(`#f-${first}`).focus();
  }
  const s = summarise(state.lines, state.method, state.promo);
  $('#checkout').hidden = true;
  const done = $('#confirmation');
  done.hidden = false;
  $('#confirm-total').textContent = money(s.total);
  $('#confirm-email').textContent = form.email.trim();
  done.querySelector('h2').focus();
}

function init() {
  for (const [key, opt] of Object.entries(SHIPPING)) {
    const radio = $(`#ship-${key}`);
    radio.nextElementSibling.textContent = opt.label;
    radio.addEventListener('change', () => {
      if (radio.checked) {
        state.method = key;
        renderSummary();
      }
    });
  }
  $('#promo-form').addEventListener('submit', applyPromo);
  $('#details-form').addEventListener('submit', placeOrder);
  render();
}

init();
