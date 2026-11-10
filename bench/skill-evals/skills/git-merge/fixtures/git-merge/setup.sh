#!/usr/bin/env bash
# Builds a throwaway repo pair in the current directory:
#   origin.git  - bare "remote"
#   work/       - clone with branches mainline, dev, feature/invoice-pdf
set -euo pipefail
ROOT="$(pwd)"
rm -rf "$ROOT/origin.git" "$ROOT/work"
git init -q --bare -b mainline "$ROOT/origin.git"
git clone -q "$ROOT/origin.git" "$ROOT/work" 2>/dev/null
cd "$ROOT/work"
git config user.name "Fixture Bot"
git config user.email "fixture@example.com"
git checkout -q -b mainline
mkdir -p src/billing
printf 'export function render(invoice) {\n  return `Invoice ${invoice.id}`;\n}\n' > src/billing/render.js
printf '# billing\n' > README.md
git add -A && git commit -q -m "initial commit"
git push -q -u origin mainline

git checkout -q -b feature/invoice-pdf
printf 'export function toPdf(invoice) {\n  return Buffer.from(`PDF ${invoice.id}`);\n}\n' > src/billing/pdf.js
git add -A && git commit -q -m "add pdf export"
printf '\nPDF export: see src/billing/pdf.js\n' >> README.md
git add -A && git commit -q -m "document pdf export"
git push -q -u origin feature/invoice-pdf

git checkout -q mainline
printf 'export const CURRENCY = "USD";\n' > src/billing/currency.js
git add -A && git commit -q -m "add currency constant"
git push -q origin mainline

git checkout -q -b dev
printf 'export const TAX_RATE = 0.08;\n' > src/billing/tax.js
git add -A && git commit -q -m "add tax rate"
git push -q -u origin dev

git checkout -q feature/invoice-pdf

# Optional: a teammate pushes to origin/mainline after work/ was cloned, so
# work/'s local mainline is now behind origin.
if [ "${1:-}" = "--teammate-push" ]; then
  git clone -q "$ROOT/origin.git" "$ROOT/.teammate" 2>/dev/null
  (
    cd "$ROOT/.teammate"
    git config user.name "Teammate"
    git config user.email "teammate@example.com"
    git checkout -q mainline
    printf 'export function render(invoice) {\n  return `Invoice ${invoice.id} (${invoice.total.toFixed(2)})`;\n}\n' > src/billing/render.js
    git add -A && git commit -q -m "fix rounding in render"
    git push -q origin mainline
  )
  rm -rf "$ROOT/.teammate"
fi
echo "setup done: $(pwd)"
