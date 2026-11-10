#!/usr/bin/env bash
# Builds a local repo with a feature branch that is about to become a PR. Run once from this directory.
set -euo pipefail
[ -d .git ] && { echo "repo already set up"; exit 0; }
git init -q -b main .
git config user.email dev@example.com
git config user.name "Dev Example"
export GIT_AUTHOR_DATE="2026-02-02T10:00:00" GIT_COMMITTER_DATE="2026-02-02T10:00:00"
mkdir -p src test
cat > src/cart.js <<'JS'
function total(items) {
  return items.reduce((s, i) => s + i.price * i.qty, 0);
}
module.exports = { total };
JS
cat > src/tax.js <<'JS'
function addTax(amount, rate) {
  return Math.round(amount * (1 + rate));
}
module.exports = { addTax };
JS
cat > test/cart.test.js <<'JS'
const assert = require('node:assert');
const { total } = require('../src/cart');
assert.strictEqual(total([{ price: 5, qty: 2 }]), 10);
console.log('cart ok');
JS
git add -A && git commit -qm "feat(cart): add cart total"
echo "# shop" > README.md && git add -A && git commit -qm "docs: add readme"
git checkout -q -b johns-changes
export GIT_AUTHOR_DATE="2026-02-03T10:00:00" GIT_COMMITTER_DATE="2026-02-03T10:00:00"
cat > src/tax.js <<'JS'
function addTax(amount, rate) {
    return Math.round(amount * (1 + rate));
}

module.exports = {
    addTax,
};
JS
cat > src/cart.js <<'JS'
function total(items) {
  const sum = items.reduce((s, i) => s + i.price * i.qty, 0);
  const units = items.reduce((n, i) => n + i.qty, 0);
  return units >= 10 ? sum * 0.9 : sum;
}
module.exports = { total };
JS
git add -A && git commit -qm "Updated stuff"
export GIT_AUTHOR_DATE="2026-02-04T10:00:00" GIT_COMMITTER_DATE="2026-02-04T10:00:00"
cat > src/cart.js <<'JS'
function total(items) {
  const sum = items.reduce((s, i) => s + i.price * i.qty, 0);
  const units = items.reduce((n, i) => n + i.qty, 0);
  return units >= 10 ? sum * 0.9 : sum;
}
function applyCoupon(amount, coupon) {
  return (amount * coupon.pct) / 100;
}
module.exports = { applyCoupon };
JS
cat > src/tax.js <<'JS'
function addTax(amount, rate) {
    return Math.round(amount * (1 + rate) * 100) / 100;
}

module.exports = {
    addTax,
};
JS
git add -A && git commit -qm "feat(cart): add coupon support and also fix the tax rounding bug that finance reported last week"
export GIT_AUTHOR_DATE="2026-02-05T10:00:00" GIT_COMMITTER_DATE="2026-02-05T10:00:00"
cat > test/coupon.test.js <<'JS'
const assert = require('node:assert');
const { applyCoupon } = require('../src/cart');
assert.strictEqual(applyCoupon(100, { pct: 10 }), 90);
console.log('coupon ok');
JS
git add -A && git commit -qm "added tests"
export GIT_AUTHOR_DATE="2026-02-06T10:00:00" GIT_COMMITTER_DATE="2026-02-06T10:00:00"
cat > src/cart.js <<'JS'
function total(items) {
  const sum = items.reduce((s, i) => s + i.price * i.qty, 0);
  const units = items.reduce((n, i) => n + i.qty, 0);
  return units >= 10 ? sum * 0.9 : sum;
}
function applyCoupon(amount, coupon) {
  return amount - (amount * coupon.pct) / 100;
}
module.exports = { total, applyCoupon };
JS
git add -A && git commit -qm "fix: make tests pass"
git checkout -q main
export GIT_AUTHOR_DATE="2026-02-07T10:00:00" GIT_COMMITTER_DATE="2026-02-07T10:00:00"
printf 'root = true\n[*]\nindent_size = 2\n' > .editorconfig && git add .editorconfig && git commit -qm "chore: add editorconfig"
git checkout -q johns-changes
echo "setup done"
