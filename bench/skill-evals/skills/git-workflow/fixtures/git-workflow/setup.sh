#!/usr/bin/env bash
# Builds a small local repo with history and uncommitted work. Run once from this directory.
set -euo pipefail
[ -d .git ] && { echo "repo already set up"; exit 0; }
git init -q -b main .
git config user.email dev@example.com
git config user.name "Dev Example"
export GIT_AUTHOR_DATE="2026-01-05T10:00:00" GIT_COMMITTER_DATE="2026-01-05T10:00:00"
mkdir -p src test
cat > src/auth.js <<'JS'
function validateTenant(req) {
  if (!req.tenantId) throw new Error('tenant required');
}
function authMiddleware(req, next) {
  validateTenant(req);
  return next(req);
}
module.exports = { authMiddleware, validateTenant };
JS
cat > src/math.js <<'JS'
function roundHalfUp(n) {
  return Math.floor(n + 0.5);
}
module.exports = { roundHalfUp };
JS
cat > src/paginate.js <<'JS'
function paginate(items, page, size) {
  const start = page * size;
  const end = start + size - 1;
  return items.slice(start, end);
}
module.exports = { paginate };
JS
cat > src/util.js <<'JS'
function   pick(obj,keys){ const out={}; for(const k of keys){ if(k in obj){out[k]=obj[k]} } return out }
module.exports={pick}
JS
cat > test/math.test.js <<'JS'
const assert = require('node:assert');
const { roundHalfUp } = require('../src/math');
assert.strictEqual(roundHalfUp(2.5), 3);
assert.strictEqual(roundHalfUp(2.4), 2);
assert.strictEqual(roundHalfUp(7), 7);
console.log('math ok');
JS
git add -A && git commit -qm "feat: initial service skeleton"
echo "# demo service" > README.md && git add -A && git commit -qm "docs: add readme"
cat >> src/auth.js <<'JS'
function audit(req) { return { tenant: req.tenantId, at: Date.now() }; }
module.exports.audit = audit;
JS
git add -A && git commit -qm "feat(auth): add audit helper"
git tag v1.0
sed -i 's/^  validateTenant(req);$/  \/\/ tenant checked upstream/' src/auth.js
git add -A && git commit -qm "refactor(auth): simplify tenant middleware"
echo "Usage: require('./src')" >> README.md && git add -A && git commit -qm "docs: usage notes"
cat > src/math.js <<'JS'
function roundHalfUp(n) {
  return Math.trunc(n);
}
module.exports = { roundHalfUp };
JS
git add -A && git commit -qm "perf(math): inline rounding"
echo '{"name":"demo","version":"1.0.1"}' > package.json && git add -A && git commit -qm "chore: add package.json"
echo "Changelog: 1.0.1" >> README.md && git add -A && git commit -qm "docs: changelog line"
# Uncommitted work: one bug fix, one new feature, one formatting-only change.
sed -i 's/const end = start + size - 1;/const end = start + size;/' src/paginate.js
cat > src/export.js <<'JS'
function toCsv(rows) {
  if (rows.length === 0) return '';
  const header = Object.keys(rows[0]);
  const lines = rows.map((r) => header.map((h) => String(r[h] ?? '')).join(','));
  return [header.join(','), ...lines].join('\n');
}
module.exports = { toCsv };
JS
cat > src/util.js <<'JS'
function pick(obj, keys) {
  const out = {};
  for (const k of keys) {
    if (k in obj) {
      out[k] = obj[k];
    }
  }
  return out;
}
module.exports = { pick };
JS
echo "setup done"
