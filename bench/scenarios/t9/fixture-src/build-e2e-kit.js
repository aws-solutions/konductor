#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// Builds the mutation kit of t9-e2e-approved-checkout (hidden/<id>/mutation-kit/) from fixture-src/checkout-e2e:
// pristine copies of the page, one browser-visible regression per mutant, and one safe refactor that renames every
// id and class (the request says those will change; labels, roles and text stay). The shared mutant runner
// (lib/hidden/mutants.js) runs the agent's end-to-end suite against each. No model, no network.
//   node bench/scenarios/t9/fixture-src/build-e2e-kit.js

const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, 'checkout-e2e', 'site');
const KIT = path.join(__dirname, '..', 'hidden', 't9-e2e-approved-checkout', 'mutation-kit');
const JS = 'site/src/checkout.js';
const HTML = 'site/index.html';
const CSS = 'site/styles.css';
const read = (rel) => fs.readFileSync(path.join(SRC, rel.replace(/^site\//, '')), 'utf8');

function edit(text, from, to) {
  if (!text.includes(from)) throw new Error(`mutant edit not found: ${from}`);
  return text.replace(from, to);
}

// Each mutant: one regression a shopper would see, in the page code only (the unit-tested rules stay right).
const MUTANTS = [
  ['m01', 'a quantity change no longer updates the prices', [JS, "line.quantity = n;\n        renderSummary();", 'line.quantity = n;']],
  ['m02', 'Remove takes out the first line, not the one clicked', [JS, 'state.lines = state.lines.filter((l) => l.sku !== line.sku);', 'state.lines = state.lines.slice(1);']],
  ['m03', 'the total on the page ignores the discount', [JS, "$('#sum-total').textContent = money(s.total);", "$('#sum-total').textContent = money(s.subtotal + s.shipping);"]],
  ['m04', 'an unknown code shows no message', [JS, "msg.textContent = 'That code is not valid';", "msg.textContent = '';"]],
  ['m05', 'an unknown code keeps the code applied before', [JS, '  if (!promo) {\n    state.promo = null;', '  if (!promo) {']],
  ['m06', 'choosing express delivery does not change the summary', [JS, 'state.method = key;', "state.method = 'standard';"]],
  ['m07', 'an order with bad details still goes through', [JS, "    $(`#f-${first}`).focus();\n    return;", '    $(`#f-${first}`).focus();']],
  ['m08', 'an empty basket can still be ordered', [JS, "$('#place-order').disabled = empty;", "$('#place-order').disabled = false;"]],
  ['m09', 'the confirmation shows the subtotal as the order total', [JS, "$('#confirm-total').textContent = money(s.total);", "$('#confirm-total').textContent = money(s.subtotal);"]],
  ['m10', 'focus stays on the button when details are bad', [JS, "    $(`#f-${first}`).focus();\n", '']],
];

// The safe refactor: every id and class renamed in the page, script and styles.
const RENAMES = [
  ['basket-lines', 'cart-items'], ['basket-empty', 'cart-empty-note'], ['place-order', 'submit-order'], ['sum-subtotal', 'total-sub'],
  ['sum-shipping', 'total-ship'], ['row-discount', 'line-off'], ['sum-discount', 'total-off'], ['sum-total', 'total-grand'],
  ['promo-code', 'voucher'], ['promo-message', 'voucher-note'], ['promo-form', 'voucher-form'], ['details-form', 'buyer-form'],
  ['confirmation', 'thanks'], ['confirm-total', 'thanks-total'], ['confirm-email', 'thanks-email'], ['ship-standard', 'speed-std'],
  ['ship-express', 'speed-exp'], ['basket-line__name', 'item-title'], ['basket-line__price', 'item-cost'], ['basket-line__qty', 'item-count'],
  ['basket-line', 'item-row'], ['basket-heading', 'h-cart'], ['ship-heading', 'h-speed'], ['promo-heading', 'h-voucher'], ['details-heading', 'h-buyer'],
  ["'#f-${first}'", "'#in-${first}'"], ['#f-${', '#in-${'], ['#err-${', '#msg-${'], ['f-name', 'in-name'], ['f-email', 'in-email'],
  ['f-postcode', 'in-postcode'], ['err-name', 'msg-name'], ['err-email', 'msg-email'], ['err-postcode', 'msg-postcode'], ['#checkout', '#shop'],
  ['id="checkout"', 'id="shop"'], ["`#ship-${key}`", "`#speed-${key === 'standard' ? 'std' : 'exp'}`"], ['class="summary"', 'class="totals"'], ['.summary', '.totals'],
  ['class="shipping"', 'class="speeds"'], ['class="promo"', 'class="voucher-box"'], ['class="basket"', 'class="cart"'], ['.basket ', '.cart '],
  ['class="field"', 'class="row"'], ['class="error"', 'class="msg"'], ['.error', '.msg'], ['class="site-header"', 'class="top"'], ['.site-header', '.top'],
];
const renamed = (text) => RENAMES.reduce((t, [a, b]) => t.split(a).join(b), text);

function write(rel, text) {
  fs.mkdirSync(path.dirname(path.join(KIT, rel)), { recursive: true });
  fs.writeFileSync(path.join(KIT, rel), text);
}

fs.rmSync(KIT, { recursive: true, force: true });
for (const rel of [JS, HTML, CSS]) write(`pristine/${rel}`, read(rel));
for (const [id, , [file, from, to]] of MUTANTS) write(`mutants/${id}/${file}`, edit(read(file), from, to));
for (const rel of [JS, HTML, CSS]) write(`refactors/r01/${rel}`, renamed(read(rel)));
const cfg = {
  runner: 'node',
  testCmd: 'node --test --test-timeout=20000 e2e/*.e2e.test.js',
  baseTests: 8,
  suiteSec: 25,
  pristine: [JS, HTML, CSS],
  refactors: [{ id: 'r01', files: [JS, HTML, CSS], note: 'every id and class renamed; labels, roles and text unchanged' }],
  mutants: MUTANTS.map(([id, note, [file]]) => ({ id, files: [file], note })),
};
write('mutants.json', `${JSON.stringify(cfg, null, 2)}\n`);
console.log(`wrote ${MUTANTS.length} mutants and 1 refactor to ${path.relative(process.cwd(), KIT)}`);
