#!/bin/sh
set -eu

: "${OVERLAY:?OVERLAY must point to this answer directory}"

if ! git merge --no-commit feature/promo-codes; then
  :
fi
cp "$OVERLAY/src/pricing.js" src/pricing.js
cp "$OVERLAY/src/config/default.json" src/config/default.json
cp "$OVERLAY/docs/pricing.md" docs/pricing.md
cp "$OVERLAY/CHANGELOG.md" CHANGELOG.md
cp "$OVERLAY/test/feature-pricing.test.js" test/feature-pricing.test.js
cp "$OVERLAY/test/pricing.test.js" test/pricing.test.js
git add -A
git commit -m "Merge basket offers into main"

if ! git merge --no-commit feature/tax-regions; then
  :
fi
cp "$OVERLAY/src/pricing.js" src/pricing.js
cp "$OVERLAY/src/config/default.json" src/config/default.json
cp "$OVERLAY/docs/pricing.md" docs/pricing.md
cp "$OVERLAY/CHANGELOG.md" CHANGELOG.md
cp "$OVERLAY/test/feature-pricing.test.js" test/feature-pricing.test.js
cp "$OVERLAY/test/pricing.test.js" test/pricing.test.js
git add -A
git commit -m "Merge regional tax rules into main"
