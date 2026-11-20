#!/bin/sh
set -eu
cp "$OVERLAY/src/export.js" src/export.js
git add src/export.js
git commit -m 'Add the remaining CSV columns'
