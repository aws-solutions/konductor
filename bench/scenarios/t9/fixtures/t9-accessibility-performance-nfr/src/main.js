import { orders } from '../data/orders.js';
import { filterOrders } from './filter.js';
import { renderRows } from './render.js';
import { $ } from './dom.js';

const state = { query: '', status: 'all', from: '', to: '' };

const tbody = $('#order-rows');
const searchBox = $('#search');
const chips = document.querySelectorAll('.chip');
const dateForm = $('#date-form');
const fromInput = $('#date-from');
const toInput = $('#date-to');
const summary = $('#summary');

function refresh() {
  const matches = filterOrders(orders, state);
  renderRows(tbody, matches);
  summary.textContent = `${matches.length} of ${orders.length} orders`;
}

searchBox.addEventListener('input', () => {
  state.query = searchBox.value;
  refresh();
});

chips.forEach((chip) => {
  chip.addEventListener('click', () => {
    chips.forEach((c) => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    state.status = chip.dataset.status;
    refresh();
  });
});

dateForm.addEventListener('submit', (event) => {
  event.preventDefault();
  state.from = fromInput.value;
  state.to = toInput.value;
  refresh();
});

refresh();
