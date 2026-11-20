import { orders } from '../data/orders.js';
import { filterOrders } from './filter.js';
import { renderRows, appendRows } from './render.js';
import { createSearch } from './search.js';
import { $ } from './dom.js';

const state = { status: 'all', from: '', to: '' };
let found = orders;
let current = orders;
let shown = 50;

const tbody = $('#order-rows');
const searchBox = $('#search');
const fromInput = $('#date-from');
const toInput = $('#date-to');
const fromError = $('#date-from-error');
const toError = $('#date-to-error');
const live = $('#summary');
const moreButton = $('#show-more');

function refresh() {
  current = filterOrders(found, state);
  renderRows(tbody, current.slice(0, shown));
  live.textContent = `${current.length} orders shown`;
  moreButton.hidden = shown >= current.length;
}

const search = createSearch({
  orders,
  onResults(matches) {
    found = matches;
    refresh();
  },
});

searchBox.addEventListener('input', () => search.setQuery(searchBox.value));
searchBox.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') search.submit();
});

document.querySelectorAll('input[name="status"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    state.status = radio.value;
    refresh();
  });
});

const isDate = (text) => text.trim() === '' || !Number.isNaN(Date.parse(text));

function mark(input, box, message) {
  box.textContent = message;
  box.hidden = !message;
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

$('#date-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const from = fromInput.value;
  const to = toInput.value;
  let bad = false;
  if (!isDate(from)) { mark(fromInput, fromError, 'From is not a valid date.'); bad = true; }
  if (!isDate(to)) { mark(toInput, toError, 'To is not a valid date.'); bad = true; }
  if (!bad && from && to && Date.parse(to) < Date.parse(from)) {
    mark(toInput, toError, 'To must not be before From.');
    bad = true;
  }
  if (bad) return;
  state.from = from;
  state.to = to;
  refresh();
});

toInput.addEventListener('input', () => mark(toInput, toError, ''));
fromInput.addEventListener('input', () => mark(fromInput, fromError, ''));

moreButton.addEventListener('click', () => {
  appendRows(tbody, current.slice(shown, shown + 50));
  shown += 50;
  moreButton.hidden = shown >= current.length;
});

refresh();
