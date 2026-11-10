# k-code-simplifier fixture key

- pricing.py `shipping_fee`: nested ternary on one line (p1 a2, p3 a3). Boundaries at weight 5 and 20.
- pricing.py `apply_discount`: trap. `if discount is None` must stay; `discount = discount or 0.1` changes behavior for discount=0 (p1 a4, p3 a4). Fixture tests deliberately do not cover discount=0. Also has a dead `else: result = result`.
- pricing.py `format_usd`/`format_eur`: copy-pasted grouping loop (p1 a5).
- report.py `summarize`: 8 levels of nesting (p2 a2). Edge cases not in fixture tests: None list, missing status, amount<=0, missing country on a large order (flagged because None != "US").
- Original SHA-256 of pricing.py and report.py are embedded in p3 a1.
- Self-tested: original fixture fails the structural checks and passes behavior checks; a correct refactor passes all p1/p2 programmatic checks.
