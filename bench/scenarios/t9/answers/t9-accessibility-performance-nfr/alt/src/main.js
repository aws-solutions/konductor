import { orders } from '../data/orders.js';
import { filterOrders } from './filter.js';
import { createSearch } from './search.js';
import { rangeProblems } from './date-range.js';
import { createResultsView } from './results-view.js';
import { $ } from './dom.js';

const controls = { status: 'all', from: '', to: '' };
let searched = orders;

const announce = $('#count-live');
const view = createResultsView({
  tbody: $('#order-rows'),
  moreButton: $('#more-rows'),
  onChange: ({ total }) => { announce.textContent = `${total} orders shown`; },
});

const redraw = () => view.show(filterOrders(searched, controls));

const search = createSearch({
  orders,
  delayMs: 200,
  onResults: (found) => { searched = found; redraw(); },
});

const box = $('#search');
box.addEventListener('input', () => search.setQuery(box.value));
box.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  search.submit();
});

$('#status-group').addEventListener('change', (e) => {
  if (e.target.name !== 'status') return;
  controls.status = e.target.value;
  redraw();
});

const fields = {
  from: { input: $('#date-from'), note: $('#from-note') },
  to: { input: $('#date-to'), note: $('#to-note') },
};

function paint(problems) {
  for (const [name, { input, note }] of Object.entries(fields)) {
    const mine = problems.filter((p) => p.field === name);
    note.textContent = mine.map((p) => p.text).join(' ');
    note.hidden = mine.length === 0;
    input.setAttribute('aria-invalid', mine.length ? 'true' : 'false');
  }
}

function currentProblems() {
  return rangeProblems(fields.from.input.value, fields.to.input.value);
}

$('#date-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const problems = currentProblems();
  paint(problems);
  if (problems.length) return;
  controls.from = fields.from.input.value;
  controls.to = fields.to.input.value;
  redraw();
});

for (const { input } of Object.values(fields)) {
  input.addEventListener('input', () => {
    if (document.querySelector('[aria-invalid="true"]')) paint(currentProblems());
  });
}

redraw();
