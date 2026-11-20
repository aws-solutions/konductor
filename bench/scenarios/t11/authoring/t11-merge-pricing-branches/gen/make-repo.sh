#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
FIX="$ROOT/fixture"
rm -rf "$FIX"
mkdir -p "$FIX/.github/workflows" "$FIX/docs" "$FIX/src/config" "$FIX/src/archive" "$FIX/test/helpers" "$FIX/test/fixtures" "$FIX/data" "$FIX/scripts"

cat > "$FIX/package.json" <<'EOF'
{
  "name": "lantern-cart-pricing",
  "version": "2.3.0",
  "description": "Small order pricing rules for Lantern Market",
  "main": "src/index.js",
  "scripts": {
    "test": "node --test test/"
  },
  "engines": {
    "node": ">=24"
  }
}
EOF
cat > "$FIX/.gitignore" <<'EOF'
node_modules/
coverage/
*.log
.DS_Store
EOF
cat > "$FIX/.editorconfig" <<'EOF'
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
EOF
cat > "$FIX/.npmrc" <<'EOF'
fund=false
audit=false
EOF
cat > "$FIX/.github/workflows/ci.yml" <<'EOF'
name: checks

on:
  push:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: node --test test/
EOF
cat > "$FIX/README.md" <<'EOF'
# Lantern Cart Pricing

Lantern Market keeps its checkout arithmetic in a small CommonJS module. The
library accepts cart lines with `sku`, `quantity`, and numeric `unitPrice`
fields. Prices are expressed in the shop's currency units, not integer cents.

```js
const { calculateOrder } = require('./src');

const quote = calculateOrder({
  lines: [{ sku: 'mug-blue', quantity: 2, unitPrice: 8.5 }],
  shippingMethod: 'standard'
});
```

A quote contains `subtotal`, `discount`, `shipping`, `tax`, and `total`.
The default shipping method is `standard`. The pricing module is deliberately
free of I/O except for loading its default JSON configuration.

Run the checks with `node --test test/`. Node 24 is the supported runtime.
EOF
cat > "$FIX/CHANGELOG.md" <<'EOF'
# Changelog

## 2.3.0 - 2026-02-14

- Added the regional shipping table used by checkout estimates.
- Clarified the standard and express delivery labels.

## 2.2.1 - 2026-01-29

- Kept catalog descriptions out of arithmetic results.
- Recorded the empty-cart behavior in the pricing notes.

## 2.2.0 - 2025-12-18

- Added the CommonJS entry point and lightweight order quote object.
EOF
cat > "$FIX/docs/pricing.md" <<'EOF'
# Pricing notes

The quote is calculated from the unrounded cart values. A discount reduces the
basket before tax is calculated. Shipping is added after the basket discount.
The tax region decides whether shipping joins the taxable base. The final
amounts are represented in cents using half-up rounding.

An empty cart has a zero subtotal and still receives the selected shipping
charge. A caller that needs a free delivery promise should choose that rule
before calling this package.
EOF
cat > "$FIX/docs/release.md" <<'EOF'
# Release checklist

1. Run `node --test test/` on Node 24.
2. Check that `src/config/default.json` parses as JSON.
3. Read the changelog entry aloud in the release review.
4. Build a sample quote with a standard delivery method.

The package has no runtime dependencies and does not contact external
services.
EOF
cat > "$FIX/docs/operations.md" <<'EOF'
# Operations note

The checkout service loads the default configuration at process start in the
web application. This package loads a fresh copy when its public calculation
function is called, which keeps command-line tools simple. Configuration files
are kept small enough to review in a normal pull request.
EOF
cat > "$FIX/docs/catalog.md" <<'EOF'
# Catalog data

Catalog data is illustrative and is not used to determine a quote. The price
must arrive on each cart line so that an order can preserve its original
snapshot.
EOF
cat > "$FIX/docs/faq.md" <<'EOF'
# Frequently asked questions

**Does the quote mutate the cart?** No. Input objects are read but never
written.

**Are names required on a line?** No. A SKU, quantity, and unit price are the
smallest useful line.
EOF
cat > "$FIX/docs/adr-001.md" <<'EOF'
# ADR 001: numeric prices at the boundary

The public boundary uses JavaScript numbers because the shop imports prices
from an existing JSON feed. Arithmetic stays in numbers until the final
currency representation. The implementation keeps the conversion in one
small helper so callers do not need a money class.
EOF
cat > "$FIX/src/constants.js" <<'EOF'
'use strict';

const SHIPPING_METHODS = Object.freeze(['standard', 'express']);

module.exports = { SHIPPING_METHODS };
EOF
cat > "$FIX/src/validators.js" <<'EOF'
'use strict';

function assertOrder(order) {
  if (!order || !Array.isArray(order.lines)) {
    throw new TypeError('order.lines must be an array');
  }
  for (const line of order.lines) {
    if (!line || typeof line.sku !== 'string' || !Number.isFinite(line.unitPrice)) {
      throw new TypeError('each line needs a sku and numeric unitPrice');
    }
    if (!Number.isInteger(line.quantity) || line.quantity < 0) {
      throw new TypeError('each line needs a non-negative integer quantity');
    }
  }
}

module.exports = { assertOrder };
EOF
cat > "$FIX/src/config/README.md" <<'EOF'
# Configuration

`default.json` is the checked-in configuration used by the library. The
shipping amounts are currency units, and prices in `data/catalog.json` are
only sample catalog values.
EOF
cat > "$FIX/src/config/development.json" <<'EOF'
{
  "shipping": {
    "standard": 0,
    "express": 3.5
  }
}
EOF
cat > "$FIX/src/archive/old-rates.js" <<'EOF'
'use strict';

module.exports = {
  standard: 4.5,
  express: 11.25
};
EOF
cat > "$FIX/src/catalog.js" <<'EOF'
'use strict';

const catalog = require('../data/catalog.json');

function findItem(sku) {
  return catalog.items.find((item) => item.sku === sku) || null;
}

module.exports = { findItem };
EOF
cat > "$FIX/src/format.js" <<'EOF'
'use strict';

function formatAmount(amount) {
  return Number(amount).toFixed(2);
}

function formatQuote(quote) {
  return `Total ${formatAmount(quote.total)}`;
}

module.exports = { formatAmount, formatQuote };
EOF
cat > "$FIX/src/receipt.js" <<'EOF'
'use strict';

function receiptRows(quote) {
  return [
    ['Subtotal', quote.subtotal],
    ['Discount', quote.discount],
    ['Shipping', quote.shipping],
    ['Tax', quote.tax],
    ['Total', quote.total]
  ];
}

module.exports = { receiptRows };
EOF
cat > "$FIX/src/legacy.js" <<'EOF'
'use strict';

function legacyTotal(lines) {
  return lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
}

module.exports = { legacyTotal };
EOF
cat > "$FIX/src/pricing.js" <<'EOF'
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assertOrder } = require('./validators');

const DEFAULT_CONFIG = path.join(__dirname, 'config', 'default.json');

function loadConfig(filePath = DEFAULT_CONFIG) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function roundCents(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundLineTotal(line) {
  return roundCents(line.unitPrice * line.quantity);
}

function calculateOrder(order, config = loadConfig()) {
  assertOrder(order);
  const shippingMethod = order.shippingMethod || 'standard';
  if (!Object.prototype.hasOwnProperty.call(config.shipping, shippingMethod)) {
    throw new RangeError(`unknown shipping method: ${shippingMethod}`);
  }
  const subtotal = order.lines.reduce((sum, line) => sum + roundLineTotal(line), 0);
  const shipping = config.shipping[shippingMethod];
  return {
    subtotal: roundCents(subtotal),
    discount: 0,
    shipping: roundCents(shipping),
    tax: 0,
    total: roundCents(subtotal + shipping)
  };
}

module.exports = { calculateOrder, loadConfig, roundCents };
EOF
cat > "$FIX/src/index.js" <<'EOF'
'use strict';

module.exports = require('./pricing');
EOF
cat > "$FIX/src/config/default.json" <<'EOF'
{
  "shipping": {
    "standard": 4.99,
    "express": 12.5
  }
}
EOF
cat > "$FIX/data/catalog.json" <<'EOF'
{
  "items": [
    { "sku": "mug-blue", "name": "Blue kiln mug", "price": 8.5 },
    { "sku": "tea-tin", "name": "Cedar tea tin", "price": 14.75 },
    { "sku": "linen-wrap", "name": "Linen gift wrap", "price": 3.25 }
  ]
}
EOF
cat > "$FIX/data/shipping.json" <<'EOF'
{
  "labels": {
    "standard": "Ground parcel",
    "express": "Two-day parcel"
  },
  "dispatchDays": {
    "standard": 3,
    "express": 1
  }
}
EOF
cat > "$FIX/data/regions-notes.txt" <<'EOF'
The sample shop serves Harbor, Ridge, and Meadow addresses. The data team
keeps the authoritative rates in the pricing configuration rather than here.
EOF
cat > "$FIX/test/helpers/assert-order.js" <<'EOF'
'use strict';

const assert = require('node:assert/strict');

function assertQuote(quote, expected) {
  assert.deepEqual(quote, expected);
}

module.exports = { assertQuote };
EOF
cat > "$FIX/test/fixtures/cart.json" <<'EOF'
{
  "lines": [
    { "sku": "mug-blue", "quantity": 2, "unitPrice": 8.5 },
    { "sku": "tea-tin", "quantity": 1, "unitPrice": 14.75 }
  ],
  "shippingMethod": "standard"
}
EOF
cat > "$FIX/test/fixtures/empty.json" <<'EOF'
{
  "lines": [],
  "shippingMethod": "express"
}
EOF
cat > "$FIX/test/fixtures/mixed.json" <<'EOF'
{
  "lines": [
    { "sku": "linen-wrap", "quantity": 3, "unitPrice": 3.25 },
    { "sku": "mug-blue", "quantity": 1, "unitPrice": 8.5 }
  ]
}
EOF
cat > "$FIX/test/pricing.test.js" <<'EOF'
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateOrder } = require('../src');

 test('prices a standard parcel', () => {
  const quote = calculateOrder({
    lines: [{ sku: 'mug-blue', quantity: 2, unitPrice: 8.5 }]
  });
  assert.deepEqual(quote, {
    subtotal: 17,
    discount: 0,
    shipping: 4.99,
    tax: 0,
    total: 21.99
  });
});

test('uses express shipping and supports an empty basket', () => {
  assert.deepEqual(calculateOrder({ lines: [], shippingMethod: 'express' }), {
    subtotal: 0,
    discount: 0,
    shipping: 12.5,
    tax: 0,
    total: 12.5
  });
});

test('rejects malformed lines', () => {
  assert.throws(() => calculateOrder({ lines: [{ sku: 'bad', quantity: 1 }] }), /unitPrice/);
});
EOF
cat > "$FIX/test/catalog.test.js" <<'EOF'
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { findItem } = require('../src/catalog');

test('finds a catalog item by sku', () => {
  assert.equal(findItem('tea-tin').name, 'Cedar tea tin');
  assert.equal(findItem('missing'), null);
});
EOF
cat > "$FIX/test/format.test.js" <<'EOF'
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatAmount, formatQuote } = require('../src/format');

test('formats currency for a receipt', () => {
  assert.equal(formatAmount(4.5), '4.50');
  assert.equal(formatQuote({ total: 19 }), 'Total 19.00');
});
EOF
cat > "$FIX/test/config.test.js" <<'EOF'
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src');

test('loads the checked-in shipping table', () => {
  const config = loadConfig();
  assert.equal(config.shipping.standard, 4.99);
  assert.equal(config.shipping.express, 12.5);
});
EOF
cat > "$FIX/test/receipt.test.js" <<'EOF'
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { receiptRows } = require('../src/receipt');

test('turns quote fields into receipt rows', () => {
  assert.deepEqual(receiptRows({ subtotal: 1, discount: 0, shipping: 2, tax: 3, total: 6 }), [
    ['Subtotal', 1], ['Discount', 0], ['Shipping', 2], ['Tax', 3], ['Total', 6]
  ]);
});
EOF
cat > "$FIX/test/validators.test.js" <<'EOF'
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertOrder } = require('../src/validators');

test('accepts zero quantity lines', () => {
  assert.doesNotThrow(() => assertOrder({ lines: [{ sku: 'x', quantity: 0, unitPrice: 2 }] }));
});
EOF
cat > "$FIX/scripts/check-data.js" <<'EOF'
'use strict';

const { findItem } = require('../src/catalog');

for (const sku of ['mug-blue', 'tea-tin', 'linen-wrap']) {
  if (!findItem(sku)) process.exitCode = 1;
}
EOF
cat > "$FIX/scripts/print-order.js" <<'EOF'
'use strict';

const fs = require('node:fs');
const { calculateOrder } = require('../src');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(`${JSON.stringify(calculateOrder(input))}\n`);
EOF

cd "$FIX"
git init -b main -q
git config user.name "Mara Venn"
git config user.email "mara.venn@lantern.invalid"
export GIT_AUTHOR_NAME="Mara Venn" GIT_AUTHOR_EMAIL="mara.venn@lantern.invalid" GIT_COMMITTER_NAME="Mara Venn" GIT_COMMITTER_EMAIL="mara.venn@lantern.invalid"
export GIT_AUTHOR_DATE="2026-02-01T09:00:00Z" GIT_COMMITTER_DATE="2026-02-01T09:00:00Z"
git add .
git commit -q -m "Initialize the order pricing package"

export GIT_AUTHOR_DATE="2026-02-02T09:00:00Z" GIT_COMMITTER_DATE="2026-02-02T09:00:00Z"
git commit -q --allow-empty -m "Document the checkout package"
export GIT_AUTHOR_DATE="2026-02-03T09:00:00Z" GIT_COMMITTER_DATE="2026-02-03T09:00:00Z"
git commit -q --allow-empty -m "Add catalog lookup helpers"
export GIT_AUTHOR_DATE="2026-02-04T09:00:00Z" GIT_COMMITTER_DATE="2026-02-04T09:00:00Z"
git commit -q --allow-empty -m "Record shipping labels"
export GIT_AUTHOR_DATE="2026-02-05T09:00:00Z" GIT_COMMITTER_DATE="2026-02-05T09:00:00Z"
git commit -q --allow-empty -m "Refresh release notes"

# Both feature lines begin at this exact main commit.
git branch feature/promo-codes
git branch feature/tax-regions

# Promo line: it carries the pre-rounding implementation and changes the shared files.
git checkout -q feature/promo-codes
cat > src/config/default.json <<'EOF'
{
  "shipping": {
    "standard": 4.99,
    "express": 12.5
  },
  "promos": {
    "WELCOME10": { "kind": "percent", "value": 10, "minimum": 0 },
    "BASKET5": { "kind": "fixed", "value": 5, "minimum": 25 }
  }
}
EOF
python3 - <<'PY'
from pathlib import Path
p=Path('src/pricing.js')
s=p.read_text()
s=s.replace("function calculateOrder(order, config = loadConfig()) {", "function calculateOrder(order, config = loadConfig()) {\n  const promo = order.promoCode && config.promos ? config.promos[order.promoCode] : null;")
s=s.replace("  const subtotal = order.lines.reduce((sum, line) => sum + roundLineTotal(line), 0);\n  const shipping = config.shipping[shippingMethod];\n  return {\n    subtotal: roundCents(subtotal),\n    discount: 0,\n    shipping: roundCents(shipping),\n    tax: 0,\n    total: roundCents(subtotal + shipping)\n  };", "  const subtotal = order.lines.reduce((sum, line) => sum + roundLineTotal(line), 0);\n  const discount = promo && subtotal >= promo.minimum\n    ? (promo.kind === 'percent' ? subtotal * promo.value / 100 : promo.value)\n    : 0;\n  const shipping = config.shipping[shippingMethod];\n  return {\n    subtotal: roundCents(subtotal),\n    discount: roundCents(Math.min(discount, subtotal)),\n    shipping: roundCents(shipping),\n    tax: 0,\n    total: roundCents(subtotal - discount + shipping)\n  };")
p.write_text(s)
PY
cat > CHANGELOG.md <<'EOF'
# Changelog

## 2.3.0 - 2026-02-14

- Added regional shipping labels and the WELCOME10 and BASKET5 basket offers.
- Clarified the standard and express delivery labels.

## 2.2.1 - 2026-01-29

- Kept catalog descriptions out of arithmetic results.
- Recorded the empty-cart behavior in the pricing notes.
EOF
cat > test/promo.test.js <<'EOF'
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateOrder } = require('../src');

test('applies a percentage offer', () => {
  assert.equal(calculateOrder({ lines: [{ sku: 'mug-blue', quantity: 2, unitPrice: 10 }], promoCode: 'WELCOME10' }).discount, 2);
});

test('enforces a fixed offer minimum', () => {
  assert.equal(calculateOrder({ lines: [{ sku: 'mug-blue', quantity: 1, unitPrice: 10 }], promoCode: 'BASKET5' }).discount, 0);
});
EOF
export GIT_AUTHOR_DATE="2026-02-06T09:00:00Z" GIT_COMMITTER_DATE="2026-02-06T09:00:00Z"
git add src/pricing.js src/config/default.json CHANGELOG.md test/promo.test.js
git commit -q -m "Add basket promotion configuration"
# A small documentation commit keeps this branch's history lived in.
cat >> docs/pricing.md <<'EOF'

The basket offers are selected by the optional `promoCode` field. The fixed
offer is available only when its minimum basket value is reached.
EOF
export GIT_AUTHOR_DATE="2026-02-07T09:00:00Z" GIT_COMMITTER_DATE="2026-02-07T09:00:00Z"
git add docs/pricing.md && git commit -q -m "Explain basket offers"
# Rename the old line helper on this branch; the other line will later refer to its old name.
python3 - <<'PY'
from pathlib import Path
p=Path('src/pricing.js')
s=p.read_text().replace('roundLineTotal', 'roundedLineAmount')
p.write_text(s)
PY
export GIT_AUTHOR_DATE="2026-02-08T09:00:00Z" GIT_COMMITTER_DATE="2026-02-08T09:00:00Z"
git add src/pricing.js && git commit -q -m "Rename the promo line amount helper"

# Tax line starts from the same pre-feature commit, not from promo.
git checkout -q feature/tax-regions
cat > src/config/default.json <<'EOF'
{
  "shipping": {
    "standard": 4.99,
    "express": 12.5
  },
  "regions": {
    "harbor": { "rate": 0.0825, "taxShipping": false },
    "ridge": { "rate": 0.05, "taxShipping": true },
    "meadow": { "rate": 0, "taxShipping": false }
  }
}
EOF
python3 - <<'PY'
from pathlib import Path
p=Path('src/pricing.js')
s=p.read_text()
s=s.replace("function calculateOrder(order, config = loadConfig()) {", "function calculateOrder(order, config = loadConfig()) {\n  const regionName = order.region || 'harbor';\n  const region = config.regions[regionName];\n  if (!region) throw new RangeError(`unknown tax region: ${regionName}`);")
s=s.replace("  const shipping = config.shipping[shippingMethod];\n  return {\n    subtotal: roundCents(subtotal),\n    discount: 0,\n    shipping: roundCents(shipping),\n    tax: 0,\n    total: roundCents(subtotal + shipping)\n  };", "  const shipping = config.shipping[shippingMethod];\n  const taxableBase = subtotal + (region.taxShipping ? shipping : 0);\n  const tax = taxableBase * region.rate;\n  return {\n    subtotal: roundCents(subtotal),\n    discount: 0,\n    shipping: roundCents(shipping),\n    tax: roundCents(tax),\n    total: roundCents(subtotal + shipping + tax)\n  };")
p.write_text(s)
PY
cat > CHANGELOG.md <<'EOF'
# Changelog

## 2.3.0 - 2026-02-14

- Added address regions to the order quote and noted which delivery charges are taxable.
- Clarified the standard and express delivery labels.

## 2.2.1 - 2026-01-29

- Kept catalog descriptions out of arithmetic results.
- Recorded the empty-cart behavior in the pricing notes.
EOF
cat > test/tax.test.js <<'EOF'
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateOrder } = require('../src');

test('charges the Harbor basket rate without taxing shipping', () => {
  const quote = calculateOrder({ lines: [{ sku: 'mug-blue', quantity: 2, unitPrice: 10 }], region: 'harbor' });
  assert.equal(quote.tax, 1.65);
});

test('charges shipping in the Ridge taxable base', () => {
  const quote = calculateOrder({ lines: [{ sku: 'mug-blue', quantity: 1, unitPrice: 10 }], region: 'ridge' });
  assert.equal(quote.tax, 0.75);
});
EOF
export GIT_AUTHOR_DATE="2026-02-06T12:00:00Z" GIT_COMMITTER_DATE="2026-02-06T12:00:00Z"
git add src/pricing.js src/config/default.json CHANGELOG.md test/tax.test.js
git commit -q -m "Add tax regions to order quotes"
cat >> docs/pricing.md <<'EOF'

Tax regions are named by the delivery address. Harbor excludes shipping from
tax, while Ridge includes it; Meadow is a zero-rate region.
EOF
export GIT_AUTHOR_DATE="2026-02-07T12:00:00Z" GIT_COMMITTER_DATE="2026-02-07T12:00:00Z"
git add docs/pricing.md && git commit -q -m "Describe regional tax treatment"
# This new tax path still uses the old helper name and is valid on its own branch.
python3 - <<'PY'
from pathlib import Path
p=Path('src/pricing.js')
s=p.read_text().replace("  const subtotal = order.lines.reduce((sum, line) => sum + roundLineTotal(line), 0);", "  const subtotal = order.lines.reduce((sum, line) => sum + roundLineTotal(line), 0);\n  const lineAudit = order.lines.map((line) => roundLineTotal(line));")
s=s.replace("    subtotal: roundCents(subtotal),", "    subtotal: roundCents(subtotal),\n    lineAudit,")
p.write_text(s)
PY
export GIT_AUTHOR_DATE="2026-02-08T12:00:00Z" GIT_COMMITTER_DATE="2026-02-08T12:00:00Z"
git add src/pricing.js && git commit -q -m "Keep line audit values for regional receipts"

# Main receives the independent currency fix after both branches already exist.
git checkout -q main
python3 - <<'PY'
from pathlib import Path
p=Path('src/pricing.js')
s=p.read_text()
s=s.replace("function roundCents(value) {\n  return Math.round((value + Number.EPSILON) * 100) / 100;\n}", "function roundCents(value) {\n  return Math.floor(value * 100 + 0.5) / 100;\n}\n\nfunction rawLineTotal(line) {\n  return line.unitPrice * line.quantity;\n}")
s=s.replace("const subtotal = order.lines.reduce((sum, line) => sum + roundLineTotal(line), 0);", "const subtotal = order.lines.reduce((sum, line) => sum + rawLineTotal(line), 0);")
p.write_text(s)
PY
cat >> docs/pricing.md <<'EOF'

Currency rounding is half-up and happens after the basket arithmetic, rather
than once for every individual cart line.
EOF
export GIT_AUTHOR_DATE="2026-02-09T09:00:00Z" GIT_COMMITTER_DATE="2026-02-09T09:00:00Z"
git add src/pricing.js docs/pricing.md && git commit -q -m "Round the complete basket once"

# Keep the repository in the starting state and remove git's generated hook files.
git checkout -q main
git status --porcelain
 git gc -q
rm -rf .git/hooks
mv .git dotgit
