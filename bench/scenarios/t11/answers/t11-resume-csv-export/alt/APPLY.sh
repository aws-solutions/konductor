#!/bin/sh
set -eu
cp "$OVERLAY/src/export.js" src/export.js
cp "$OVERLAY/test/csv-export.test.js" test/csv-export.test.js
git add src/export.js test/csv-export.test.js
git commit -m 'Complete the tabular export review'
