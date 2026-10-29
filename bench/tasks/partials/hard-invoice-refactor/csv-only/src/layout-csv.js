'use strict';

const { plainAmount } = require('./money');

const field = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function renderCsv(calc) {
  const amount = (n) => plainAmount(n, calc.cur);
  const rows = [['sku', 'description', 'qty', 'unit_price', 'discount', 'net']];
  for (const { l, disc, net } of calc.rows) {
    rows.push([l.sku, l.description, String(l.qty), amount(l.unitPrice), amount(disc), amount(net)]);
  }
  for (const [name, value] of [['subtotal', calc.subtotal], ['tax', calc.tax], ['shipping', calc.shipping], ['total', calc.total]]) {
    rows.push([name, '', '', '', '', amount(value)]);
  }
  return rows.map((r) => `${r.map(field).join(',')}\r\n`).join('');
}

module.exports = { renderCsv };
