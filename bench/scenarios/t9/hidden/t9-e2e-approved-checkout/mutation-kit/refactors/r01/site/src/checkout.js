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
  const list = $('#cart-items');
  list.textContent = '';
  for (const line of state.lines) {
    const li = document.createElement('li');
    li.className = 'item-row';
    const name = document.createElement('span');
    name.className = 'item-title';
    name.textContent = line.name;
    const qtyLabel = document.createElement('label');
    qtyLabel.className = 'item-count';
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
    price.className = 'item-cost';
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
  $('#cart-empty-note').hidden = !empty;
  $('#submit-order').disabled = empty;
}

function renderSummary() {
  const s = summarise(state.lines, state.method, state.promo);
  $('#total-sub').textContent = money(s.subtotal);
  $('#total-ship').textContent = s.shipping === 0 ? 'Free' : money(s.shipping);
  $('#line-off').hidden = s.discount === 0;
  $('#total-off').textContent = money(-s.discount);
  $('#total-grand').textContent = money(s.total);
  for (const li of document.querySelectorAll('.item-row')) {
    const line = state.lines.find((l) => li.querySelector('.item-title').textContent === l.name);
    if (line) li.querySelector('.item-cost').textContent = money(line.unitPence * line.quantity);
  }
  return s;
}

function render() {
  renderLines();
  renderSummary();
}

function applyPromo(event) {
  event.preventDefault();
  const input = $('#voucher');
  const msg = $('#voucher-note');
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
    const input = $(`#in-${field}`);
    const err = $(`#msg-${field}`);
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
  const form = { name: $('#in-name').value, email: $('#in-email').value, postcode: $('#in-postcode').value };
  const errors = validate(form);
  showErrors(errors);
  const first = Object.keys(errors)[0];
  if (first) {
    $(`#in-${first}`).focus();
    return;
  }
  const s = summarise(state.lines, state.method, state.promo);
  $('#shop').hidden = true;
  const done = $('#thanks');
  done.hidden = false;
  $('#thanks-total').textContent = money(s.total);
  $('#thanks-email').textContent = form.email.trim();
  done.querySelector('h2').focus();
}

function init() {
  for (const [key, opt] of Object.entries(SHIPPING)) {
    const radio = $(`#speed-${key === 'standard' ? 'std' : 'exp'}`);
    radio.nextElementSibling.textContent = opt.label;
    radio.addEventListener('change', () => {
      if (radio.checked) {
        state.method = key;
        renderSummary();
      }
    });
  }
  $('#voucher-form').addEventListener('submit', applyPromo);
  $('#buyer-form').addEventListener('submit', placeOrder);
  render();
}

init();
