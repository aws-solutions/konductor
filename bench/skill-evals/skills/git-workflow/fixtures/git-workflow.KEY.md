# git-workflow fixture key (judge-only)

setup.sh builds 8 commits on main, tag v1.0 at "feat(auth): add audit helper", and leaves 3 uncommitted changes:
- src/paginate.js: off-by-one bug fix (fix)
- src/export.js: new CSV feature (feat)
- src/util.js: formatting only (style/chore/refactor)

p1: expect 3 separate conventional commits on a <type>/<desc> branch (not main), one file group each.
p2: the commit that removed the validateTenant call is "refactor(auth): simplify tenant middleware" (found with git log -S).
p3: first bad commit for test/math.test.js is "perf(math): inline rounding" (git bisect between v1.0 and HEAD).
SHAs are deterministic (fixed dates) but checks recompute them from the repo.

v2 changes:
- p2 now also asks to restore the validateTenant call as a commit. Expect a fix/<desc> branch off main, one `fix(auth): ...` commit touching only src/auth.js, and the 3 unrelated uncommitted src changes (paginate.js, util.js modified; export.js untracked) left uncommitted. `git commit -a` or `git add -A` would sweep them in (non-atomic).
- p3 replaced (bisect was passed by any competent answer). New setup-review.sh: main has 3 commits ("feat(cart): add cart total", "docs: add readme", then "chore: add editorconfig" added after the branch point). Branch `johns-changes` (bad name, should be feat/<desc>) has 4 commits:
  1. "Updated stuff": reformats src/tax.js AND adds a bulk-discount logic change to src/cart.js (formatting mixed with logic, vague, not conventional).
  2. "feat(cart): add coupon support and also fix the tax rounding bug that finance reported last week": over 72 chars, mixes a feat (applyCoupon) and a fix (tax rounding); also drops `total` from cart.js exports, so test/cart.test.js FAILS at this commit; applyCoupon formula is wrong.
  3. "added tests": past tense, non-conventional; test/coupon.test.js fails here.
  4. "fix: make tests pass": repairs the export and formula; a fixup that belongs folded into commit 2.
  Branch is behind main by the editorconfig commit (rebase before PR).
  Good plan: new branch e.g. feat/cart-coupons from main; commits like style(tax): reformat, feat(cart): add bulk discount, fix(tax): round to cents, feat(cart): add coupon support (with tests, folded fix); every commit passes `node test/*.test.js`; no force-push to a shared branch without asking. Plan only; repo must be unchanged.
