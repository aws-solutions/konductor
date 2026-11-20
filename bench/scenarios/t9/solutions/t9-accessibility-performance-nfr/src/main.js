import { orders } from '../data/orders.js';
import { filterOrders } from './filter.js';
import { renderRows, appendRows } from './render.js';
import { createSearch } from './search.js';
import { createPager } from './pager.js';
import { validateRange } from './range.js';
import { $ } from './dom.js';

const state = { status: 'all', from: '', to: '' };
let queryMatches = orders;
let current = orders;
const pager = createPager();

const tbody = $('#order-rows');
const searchBox = $('#search');
const statusRadios = document.querySelectorAll('input[name="status"]');
const dateForm = $('#date-form');
const fromInput = $('#date-from');
const toInput = $('#date-to');
const fromError = $('#date-from-error');
const toError = $('#date-to-error');
const live = $('#summary');
const moreButton = $('#show-more');

function updateMoreButton() {
  moreButton.hidden = !pager.hasMore;
}

// Rebuilds the visible rows from the first page and announces the match count.
function refresh() {
  current = filterOrders(queryMatches, state);
  pager.reset(current.length);
  renderRows(tbody, current.slice(0, pager.shown));
  live.textContent = `${current.length} orders shown`;
  updateMoreButton();
}

const search = createSearch({
  orders,
  delayMs: 200,
  onResults(matches) {
    queryMatches = matches;
    refresh();
  },
});

searchBox.addEventListener('input', () => search.setQuery(searchBox.value));
searchBox.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    search.submit();
  }
});

statusRadios.forEach((radio) => {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    state.status = radio.value;
    refresh();
  });
});

function showErrors(errors) {
  const pairs = [[fromInput, fromError, errors.from], [toInput, toError, errors.to]];
  for (const [input, box, message] of pairs) {
    box.textContent = message;
    box.hidden = !message;
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
}

dateForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const errors = validateRange(fromInput.value, toInput.value);
  showErrors(errors);
  if (errors.from || errors.to) return;
  state.from = fromInput.value;
  state.to = toInput.value;
  refresh();
});

// Once a message is showing, typing a fix takes it away as soon as the text is valid.
[fromInput, toInput].forEach((input) => {
  input.addEventListener('input', () => {
    if (fromInput.getAttribute('aria-invalid') || toInput.getAttribute('aria-invalid')) {
      showErrors(validateRange(fromInput.value, toInput.value));
    }
  });
});

moreButton.addEventListener('click', () => {
  const [start, end] = pager.more();
  appendRows(tbody, current.slice(start, end));
  updateMoreButton();
});

refresh();
