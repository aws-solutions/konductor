#!/bin/sh
set -eu
: "${OVERLAY:?OVERLAY must point to this answer directory}"

if ! git merge --no-commit feature/promo-codes; then :; fi
git checkout --ours -- CHANGELOG.md docs/pricing.md
git checkout --ours -- src/pricing.js src/config/default.json
git add -A
git commit -m "Merge the basket offer branch"

if ! git merge --no-commit feature/tax-regions; then :; fi
git checkout --ours -- CHANGELOG.md docs/pricing.md
cp "$OVERLAY/src/pricing.js" src/pricing.js
cp "$OVERLAY/src/config/default.json" src/config/default.json
git add -A
git commit -m "Keep the checkout estimate compatible"
