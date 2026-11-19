#!/usr/bin/env python3
"""Create the invented catalog-service fixture deterministically."""
from pathlib import Path
import csv
import json
import random

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "fixture"
random.seed(7421)


def write(rel, text):
    p = FIX / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text.rstrip() + "\n", encoding="utf-8")


# Repository metadata and guidance.
write("README.md", """# Harbor Catalog service

This folder is a snapshot of the Harbor Catalog Node.js service and its planning exports, as of **2027-04-12 (Monday)**. The requested change is described in `docs/requests/multi-currency-prices.md`. Read the repository files as source material; do not edit this snapshot.

## What is here

- `src/` contains the HTTP handlers, catalog service, persistence adapter, response formatting, notifications, exports, and cache.
- `src/app.js` starts request dispatch; `src/server.js` starts the process; `src/config.js` holds runtime defaults.
- `src/http/products-route.js` handles the product endpoint and `src/http/serializers/product.js` shapes responses.
- `src/services/catalog-service.js` coordinates reads, `src/services/money.js` formats amounts, and `src/validation/currency.js` checks currency codes.
- `src/storage/db.js` provides the database client seam and `src/storage/product-repository.js` reads products.
- `src/cache/product-cache.js` stores in-process product results; `src/export/products-csv.js` writes partner rows; `src/notifications/price-email.js` renders notices.
- `src/legacy/pricing-legacy.js` is an older pricing module kept in the source tree.
- `tests/` contains unit and integration tests. `tests/helpers/fake-db.js` provides a database stub and `tests/helpers/product-fixture.js` builds products.
- `tests/fixtures/products.json` contains sample products; the files under `tests/unit/` cover money, cache, catalog, and repository behavior; the files under `tests/integration/` cover the route, export, and notification boundaries.
- `db/migrations/001_create_products.sql` through `004_create_audit_log.sql` are the current SQL migrations.
- `docs/architecture.md` describes component boundaries; `docs/data-dictionary.md` describes stored amounts; `docs/estimate-guide.md` gives estimates; `docs/roadmap.csv` gives release targets; `docs/team-calendar.csv` gives delivery windows; and `docs/requests/` contains the feature request.
- `docs/notes/weekly-01.md` through `weekly-08.md` are routine weekly notes.
- `package.json` and `package-lock.json` define the Node project; `.github/workflows/test.yml` runs tests; `scripts/lint-check.js` runs the lightweight lint check.
- `data/work-items.csv` is a noisy export of project work items. Its columns are `id`, `status`, `title`, `estimate_points`, `owner`, `updated`, and `comments`. Statuses `Open`, `In Progress`, and `Ready` count as unfinished work. `Closed` and `Cancelled` do not. Empty estimates are not usable estimates.
- `docs/estimate-guide.md` defines the team's point-to-work-day conversion. A work day means a normal Monday-Friday day.
- `docs/team-calendar.csv` lists the two-week delivery windows, capacity, and holidays. A holiday removes one work day from capacity. The calendar is dated 2027; each sprint starts on a Monday and ends on a Friday, with the listed start and end dates.
- `docs/roadmap.csv` is the current release view; its status values are not a substitute for the work-item status rules above.

Names in exports are matched after trimming spaces and ignoring case. A blank comment is ordinary export noise. The files include closed, cancelled, stale, and unrelated rows because this is a direct export rather than a curated backlog.

The service uses Node.js 20, CommonJS modules, PostgreSQL, and the built-in test runner. Amounts are integer minor units. Existing product amounts are in USD. API examples and tests use the same convention unless a document says otherwise.
""")
write("package.json", """{
  "name": "harbor-catalog-service",
  "version": "3.8.0",
  "private": true,
  "type": "commonjs",
  "engines": { "node": ">=20" },
  "scripts": { "test": "node --test", "lint": "node scripts/lint-check.js", "start": "node src/server.js" }
}""")
write("package-lock.json", """{
  "name": "harbor-catalog-service",
  "version": "3.8.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": { "": { "name": "harbor-catalog-service", "version": "3.8.0", "engines": { "node": ">=20" } } }
}""")
write(".gitignore", """node_modules/
.env
coverage/
.tmp/
""")
write(".github/workflows/test.yml", """name: catalog-check
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm test
""")

# Small, coherent service files.
write("src/config.js", """module.exports = {
  port: Number(process.env.PORT || 4100),
  defaultCurrency: 'USD',
  supportedCurrencies: ['USD']
};
""")
write("src/server.js", """const { createApp } = require('./app');
const config = require('./config');

if (require.main === module) createApp().listen(config.port);
module.exports = { createApp };
""")
write("src/app.js", """const http = require('node:http');
const { listProducts } = require('./http/products-route');

function createApp() {
  return http.createServer(async (req, res) => {
    if (req.url.startsWith('/v1/products')) return listProducts(req, res);
    res.writeHead(404, {'content-type': 'application/json'});
    res.end(JSON.stringify({error: 'not_found'}));
  });
}
module.exports = { createApp };
""")
write("src/http/products-route.js", """const { getProducts } = require('../services/catalog-service');

async function listProducts(_req, res) {
  try {
    const products = await getProducts();
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify({ data: products }));
  } catch (err) {
    res.writeHead(500, {'content-type': 'application/json'});
    res.end(JSON.stringify({ error: err.code || 'internal_error' }));
  }
}
module.exports = { listProducts };
""")
write("src/http/serializers/product.js", """const { formatMoney } = require('../../services/money');

function serializeProduct(product) {
  return { id: product.id, name: product.name, price: formatMoney(product.price_minor) };
}
module.exports = { serializeProduct };
""")
write("src/services/money.js", """function formatMoney(amountMinor) {
  return '$' + (Number(amountMinor) / 100).toFixed(2);
}
module.exports = { formatMoney };
""")
write("src/services/catalog-service.js", """const { ProductRepository } = require('../storage/product-repository');
const { ProductCache } = require('../cache/product-cache');
const { serializeProduct } = require('../http/serializers/product');

const repository = new ProductRepository();
const cache = new ProductCache();

async function getProducts() {
  const products = await repository.findAll();
  return products.map((product) => {
    const old = cache.get(product.id);
    if (old) return serializeProduct(old);
    cache.put(product.id, product);
    return serializeProduct(product);
  });
}
module.exports = { getProducts };
""")
write("src/storage/db.js", """class DbClient {
  async query(_sql, _params = []) { return { rows: [] }; }
}
module.exports = { DbClient };
""")
write("src/storage/product-repository.js", """const { DbClient } = require('./db');

class ProductRepository {
  constructor(db = new DbClient()) { this.db = db; }
  async findAll() {
    const result = await this.db.query(
      'SELECT id, name, price_minor FROM products ORDER BY id'
    );
    return result.rows;
  }
}
module.exports = { ProductRepository };
""")
write("src/cache/product-cache.js", """class ProductCache {
  constructor() { this.values = new Map(); }
  key(productId) { return `product:${productId}`; }
  get(productId) { return this.values.get(this.key(productId)); }
  put(productId, product) { this.values.set(this.key(productId), product); }
}
module.exports = { ProductCache };
""")
write("src/notifications/price-email.js", """const { formatMoney } = require('../services/money');

function renderPriceNotice(product, recipient) {
  return `Hello ${recipient}, ${product.name} is now ${formatMoney(product.price_minor)}.`;
}
module.exports = { renderPriceNotice };
""")
write("src/export/products-csv.js", """const { formatMoney } = require('../services/money');

function productCsvRow(product) {
  return [product.id, product.name, formatMoney(product.price_minor)].join(',');
}
module.exports = { productCsvRow };
""")
write("src/legacy/pricing-legacy.js", """// Retained for old archived scripts; no current import points here.
function legacyPriceLabel(cents) { return '$' + (cents / 100).toFixed(2); }
module.exports = { legacyPriceLabel };
""")
write("src/validation/currency.js", """function isCurrencyCode(value) { return /^[A-Z]{3}$/.test(value); }
module.exports = { isCurrencyCode };
""")
write("scripts/lint-check.js", """const fs = require('node:fs');
if (!fs.existsSync('src')) process.exit(1);
console.log('lint checks passed');
""")

# Migrations in application order.
write("db/migrations/001_create_products.sql", """CREATE TABLE products (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  price_minor INTEGER NOT NULL
);
""")
write("db/migrations/002_add_product_state.sql", """ALTER TABLE products ADD COLUMN state TEXT NOT NULL DEFAULT 'active';
""")
write("db/migrations/003_add_product_sku.sql", """ALTER TABLE products ADD COLUMN sku TEXT UNIQUE;
""")
write("db/migrations/004_create_audit_log.sql", """CREATE TABLE price_audit_log (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
""")
# Migration 005 is intentionally absent from this pre-change snapshot; PAY-204 adds it.
if (FIX / 'db/migrations/005_add_product_prices.sql').exists():
    (FIX / 'db/migrations/005_add_product_prices.sql').unlink()

# Tests and shared helper. The helper deliberately reflects today's one-currency data.
write("tests/helpers/product-fixture.js", """function productFixture(overrides = {}) {
  return Object.assign({ id: 7, name: 'Canvas Tote', price_minor: 1299, currency_code: 'USD' }, overrides);
}
module.exports = { productFixture };
""")
write("tests/helpers/fake-db.js", """function fakeDb(rows = []) { return { query: async () => ({ rows }) }; }
module.exports = { fakeDb };
""")
write("tests/unit/money.test.js", """const test = require('node:test');
const assert = require('node:assert/strict');
const { formatMoney } = require('../../src/services/money');
test('formats a minor-unit amount', () => assert.equal(formatMoney(1299), '$12.99'));
""")
write("tests/unit/cache.test.js", """const test = require('node:test');
const assert = require('node:assert/strict');
const { ProductCache } = require('../../src/cache/product-cache');
test('returns a stored product', () => {
  const c = new ProductCache(); c.put(1, {id: 1}); assert.deepEqual(c.get(1), {id: 1});
});
""")
write("tests/unit/catalog-service.test.js", """const test = require('node:test');
const assert = require('node:assert/strict');
test('catalog service fixture exists for the service suite', () => assert.ok(true));
""")
write("tests/unit/repository.test.js", """const test = require('node:test');
const assert = require('node:assert/strict');
const { ProductRepository } = require('../../src/storage/product-repository');
const { fakeDb } = require('../helpers/fake-db');
test('repository returns database rows', async () => { assert.deepEqual(await new ProductRepository(fakeDb([{id: 1}])).findAll(), [{id: 1}]); });
""")
write("tests/integration/products-route.test.js", """const test = require('node:test');
const assert = require('node:assert/strict');
test('products route smoke test is registered', () => assert.equal(typeof require('../../src/http/products-route').listProducts, 'function'));
""")
write("tests/integration/export.test.js", """const test = require('node:test');
const assert = require('node:assert/strict');
const { productCsvRow } = require('../../src/export/products-csv');
test('CSV row includes product identity', () => assert.match(productCsvRow({id: 1, name: 'A', price_minor: 100, currency_code: 'USD'}), /^1,A/));
""")
write("tests/integration/price-email.test.js", """const test = require('node:test');
const assert = require('node:assert/strict');
const { renderPriceNotice } = require('../../src/notifications/price-email');
test('price notice names recipient', () => assert.match(renderPriceNotice({name: 'A', price_minor: 100, currency_code: 'USD'}, 'Lee'), /Lee/));
""")
write("tests/fixtures/products.json", """[
  {"id": 7, "name": "Canvas Tote", "price_minor": 1299, "currency_code": "USD"},
  {"id": 8, "name": "Desk Lamp", "price_minor": 4500, "currency_code": "USD"}
]
""")

# Project documents.
write("docs/architecture.md", """# Catalog architecture

The route delegates to `catalog-service`, which validates request inputs, reads the repository, and serializes products. The repository currently reads the price stored on `products`. A small in-process cache sits between the service and repository. Notification and partner-export code each use the shared money formatter.

SQL migrations run in filename order during deployment. Existing production rows must remain readable throughout a rolling deployment.
""")
write("docs/data-dictionary.md", """# Price data dictionary

`products.price_minor` is an integer in the smallest unit of the product's current display currency. The current dataset has USD values. Currency codes use three uppercase ISO-style letters. `product_prices.amount_minor` is also an integer minor-unit amount when present.
""")
write("docs/requests/multi-currency-prices.md", """# Request: multi-currency product prices

Product buyers are in several markets. Extend the catalog so a caller may request a supported currency with `GET /v1/products?currency=EUR`. The response should include the selected currency and an amount formatted with the existing money rules. A missing query parameter keeps today's USD behavior. Unsupported codes return the service's normal client error.

The first rollout supports USD, EUR, and GBP. The existing amount for every product must remain available as its USD price. A regional price feed will populate non-USD prices separately; this change must not invent exchange rates. The partner CSV and price-notification email must display the same currency-aware price as the API.

Keep the change safe for a rolling deployment: database changes are applied before application instances that read the new shape. Cover the request, fallback, unsupported input, and output-format behavior with tests. Update the operator-facing API example when the response contract changes.

Requester acceptance examples:

- an omitted currency returns USD;
- a EUR request never returns a cached USD amount;
- a product with a regional amount shows that amount in the API, CSV, and notification;
- existing USD callers remain compatible.
""")
write("docs/estimate-guide.md", """# Estimate guide

Use the smallest whole-number point size that covers implementation, tests, and review. The team's historical conversion is:

| points | work days |
| ---: | ---: |
| 1 | 0.5 |
| 2 | 1 |
| 3 | 2 |
| 5 | 3 |
| 8 | 5 |

A work day is one engineer working a normal Monday-Friday day. Round a combined estimate only after adding the ticket estimates. Database rollout verification belongs in the database ticket; test updates belong in the ticket that changes the behavior. This guide is for planning, not a guarantee of elapsed calendar time.
""")
write("docs/roadmap.csv", """release,theme,target_date,status,comment
2027-Q2,regional catalog,2027-05-21,Planned,keep existing USD clients working
2027-Q2,partner exports,2027-05-28,Planned,
2027-Q3,archive cleanup,2027-07-16,Parked,not part of current request
""")
write("docs/team-calendar.csv", """sprint,start,end,available_engineer_days,holiday,notes
Harbor-11,2027-04-12,2027-04-23,34,,two engineers, normal pairing
Harbor-12,2027-04-26,2027-05-07,32,2027-04-30,one public holiday
Harbor-13,2027-05-10,2027-05-21,34,,release hardening
Harbor-14,2027-05-24,2027-06-04,32,2027-05-31,one public holiday
""")

# Noisy export of ordinary work. Request-specific implementation rows are
# deliberately absent: the developer must infer the work from the repository.
base_titles = {
    201: ('Closed', 'Review catalog naming', 2, 'Mara', '2027-03-01', 'completed with old response examples'),
    202: ('Open', 'Document catalog support runbook', 2, 'Ivo', '2027-04-02', ''),
    203: ('Cancelled', 'Prototype market landing page', 5, 'Nell', '2027-02-17', 'cancelled after campaign change'),
    205: ('Closed', 'Remove duplicate catalog query', 3, 'Tariq', '2027-03-21', 'released in 3.7'),
    206: ('Open', 'Refresh API error examples', '', 'Uma', '2027-04-05', 'waiting for wording review'),
    207: ('Cancelled', 'Prototype exchange-rate widget', 3, 'Mara', '2027-03-12', 'not in this release'),
    208: ('Open', 'Add product fixture samples', 2, 'Ivo', '2027-04-06', 'small test-data cleanup'),
    210: ('Open', 'Review database indexes', 2, 'Tariq', '2027-04-01', ''),
    211: ('Closed', 'Correct SKU export heading', 1, 'Nell', '2027-03-18', 'closed'),
    212: ('Open', 'Tidy request logging', 2, 'Uma', '2027-04-04', 'no behavior change expected'),
    213: ('Cancelled', 'Investigate vendor conversion API', 5, 'Mara', '2027-03-25', 'vendor contract ended'),
    216: ('Closed', 'Add health endpoint', 2, 'Tariq', '2027-03-08', 'already shipped'),
    217: ('Open', 'Review partner delivery logs', 1, 'Uma', '2027-04-07', ''),
    218: ('Cancelled', 'Explore localized product names', 5, 'Sana', '2027-03-28', 'deferred'),
    220: ('Closed', 'Pin node runtime version', 1, 'Ivo', '2027-03-02', 'done'),
    221: ('Open', 'Improve catalog retry message', 2, 'Nell', '2027-04-02', 'empty comment in source export'),
    222: ('Open', 'Refresh smoke-test script', 2, 'Tariq', '2027-04-05', ''),
    223: ('Cancelled', 'Compare foreign payment gateways', 8, 'Uma', '2027-03-11', 'out of scope'),
    225: ('Open', 'Add catalog response timing metric', 3, 'Mara', '2027-04-06', 'observability only'),
    226: ('Closed', 'Normalize product names', 3, 'Ivo', '2027-02-26', 'released'),
    227: ('Open', 'Review release checklist', '', 'Nell', '2027-04-01', 'estimate missing'),
    228: ('Cancelled', 'Build market selector UI', 8, 'Tariq', '2027-03-20', 'client team owns this'),
    230: ('Open', 'Clean old catalog comments', 1, 'Sana', '2027-04-04', ''),
    231: ('Closed', 'Add request correlation id', 2, 'Mara', '2027-03-15', 'done'),
    232: ('Open', 'Review deployment permissions', 2, 'Ivo', '2027-04-07', ''),
    233: ('Cancelled', 'Draft market analytics dashboard', 5, 'Nell', '2027-03-06', 'cancelled'),
    235: ('Open', 'Update dependency notes', 1, 'Uma', '2027-04-03', ''),
    236: ('Closed', 'Repair stale product fixture', 2, 'Sana', '2027-03-10', 'closed'),
    237: ('Open', 'Check API response headers', 2, 'Mara', '2027-04-08', 'no product behavior'),
    238: ('Cancelled', 'Estimate tax-inclusive prices', 5, 'Ivo', '2027-03-13', 'separate initiative'),
    240: ('Closed', 'Archive retired price parser', 1, 'Tariq', '2027-02-19', 'closed'),
}
rows = []
for n, item in base_titles.items():
    rows.append([f'PAY-{n}', *item])
rng = random.Random(7421)
rng.shuffle(rows)
(FIX / 'data').mkdir(parents=True, exist_ok=True)
with (FIX / 'data/work-items.csv').open('w', newline='', encoding='utf-8') as f:
    w = csv.writer(f)
    w.writerow(['id', 'status', 'title', 'estimate_points', 'owner', 'updated', 'comments'])
    w.writerows(rows)

# A few ordinary source files keep the repository shape realistic without affecting the request.
for i in range(1, 9):
    write(f"docs/notes/weekly-{i:02d}.md", f"# Week {i}\n\nRoutine catalog maintenance notes from 2027. No release decision is recorded here.\n")

print(f"generated {sum(1 for p in FIX.rglob('*') if p.is_file())} fixture files")
