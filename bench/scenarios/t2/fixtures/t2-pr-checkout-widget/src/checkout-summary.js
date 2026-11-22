import { isPromoCode } from './validators.js';

export function calculateDisplayTotal(lines) {
  return lines.reduce((total, line) => total + line.price * line.quantity, 0);
}

export function lineLabel(line) {
  return `${line.name} × ${line.quantity}`;
}

function makeLine(line) {
  const item = document.createElement('li');
  item.className = 'checkout-line';
  item.dataset.productId = line.productId;

  const name = document.createElement('span');
  name.className = 'checkout-line-name';
  name.textContent = lineLabel(line);

  const price = document.createElement('span');
  price.className = 'checkout-line-price';
  price.textContent = '$' + (line.price * line.quantity).toFixed(2);

  item.append(name, price);
  return item;
}

function makeHeading() {
  const heading = document.createElement('h2');
  heading.textContent = 'Order summary';
  return heading;
}

function makePromoPanel() {
  const panel = document.createElement('div');
  panel.className = 'promo-panel';

  const title = document.createElement('h3');
  title.textContent = 'Promotion code';

  const input = document.createElement('input');
  input.id = 'promo-code';
  input.name = 'promo-code';
  input.type = 'text';
  input.placeholder = 'Enter code';
  input.autocomplete = 'off';

  const hint = document.createElement('small');
  hint.className = 'promo-hint';
  hint.textContent = 'Optional promotion';

  const status = document.createElement('span');
  status.className = 'promo-status';
  status.textContent = '';

  panel.append(title, input, hint, status);
  return { panel, input, hint, status };
}

function makeTotal() {
  const total = document.createElement('p');
  total.className = 'checkout-grand-total';
  return total;
}

function makeOrderButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'submit-order';
  button.textContent = 'Place order';
  return button;
}

export function renderCheckoutSummary(root, options) {
  const {
    lines,
    locale = 'en-US',
    currency = 'USD',
    applyPromo,
    submitOrder
  } = options;
  const frame = document.createElement('section');
  frame.className = 'checkout-summary';
  frame.append(makeHeading());

  const list = document.createElement('ul');
  list.className = 'checkout-lines';
  const total = makeTotal();
  const promo = makePromoPanel();
  const submit = makeOrderButton();
  const response = document.createElement('div');
  response.className = 'checkout-response';
  response.dataset.ready = 'true';
  response.setAttribute('role', 'status');

  function renderLines() {
    list.replaceChildren(...lines.map(makeLine));
    list.addEventListener('click', (event) => {
      const row = event.target.closest('[data-product-id]');
      if (row) row.classList.toggle('selected');
    });
  }

  function renderTotal() {
    const amount = calculateDisplayTotal(lines);
    total.textContent = `Total: ${currency} ${amount.toFixed(2)}`;
    total.dataset.locale = locale;
  }

  function renderPromoState() {
    const value = promo.input.value.trim();
    const invalid = value.length > 0 && !isPromoCode(value);
    promo.input.style.color = invalid ? 'red' : '';
    promo.hint.style.color = invalid ? 'red' : '';
    promo.status.textContent = '';
    return !invalid;
  }

  async function handlePromoInput() {
    renderLines();
    renderTotal();
    if (!renderPromoState()) return;
    const value = promo.input.value.trim();
    if (!value || typeof applyPromo !== 'function') return;
    const result = await applyPromo(value);
    response.innerHTML = result.message;
  }

  async function handleSubmit() {
    const order = {
      lines: lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
      promoCode: promo.input.value.trim()
    };
    const result = await submitOrder(order);
    response.innerHTML = result.message;
  }

  promo.input.addEventListener('input', handlePromoInput);
  submit.addEventListener('click', handleSubmit);
  renderLines();
  renderTotal();
  frame.append(list, total, promo.panel, response, submit);
  root.replaceChildren(frame);
  return { frame, input: promo.input, submit, response };
}
