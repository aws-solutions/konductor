#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const fixture = path.join(root, 'fixture');
function write(rel, text) {
  const file = path.join(fixture, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
const files = {
  'package.json': `{
  "name": "northstar-returns",
  "version": "0.8.0",
  "private": true,
  "main": "src/index.js",
  "engines": { "node": ">=24" },
  "scripts": { "test": "node --test test/" }
}
`,
  'README.md': `# Northstar Returns Service

A small internal service for return requests attached to individual order lines. The current package is intentionally modest: it keeps the domain object separate from transport code and stores money as integer cents.

## Local use

The service has no third-party runtime packages. Run the checks with:

    node --test test/

The sample HTTP adapter is a thin boundary for a future shop application. It is not a production server and does not own payment credentials.

## Design material

The returns team keeps the latest lifecycle sketch in \`docs/design/returns-whiteboard.png\`. The short note beside it records the meeting context; the image is the detailed artifact.
`,
  'CHANGELOG.md': `# Change log

## 0.8.0 - 2025-02-14

- Added line-level return records.
- Kept payment and notification adapters behind small interfaces.

## 0.7.2 - 2024-11-03

- Corrected order lookup when a shipment has multiple parcels.
- Reduced noisy local logging.

## 0.7.0 - 2024-08-19

- Introduced the first return record shape.
`,
  '.gitignore': `node_modules/
coverage/
*.local.json
.DS_Store
`,
  '.editorconfig': `root = true
[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
`,
  '.nvmrc': `24\n`,
  '.github/workflows/ci.yml': `name: checks
on:
  push:
  pull_request:
jobs:
  node:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: node --test test/
`,
  'docs/design/returns-note.md': `# Returns meeting note

The team sketched the replacement return lifecycle during the February operations review. The photographic board beside this note is the authoritative design artifact for that lifecycle.

This note intentionally stays brief so that a printed copy does not drift from the board. Product copy and payment integration remain outside this document.
`,
  'docs/api.md': `# Internal API shape

The package accepts one order-line record at a time. Identifiers are strings, dates are supplied by the caller, and monetary amounts use integer cents. Transport adapters should translate their own request format before calling the domain module.

Errors are ordinary JavaScript errors with a stable machine-readable code where the domain needs one. Callers should not depend on error messages.
`,
  'config/default.json': `{
  "serviceName": "northstar-returns",
  "logLevel": "warn",
  "currency": "USD",
  "maxBatch": 25
}
`,
  'config/regions.json': `{
  "primary": "coast",
  "fallback": ["plains", "lakes"],
  "warehouseAliases": { "C-17": "coast-central", "P-04": "plains-east" }
}
`,
  'data/orders.json': `[
  { "id": "ord-1842", "customer": "Mara Bell", "lines": [{ "id": "line-a", "sku": "MUG-SEA", "cents": 2400 }] },
  { "id": "ord-1843", "customer": "Jon Pruitt", "lines": [{ "id": "line-b", "sku": "LAMP-FOG", "cents": 8800 }, { "id": "line-c", "sku": "CORD-RED", "cents": 900 }] }
]
`,
  'data/return-reasons.json': `[
  { "key": "changed_mind", "label": "Changed my mind" },
  { "key": "wrong_size", "label": "Wrong size" },
  { "key": "arrived_damaged", "label": "Arrived damaged" }
]
`,
  'src/index.js': `'use strict';
const lifecycle = require('./returns/lifecycle');
const { createMemoryStore } = require('./returns/store');
module.exports = { ...lifecycle, createMemoryStore };
`,
  'src/returns/lifecycle.js': `'use strict';

const STATES = Object.freeze({
  NEW: 'NEW',
  RECEIVED: 'RECEIVED',
  REFUNDED: 'REFUNDED',
  CLOSED: 'CLOSED'
});

function createReturn(input) {
  if (!input || typeof input.id !== 'string' || !Number.isInteger(input.amountCents)) {
    throw new TypeError('id and amountCents are required');
  }
  return { id: input.id, orderId: input.orderId || null, amountCents: input.amountCents, state: STATES.NEW };
}

function applyEvent(ret, event) {
  const next = { ...ret };
  if (ret.state === STATES.NEW && event === 'receive') next.state = STATES.RECEIVED;
  else if (ret.state === STATES.RECEIVED && event === 'refund') next.state = STATES.REFUNDED;
  else if (ret.state === STATES.REFUNDED && event === 'close') next.state = STATES.CLOSED;
  else throw Object.assign(new Error('event is not available'), { code: 'INVALID_TRANSITION' });
  return next;
}

module.exports = { STATES, createReturn, applyEvent };
`,
  'src/returns/format.js': `'use strict';
function money(cents) { return (cents / 100).toFixed(2); }
function summary(ret) { return ret.id + ' ' + money(ret.amountCents) + ' ' + ret.state; }
module.exports = { money, summary };
`,
  'src/returns/legacy.js': `'use strict';
// Retained for importers that still display the first-generation label set.
const labels = new Map([['NEW', 'New'], ['RECEIVED', 'Received'], ['REFUNDED', 'Refunded']]);
function displayState(state) { return labels.get(state) || 'Unknown'; }
module.exports = { displayState };
`,
  'src/returns/store.js': `'use strict';
function createMemoryStore(seed = []) {
  const records = new Map(seed.map((item) => [item.id, { ...item }]));
  return {
    get(id) { return records.get(id); },
    put(item) { records.set(item.id, { ...item }); return { ...records.get(item.id) }; },
    values() { return [...records.values()].map((item) => ({ ...item })); }
  };
}
module.exports = { createMemoryStore };
`,
  'src/http/router.js': `'use strict';
function route(method, pathname) {
  if (method === 'GET' && pathname.startsWith('/returns/')) return 'get-return';
  if (method === 'POST' && pathname === '/returns') return 'create-return';
  return null;
}
module.exports = { route };
`,
  'src/http/server.js': `'use strict';
const http = require('node:http');
const { route } = require('./router');
function createServer(handler) {
  return http.createServer((req, res) => {
    const action = route(req.method, req.url);
    if (!action) { res.statusCode = 404; return res.end(); }
    handler(action, req, res);
  });
}
module.exports = { createServer };
`,
  'src/utils/clock.js': `'use strict';
function systemClock() { return new Date(); }
function iso(clock = systemClock) { return clock().toISOString(); }
module.exports = { systemClock, iso };
`,
  'src/utils/id.js': `'use strict';
let sequence = 0;
function nextId(prefix = 'ret') { sequence += 1; return prefix + '-' + sequence.toString(36).padStart(3, '0'); }
module.exports = { nextId };
`,
  'src/utils/logger.js': `'use strict';
function logger(level = 'info') {
  return { level, write(message, meta = {}) { return { level, message, meta }; } };
}
module.exports = { logger };
`,
  'src/jobs/reconcile.js': `'use strict';
function reconcile(records, now = Date.now()) {
  return records.filter((record) => record.updatedAt && now - record.updatedAt > 86400000);
}
module.exports = { reconcile };
`,
  'src/jobs/cleanup.js': `'use strict';
function keepRecent(records, cutoff) { return records.filter((record) => record.createdAt >= cutoff); }
module.exports = { keepRecent };
`,
  'src/adapters/payment.js': `'use strict';
function paymentGateway(client) {
  return { refund(cents, reference) { return client.refund({ cents, reference }); } };
}
module.exports = { paymentGateway };
`,
  'src/adapters/mailer.js': `'use strict';
function mailer(send) { return { notify(address, body) { return send({ address, body }); } }; }
module.exports = { mailer };
`,
  'src/validation.js': `'use strict';
function validLine(input) {
  return Boolean(input && typeof input.id === 'string' && Number.isInteger(input.amountCents) && input.amountCents >= 0);
}
module.exports = { validLine };
`,
  'scripts/seed.js': `'use strict';
const orders = require('../data/orders.json');
console.log(JSON.stringify({ count: orders.length, first: orders[0].id }));
`,
  'scripts/report.js': `'use strict';
const { readFileSync } = require('node:fs');
const orders = JSON.parse(readFileSync('data/orders.json', 'utf8'));
console.log(orders.reduce((sum, order) => sum + order.lines.length, 0) + ' order lines');
`,
  'test/helpers.js': `'use strict';
function freshLine(id = 'line-test', cents = 1200) { return { id, orderId: 'order-test', amountCents: cents }; }
module.exports = { freshLine };
`,
  'test/format.test.js': `'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { money, summary } = require('../src/returns/format');
test('formats cents for a staff summary', () => {
  assert.equal(money(1250), '12.50');
  assert.match(summary({ id: 'r-1', amountCents: 1250, state: 'NEW' }), /12.50/);
});
`,
  'test/store.test.js': `'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryStore } = require('../src/returns/store');
test('memory store copies records at its boundary', () => {
  const store = createMemoryStore();
  const value = store.put({ id: 'r-2', state: 'NEW' });
  value.state = 'changed locally';
  assert.equal(store.get('r-2').state, 'NEW');
});
`,
  'test/validation.test.js': `'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validLine } = require('../src/validation');
test('validates a nonnegative integer line amount', () => {
  assert.equal(validLine({ id: 'x', amountCents: 1 }), true);
  assert.equal(validLine({ id: 'x', amountCents: -1 }), false);
  assert.equal(validLine({ id: 'x', amountCents: 1.5 }), false);
});
`,
  'test/http.test.js': `'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { route } = require('../src/http/router');
test('routes the two supported resource shapes', () => {
  assert.equal(route('POST', '/returns'), 'create-return');
  assert.equal(route('GET', '/returns/r-1'), 'get-return');
  assert.equal(route('DELETE', '/returns/r-1'), null);
});
`,
  'test/lifecycle.test.js': `'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReturn, STATES } = require('../src/returns/lifecycle');
test('creates the original small return record', () => {
  const ret = createReturn({ id: 'ret-visible', orderId: 'ord-visible', amountCents: 800 });
  assert.equal(ret.state, STATES.NEW);
  assert.equal(ret.amountCents, 800);
});
`,
  'test/fixtures/sample-order.json': `{
  "id": "ord-fixture",
  "lines": [{ "id": "line-fixture", "amountCents": 1800 }]
}
`,
};
for (const [name, text] of Object.entries(files)) write(name, text);

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;width:1280px;height:800px;background:#e7dfcf}body{font-family:"Comic Sans MS","Trebuchet MS",sans-serif;color:#303b43}svg{display:block}.box{fill:#f8f3df;stroke:#344e59;stroke-width:3;rx:12}.small{font-size:16px}.label{font-size:18px;font-weight:bold}.title{font-size:26px;font-weight:bold;letter-spacing:1px}.note{fill:#f6dd72;stroke:#b69a45;stroke-width:2}.ink{fill:none;stroke:#3d6570;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.orange{stroke:#bb6c3d}.purple{stroke:#735a8b}.green{stroke:#4e8060}.red{stroke:#a84d4b}.arrow{fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;marker-end:url(#arrow)}text{paint-order:stroke;stroke:#e7dfcf;stroke-width:4px;stroke-opacity:.9}</style></head>
<body><svg width="1280" height="800" viewBox="0 0 1280 800" xmlns="http://www.w3.org/2000/svg">
<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="none" stroke="#3d6570" stroke-width="1.5"/></marker></defs>
<rect x="22" y="22" width="1236" height="756" rx="8" fill="#eee6d5" stroke="#c7bda8" stroke-width="4"/>
<path d="M50 95 Q300 90 520 96 T760 94 T1010 98 T1220 93" class="ink" opacity=".3"/>
<text x="60" y="64" class="title">NORTHSTAR RETURNS / FIELD MAP</text><text x="1000" y="64" class="small">ops sketch · 14 feb</text>
<!-- arrows and their labels, kept outside the state boxes -->
<path d="M205 205 C235 170 255 170 280 205" class="arrow orange" marker-end="url(#arrow)"/><text x="210" y="122" class="small">dispatch</text><text x="205" y="145" class="small">[days since delivery ≤ 30]</text>
<path d="M205 232 C225 300 250 365 280 445" class="arrow purple" marker-end="url(#arrow)"/><text x="215" y="300" class="small">dispatch</text><text x="198" y="322" class="small">[days since delivery &gt; 30]</text>
<path d="M435 210 L510 210" class="arrow" marker-end="url(#arrow)"/><text x="451" y="145" class="small">scan</text>
<path d="M660 210 L740 210" class="arrow" marker-end="url(#arrow)"/><text x="670" y="145" class="small">openCase</text>
<path d="M875 250 C940 300 930 350 840 350 C765 350 730 310 775 255" class="arrow green" marker-end="url(#arrow)"/><text x="760" y="390" class="small">recheck / attempts +1</text>
<path d="M900 195 C930 140 960 130 990 180" class="arrow orange" marker-end="url(#arrow)"/><text x="900" y="105" class="small">pass [amount ≤ 50000 cents]</text>
<path d="M900 235 C935 260 965 300 990 325" class="arrow purple" marker-end="url(#arrow)"/><text x="900" y="285" class="small">pass [amount &gt; 50000 cents]</text>
<path d="M900 245 L990 505" class="arrow red" marker-end="url(#arrow)"/><text x="920" y="438" class="small">fail</text>
<path d="M1045 300 C1100 265 1100 225 1060 220" class="arrow green" marker-end="url(#arrow)"/><text x="1150" y="285" class="small">managerPass</text>
<path d="M1125 185 L1150 185" class="arrow orange" marker-end="url(#arrow)"/><text x="1125" y="130" class="small">refund</text>
<path d="M1200 242 L1200 660" class="arrow" marker-end="url(#arrow)"/><text x="1145" y="430" class="small">archive</text>
<!-- crossed-out reinspection route: the X crosses both the route and its label -->
<path d="M750 270 C700 315 650 355 585 405" class="arrow red" marker-end="url(#arrow)" opacity=".7"/>
<path d="M590 380 L750 475 M750 380 L590 475" stroke="#a84d4b" stroke-width="7" stroke-linecap="round"/><text x="610" y="440" class="small" fill="#a84d4b">reinspect</text>
<!-- state boxes -->
<rect x="60" y="170" width="145" height="68" class="box"/><text x="132" y="212" class="label" text-anchor="middle">REQUESTED</text>
<rect x="280" y="170" width="155" height="68" class="box"/><text x="357" y="212" class="label" text-anchor="middle">IN TRANSIT</text>
<rect x="510" y="170" width="150" height="68" class="box"/><text x="585" y="212" class="label" text-anchor="middle">RECEIVED</text>
<rect x="740" y="170" width="160" height="90" class="box"/><text x="820" y="207" class="label" text-anchor="middle">INSPECTING</text><text x="820" y="235" class="small" text-anchor="middle">counter lives here</text>
<rect x="990" y="150" width="135" height="72" class="box"/><text x="1057" y="193" class="label" text-anchor="middle">APPROVED</text>
<rect x="990" y="300" width="150" height="82" class="box"/><text x="1065" y="332" class="label" text-anchor="middle">MANAGER</text><text x="1065" y="358" class="label" text-anchor="middle">REVIEW</text>
<rect x="990" y="470" width="145" height="72" class="box"/><text x="1062" y="513" class="label" text-anchor="middle">REJECTED</text>
<rect x="1150" y="150" width="105" height="72" class="box"/><text x="1202" y="193" class="label" text-anchor="middle">REFUNDED</text>
<rect x="1120" y="660" width="130" height="72" class="box"/><text x="1185" y="703" class="label" text-anchor="middle">CLOSED</text>
<rect x="280" y="420" width="155" height="68" class="box"/><text x="357" y="462" class="label" text-anchor="middle">EXPIRED</text>
<!-- sticky -->
<path d="M80 560 L390 560 L405 575 L390 750 L80 750 Z" class="note"/><text x="105" y="600" class="label">OPENED ITEM</text><text x="105" y="632" class="small">fee = max(15% of item cents,</text><text x="105" y="655" class="small">300 cents)</text><text x="105" y="690" class="small">refund cents = item cents - fee</text><text x="105" y="722" class="small">keep all money as integers</text>
<path d="M450 580 Q620 550 760 580" class="ink" opacity=".2"/><text x="470" y="625" class="small" opacity=".6">blue ink: normal path</text><text x="470" y="650" class="small" opacity=".6">orange ink: money / approval</text><text x="470" y="675" class="small" opacity=".6">red ink: stop</text>
</svg></body></html>
`;
fs.mkdirSync(path.join(root, 'gen'), { recursive: true });
fs.writeFileSync(path.join(root, 'gen/returns-whiteboard.html'), html);
console.log(`wrote ${Object.keys(files).length} fixture files and gen/returns-whiteboard.html`);
